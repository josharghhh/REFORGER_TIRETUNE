"""Enfusion text resources (.et / .conf): parse, resolve inheritance, patch in place.

The format, as Workbench writes it (one entry per line, one space of indent per level):

    Vehicle : "{GUID}Prefabs/Parent.et" {          root object, optional ancestor
     ID "44EC665ABD2FF04B"                          property: key, then values to end of line
     components {                                   array container: one header token
      RigidBody "{51DAA09FECF52BBF}" {              array item: class + quoted id (or bare name)
       Mass 1173
      }
     }
     Simulation Wheeled "{4D8B...}" {               object property: key, class, id
     Tyre Tyre "{4D8B...}" : "{GUID}x.conf" {       ... with an ancestor config
     Forward +{                                     append-to-inherited array

Hand-written one-liners (``Wheel Wheel "{id}" { Radius 0.62 Mass 38 }``) are parsed too: inside a body that
opened on the same line, a key takes the following numbers / quoted strings as its values (or one bare word).

Patching never re-serialises a file: edits are spliced into the original text so diffs stay minimal and
everything the tool does not touch keeps its exact bytes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|\+\{|\{|\}|:(?=\s|")|[^\s{}"]+')
_NUMBER = re.compile(r'^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^0x[0-9a-fA-F]+$')


@dataclass
class Tok:
    text: str
    start: int
    end: int
    line: int


@dataclass
class Prop:
    key: Tok
    values: list[Tok]

    @property
    def name(self) -> str:
        return unquote(self.key.text)

    @property
    def end(self) -> int:
        return self.values[-1].end if self.values else self.key.end

    def strings(self) -> list[str]:
        return [v.text for v in self.values]


@dataclass
class Node:
    header: list[Tok]
    ancestor: Tok | None
    open: Tok | None              # the "{" / "+{" token (None for the virtual file root)
    close: Tok | None = None
    props: list[Prop] = field(default_factory=list)
    children: list['Node'] = field(default_factory=list)
    values: list[list[Tok]] = field(default_factory=list)   # bare value rows (LODFactors { 4 2 1 })
    parent: 'Node | None' = None
    in_array: bool = False         # parent is an array container
    depth: int = 0                 # nesting depth of this node's header (root object = 0)

    # --- header interpretation -------------------------------------------------------------------------------
    @property
    def words(self) -> list[str]:
        return [t.text for t in self.header]

    @property
    def is_container(self) -> bool:
        """`components {`, `Axles {`, `Forward +{`: a single header word that is not an array item."""
        return len(self.header) == 1 and not self.in_array and self.parent is not None and self.parent.parent is not None \
            or (self.open is not None and self.open.text == '+{')

    @property
    def key(self) -> str:
        """Property key this object is stored under (empty for array items and the root object)."""
        w = self.words
        if self.in_array or self.parent is None or self.parent.parent is None:
            return ''
        if len(w) >= 2 or len(w) == 1:
            return w[0]
        return ''

    @property
    def cls(self) -> str:
        w = self.words
        if self.in_array or self.parent is None or self.parent.parent is None:
            return w[0] if w else ''
        return w[1] if len(w) >= 2 else ''

    @property
    def name(self) -> str:
        """The object's id / name: `"{4D8B..}"` -> `{4D8B..}`, `Wheel_L01`, `Diff_01`."""
        w = self.words
        if self.in_array or self.parent is None or self.parent.parent is None:
            return unquote(w[1]) if len(w) >= 2 else ''
        return unquote(w[2]) if len(w) >= 3 else ''

    @property
    def ancestor_ref(self) -> str:
        return unquote(self.ancestor.text) if self.ancestor else ''

    @property
    def one_liner(self) -> bool:
        return self.open is not None and self.close is not None and self.open.line == self.close.line

    def prop(self, key: str) -> Prop | None:
        for p in reversed(self.props):
            if p.name == key:
                return p
        return None

    def child(self, key: str = '', cls: str = '', name: str = '') -> 'Node | None':
        for c in self.children:
            if key and c.key != key and not (c.is_container and c.words[0] == key):
                continue
            if cls and c.cls != cls:
                continue
            if name and c.name != name:
                continue
            return c
        return None

    def items(self) -> list['Node']:
        return [c for c in self.children if c.in_array]


def unquote(s: str) -> str:
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].replace('\\"', '"')
    return s


def ref_path(ref: str) -> str:
    """`{GUID}Prefabs/x.et` -> `Prefabs/x.et` (also accepts a bare path)."""
    ref = unquote(ref).strip()
    m = re.match(r'^\{[0-9A-Fa-f]{16}\}(.*)$', ref)
    return (m.group(1) if m else ref).replace('\\', '/')


def ref_guid(ref: str) -> str:
    m = re.match(r'^\{([0-9A-Fa-f]{16})\}', unquote(ref).strip())
    return m.group(1).upper() if m else ''


def is_number(s: str) -> bool:
    return bool(_NUMBER.match(s))


# ------------------------------------------------------------------------------------------------------------------
class ParseError(ValueError):
    pass


class Doc:
    """A parsed resource text. `root` is a virtual node whose children are the file's top-level objects."""

    def __init__(self, text: str, name: str = ''):
        self.text = text
        self.name = name
        self.toks = self._tokenize(text)
        self.pos = 0
        self.root = Node(header=[], ancestor=None, open=None, depth=-1)
        self._body(self.root, same_line=False)
        if self.pos < len(self.toks):
            t = self.toks[self.pos]
            raise ParseError(f'{name}: unexpected "{t.text}" on line {t.line + 1}')

    # --- tokenizer -------------------------------------------------------------------------------------------
    @staticmethod
    def _tokenize(text: str) -> list[Tok]:
        out: list[Tok] = []
        base = 0
        for li, raw in enumerate(text.split('\n')):
            for m in _TOKEN.finditer(raw):
                tx, start = m.group(0), m.start()
                if tx.startswith('\ufeff'):    # UTF-8 BOM before the first token: not part of the class name
                    tx, start = tx[1:], start + 1
                    if not tx:
                        continue
                if tx.startswith('//'):     # comment to end of line (never inside a quoted token)
                    break
                out.append(Tok(tx, base + start, base + m.end(), li))
            base += len(raw) + 1
        return out

    def _peek(self, k: int = 0) -> Tok | None:
        i = self.pos + k
        return self.toks[i] if i < len(self.toks) else None

    # --- parser ----------------------------------------------------------------------------------------------
    def _body(self, node: Node, same_line: bool) -> None:
        """Parse entries until the closing brace of `node` (or EOF for the virtual root)."""
        while True:
            t = self._peek()
            if t is None:
                if node.open is not None:
                    raise ParseError(f'{self.name}: missing "}}" for block opened on line {node.open.line + 1}')
                return
            if t.text == '}':
                if node.open is None:
                    raise ParseError(f'{self.name}: stray "}}" on line {t.line + 1}')
                node.close = t
                self.pos += 1
                return
            # statement: tokens up to "{", "+{", "}" or end of line
            line = t.line
            j = self.pos
            stmt: list[Tok] = []
            opener = None
            while j < len(self.toks) and self.toks[j].line == line:
                tx = self.toks[j].text
                if tx in ('{', '+{'):
                    opener = self.toks[j]
                    break
                if tx == '}':
                    break
                stmt.append(self.toks[j])
                j += 1
            if opener is not None:
                ancestor = None
                header = stmt
                if ':' in [s.text for s in stmt]:
                    ci = [s.text for s in stmt].index(':')
                    header = stmt[:ci]
                    ancestor = stmt[ci + 1] if ci + 1 < len(stmt) else None
                child = Node(header=header, ancestor=ancestor, open=opener, parent=node, depth=node.depth + 1)
                child.in_array = node.is_container if node.parent is not None else False
                node.children.append(child)
                self.pos = j + 1
                self._body(child, same_line=True)
                continue
            # property / value row(s)
            self.pos = j
            if same_line and node.open is not None and stmt and stmt[0].line == node.open.line:
                self._split_inline(node, stmt)
            elif is_number(stmt[0].text) or stmt[0].text.startswith('"') and node.is_container:
                node.values.append(stmt)
            else:
                node.props.append(Prop(stmt[0], stmt[1:]))

    @staticmethod
    def _split_inline(node: Node, stmt: list[Tok]) -> None:
        i = 0
        if is_number(stmt[0].text):
            node.values.append(stmt)
            return
        while i < len(stmt):
            key = stmt[i]
            i += 1
            vals: list[Tok] = []
            while i < len(stmt) and (is_number(stmt[i].text) or stmt[i].text.startswith('"')):
                vals.append(stmt[i])
                i += 1
            if not vals and i < len(stmt):
                vals.append(stmt[i])
                i += 1
            node.props.append(Prop(key, vals))

    # --- queries ---------------------------------------------------------------------------------------------
    @property
    def top(self) -> Node:
        objs = [c for c in self.root.children]
        if not objs:
            raise ParseError(f'{self.name}: no object')
        return objs[0]

    def line_indent(self, node: Node) -> str:
        return ' ' * max(0, node.depth + 1)


# ------------------------------------------------------------------------------------------------------------------
# Number formatting the way Workbench writes them: plain decimals, no exponent, no trailing zeros.
def fmt_num(v: float) -> str:
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, int):
        return str(v)
    if v != v or v in (float('inf'), float('-inf')):
        raise ValueError('not a finite number')
    a = abs(v)
    digits = 6 if a >= 1e-3 or a == 0 else 9
    s = f'{v:.{digits}f}'.rstrip('0').rstrip('.')
    if s in ('-0', ''):
        s = '0'
    return s


def fmt_value(v) -> str:
    if isinstance(v, (list, tuple)):
        return ' '.join(fmt_num(float(x)) for x in v)
    if isinstance(v, str):
        return v
    return fmt_num(v)


# ------------------------------------------------------------------------------------------------------------------
@dataclass
class Edit:
    start: int
    end: int
    text: str


class Patcher:
    """Collects splice edits on one document and applies them in one pass; re-parse after apply()."""

    def __init__(self, doc: Doc):
        self.doc = doc
        self.edits: list[Edit] = []
        self.log: list[str] = []
        self.nl = '\r\n' if '\r\n' in doc.text else '\n'    # keep the file's own line endings

    def _insert_before_close(self, node: Node, block: str, one_line: str) -> None:
        close = node.close
        if close is None:
            raise ParseError('cannot insert into the file root')
        if node.one_liner:
            self.edits.append(Edit(close.start, close.start, one_line + ' '))
            return
        # insert at the start of the closing brace's line, keeping that line's indentation intact
        line_start = self.doc.text.rfind('\n', 0, close.start) + 1
        self.edits.append(Edit(line_start, line_start, block.replace('\n', self.nl)))

    def set_prop(self, node: Node, key: str, value) -> bool:
        """Set `key value` on node; returns False when the text already holds exactly that value."""
        text = fmt_value(value)
        p = node.prop(key)
        if p is not None:
            if ' '.join(p.strings()) == text:
                return False
            self.edits.append(Edit(p.key.start, p.end, f'{p.key.text} {text}'))
            self.log.append(f'set {path_of(node)} {key} = {text} (was {" ".join(p.strings())})')
            return True
        indent = ' ' * (node.depth + 1)
        self._insert_before_close(node, f'{indent}{key} {text}\n', f'{key} {text}')
        self.log.append(f'add {path_of(node)} {key} = {text}')
        return True

    def add_block(self, node: Node, header: str) -> None:
        indent = ' ' * (node.depth + 1)
        self._insert_before_close(node, f'{indent}{header} {{\n{indent}}}\n', f'{header} {{ }}')
        self.log.append(f'add block {path_of(node)} / {header}')

    def set_ancestor(self, node: Node, ref: str) -> None:
        quoted = f'"{ref}"'
        if node.ancestor is not None:
            self.edits.append(Edit(node.ancestor.start, node.ancestor.end, quoted))
        else:
            last = node.header[-1]
            self.edits.append(Edit(last.end, last.end, f' : {quoted}'))
        self.log.append(f'point {path_of(node)} at {ref}')

    def apply(self) -> str:
        text = self.doc.text
        for e in sorted(self.edits, key=lambda e: (e.start, e.end), reverse=True):
            text = text[:e.start] + e.text + text[e.end:]
        self.edits.clear()
        return text


def path_of(node: Node) -> str:
    parts = []
    n = node
    while n is not None and n.parent is not None:
        parts.append(' '.join(n.words) or '?')
        n = n.parent
    return ' / '.join(reversed(parts))
