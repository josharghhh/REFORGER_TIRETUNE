"""Vehicle model for TireTune: resolve a wheeled-vehicle prefab through its prefab + config inheritance, expose the
tunable chassis fields, and write changes back as minimal text patches.

Resolution rules (text side; the Workbench plugin's BaseContainer dump is the authority and is compared against this):
- A prefab or config starts from its ancestor (`: "{GUID}path"`), then applies its own values.
- Array items (`Axle "{id}"`, `RigidBody "{id}"`) merge with the inherited item of the same id.
- An object property (`Tyre Tyre "{id}" ...`) merges with the inherited object under the same key and id. If it
  re-points to another config (S105_rally does this for Tyre), it starts from that config instead.
"""
from __future__ import annotations

import copy
import json
import os
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .enftext import Doc, Node, Patcher, ParseError, fmt_value, ref_guid, ref_path, unquote

# Tunable fields per object, in the order the UI shows them. Names are the exact Enfusion property names
# (verified against 1.9 stock configs: Prefabs/Vehicles/Core/Configs and Wheeled/*/Configs).
AXLE_FIELDS = {
    'Suspension': ['MaxSteeringAngle', 'SpringRate', 'CompressionDamper', 'RelaxationDamper', 'MaxTravelUp',
                   'MaxTravelDown', 'RayStartOffsetUp'],
    'Wheel': ['Radius', 'Mass', 'Ratio', 'BrakeTorque', 'HandbrakeTorqueFactor'],
    'Tyre': ['Roughness', 'LongitudinalFriction', 'LateralFriction', 'RollingResistance', 'RollingDrag', 'Tread'],
    'Steering': ['SteeringRatio', 'PowerSteeringFactor', 'SteeringDamping', 'MechanicalTrail', 'ScrubRadius'],
    'Swaybar': ['Stiffness'],          # axle object (LAV25); only edited when the axle already has one
}
AXLE_PROPS = ['TorqueShare', 'HasHandbrake']
PACEJKA_GROUPS = {   # slot key -> class (Pacejka2002); ids are read from the resolved model, not assumed
    'Longitudinal': 'Pacejka2002Longitudinal',
    'Lateral': 'Pacejka2002Lateral',
    'CombinedLongitudinal': 'Pacejka2002CombinedLongitudinal',
    'CombinedLateral': 'Pacejka2002CombinedLateral',
    'Aligning': 'Pacejka2002Aligning',
}
PACEJKA_TOP = ['NominalLoad', 'NominalRadius']


# ------------------------------------------------------------------------------------------------------------------
@dataclass
class RObj:
    cls: str = ''
    name: str = ''
    key: str = ''
    header: str = ''                     # header text to write an override block (`Tyre Tyre "{id}"`)
    anc: str = ''                        # ancestor ref of the most-derived definition (`{GUID}path`)
    props: dict = field(default_factory=dict)       # key -> list[str]
    src: dict = field(default_factory=dict)         # key -> path of the file that set it
    slots: dict = field(default_factory=dict)       # key -> RObj
    arrays: dict = field(default_factory=dict)      # key -> list[RObj]

    def num(self, key: str):
        v = self.props.get(key)
        if not v:
            return None
        try:
            return float(v[0]) if len(v) == 1 else [float(x) for x in v]
        except ValueError:
            return ' '.join(v)

    def item(self, container: str, cls: str = '', name: str = ''):
        for it in self.arrays.get(container, []):
            if (not cls or it.cls == cls) and (not name or it.name == name):
                return it
        return None


def _header(node: Node) -> str:
    return ' '.join(node.words)


class Resolver:
    def __init__(self, loader: Callable[[str], str | None]):
        self.loader = loader
        self.docs: dict[str, Doc] = {}
        self.cache: dict[str, RObj] = {}
        self.missing: set[str] = set()

    def doc(self, path: str) -> Doc | None:
        path = ref_path(path)
        if path in self.docs:
            return self.docs[path]
        text = self.loader(path)
        if text is None:
            self.missing.add(path)
            return None
        d = Doc(text, path)
        self.docs[path] = d
        return d

    def resolve_file(self, ref: str) -> RObj | None:
        path = ref_path(ref)
        if path in self.cache:
            return copy.deepcopy(self.cache[path])
        d = self.doc(path)
        if d is None:
            return None
        obj = self.merge(None, d.top, path)
        self.cache[path] = obj
        return copy.deepcopy(obj)

    def merge(self, base: RObj | None, node: Node, path: str) -> RObj:
        if node.ancestor is not None and (base is None or ref_path(base.anc) != ref_path(node.ancestor_ref)):
            start = self.resolve_file(node.ancestor_ref) or RObj()
            start.anc = node.ancestor_ref
        else:
            start = copy.deepcopy(base) if base is not None else RObj()
        start.cls = node.cls or start.cls
        start.name = node.name or start.name
        start.key = node.key or start.key
        start.header = _header(node) if node.parent is not None and node.parent.parent is not None else start.header
        for p in node.props:
            start.props[p.name] = p.strings()
            start.src[p.name] = path
        for row in node.values:
            start.props.setdefault('__values', []).extend(t.text for t in row)
        for ch in node.children:
            if ch.is_container:
                key = ch.words[0]
                items = list(start.arrays.get(key, []))     # items always merge with inherited ones by id
                for it in ch.items():
                    idx = next((i for i, b in enumerate(items)
                                if b.cls == it.cls and (b.name == it.name or not it.name)), -1)
                    merged = self.merge(items[idx] if idx >= 0 else None, it, path)
                    if idx >= 0:
                        items[idx] = merged
                    else:
                        items.append(merged)
                start.arrays[key] = items
                for row in ch.values:
                    start.props.setdefault(key, [])
                    start.props[key] = [t.text for r in ch.values for t in r]
                    start.src[key] = path
            else:
                key = ch.key
                b = start.slots.get(key)
                same = b is not None and (not ch.name or not b.name or ch.name == b.name)
                start.slots[key] = self.merge(b if same else None, ch, path)
        return start


# ------------------------------------------------------------------------------------------------------------------
class Workspace:
    """Where resource texts come from and which of them may be written.

    sources: session texts from the Workbench plugin (`files`: path -> {text, abs, writable}), then the creator's
    addon folders on disk (writable when not packed), then read-only extra roots (unpacked game data, dev only).
    """

    def __init__(self, session_files: dict | None = None, addon_roots: list[str] | None = None,
                 extra_roots: list[str] | None = None):
        self.session = session_files or {}
        self.addon_roots = [Path(r) for r in (addon_roots or [])]
        self.extra_roots = [Path(r) for r in (extra_roots or [])]
        self.overlay: dict[str, str] = {}

    def abs_path(self, path: str) -> Path | None:
        path = ref_path(path)
        s = self.session.get(path)
        if s and s.get('abs'):
            return Path(s['abs'])
        for r in self.addon_roots:
            p = r / path
            if p.is_file():
                return p
        return None

    def writable(self, path: str) -> bool:
        path = ref_path(path)
        s = self.session.get(path)
        if s is not None and 'writable' in s:
            return bool(s['writable'])
        p = self.abs_path(path)
        return p is not None and not any(str(p).startswith(str(r)) for r in self.extra_roots)

    def load(self, path: str) -> str | None:
        path = ref_path(path)
        if path in self.overlay:
            return self.overlay[path]
        p = self.abs_path(path)
        if p is not None and p.is_file():
            return p.read_text(encoding='utf-8', errors='replace')
        s = self.session.get(path)
        if s and s.get('text') is not None:
            return s['text']
        for r in self.extra_roots:
            q = r / path
            if q.is_file():
                return q.read_text(encoding='utf-8', errors='replace')
        return None

    def guid_of(self, path: str) -> str:
        """GUID of a resource: from the session, else its .meta on disk."""
        path = ref_path(path)
        s = self.session.get(path)
        if s and s.get('guid'):
            return s['guid']
        p = self.abs_path(path)
        if p is not None:
            meta = Path(str(p) + '.meta')
            if meta.is_file():
                g = ref_guid(_meta_name(meta.read_text(encoding='utf-8', errors='replace')))
                if g:
                    return g
        return ''


def _meta_name(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('Name '):
            return unquote(line[5:].strip())
    return ''


# ------------------------------------------------------------------------------------------------------------------
@dataclass
class Vehicle:
    prefab: str
    root: RObj
    rigid: RObj | None
    sim_comp: RObj | None
    sim: RObj | None
    axles: list[RObj]
    tyre_model: RObj | None
    resolver: Resolver


class VehicleError(ValueError):
    pass


def load_vehicle(ws: Workspace, prefab_ref: str) -> Vehicle:
    res = Resolver(ws.load)
    root = res.resolve_file(prefab_ref)
    if root is None:
        raise VehicleError(f'cannot read {ref_path(prefab_ref)}')
    rigid = root.item('components', 'RigidBody')
    sim_comp = root.item('components', 'VehicleWheeledSimulation')
    if sim_comp is None:
        raise VehicleError(f'{ref_path(prefab_ref)} has no VehicleWheeledSimulation (not a wheeled vehicle?)')
    sim = sim_comp.slots.get('Simulation')
    axles = sim.arrays.get('Axles', []) if sim else []
    tm = sim.slots.get('TyreModel') if sim else None
    return Vehicle(ref_path(prefab_ref), root, rigid, sim_comp, sim, axles, tm, res)


def _src(obj: RObj | None, key: str) -> str:
    return obj.src.get(key, '') if obj else ''


def describe(v: Vehicle, ws: Workspace) -> dict:
    """JSON for the UI: every tunable value with where it comes from."""
    def fields(obj: RObj | None, names: list[str]) -> dict:
        out = {}
        for n in names:
            out[n] = {'value': obj.num(n) if obj else None, 'src': _src(obj, n)}
        return out

    axles = []
    for i, a in enumerate(v.axles):
        ax = {'id': a.name, 'index': i, 'props': fields(a, AXLE_PROPS), 'wheels': []}
        for wp in a.arrays.get('WheelPositions', []):
            ax['wheels'].append({'name': wp.name, 'pivot': unquote((wp.props.get('PivotID') or [''])[0])})
        for k, names in AXLE_FIELDS.items():
            o = a.slots.get(k)
            ax[k] = {'present': o is not None, 'conf': ref_path(o.anc) if o and o.anc else '',
                     'fields': fields(o, names)}
        axles.append(ax)

    tm = v.tyre_model
    pac = None
    if tm is not None:
        pac = {'class': tm.cls, 'id': tm.name, 'conf': ref_path(tm.anc) if tm.anc else '',
               'confWritable': bool(tm.anc) and ws.writable(tm.anc), 'top': fields(tm, PACEJKA_TOP), 'groups': {}}
        for key, slot in tm.slots.items():
            pac['groups'][key] = {'class': slot.cls, 'id': slot.name,
                                  'fields': {k: {'value': slot.num(k), 'src': slot.src.get(k, '')}
                                             for k in slot.props if not k.startswith('__')}}
    rigid = v.rigid
    return {
        'prefab': v.prefab,
        'writable': ws.writable(v.prefab),
        'parents': _parent_chain(v, ws),
        'rigidBody': fields(rigid, ['Mass', 'CenterOfMass']),
        'sim': fields(v.sim, ['InertiaOverrideEnabled', 'InertiaOverride']),
        'aero': fields(v.sim.slots.get('Aerodynamics') if v.sim else None, ['ReferenceArea', 'DragCoefficient']),
        'axles': axles,
        'pacejka': pac,
        'missing': sorted(v.resolver.missing),
    }


def _parent_chain(v: Vehicle, ws: Workspace) -> list[str]:
    out = []
    path = v.prefab
    seen = set()
    while path and path not in seen:
        seen.add(path)
        out.append(path)
        d = v.resolver.doc(path)
        if d is None or d.top.ancestor is None:
            break
        path = ref_path(d.top.ancestor_ref)
    return out


# ------------------------------------------------------------------------------------------------------------------
# Writing
@dataclass
class Step:
    kind: str          # 'item' (inside an array container) or 'slot' (object property)
    container: str     # container key for items
    header: str        # header to write when the block is missing
    cls: str
    name: str
    key: str


def _steps_sim(v: Vehicle) -> list[Step]:
    sc = v.sim_comp
    return [Step('item', 'components', f'{sc.cls} "{sc.name}"' if sc.name else sc.cls, sc.cls, sc.name, ''),
            Step('slot', '', v.sim.header, v.sim.cls, v.sim.name, 'Simulation')]


def _steps_axle(v: Vehicle, i: int) -> list[Step]:
    a = v.axles[i]
    return _steps_sim(v) + [Step('item', 'Axles', f'{a.cls} "{a.name}"' if a.name else a.cls, a.cls, a.name, '')]


def _slot_step(obj: RObj, key: str) -> Step:
    return Step('slot', '', obj.header or f'{key} {obj.cls}' + (f' "{obj.name}"' if obj.name else ''),
                obj.cls, obj.name, key)


def _find(node: Node, st: Step) -> Node | None:
    if st.kind == 'item':
        cont = next((c for c in node.children if c.is_container and c.words[0] == st.container), None)
        if cont is None:
            return None
        return next((it for it in cont.items() if it.cls == st.cls and (it.name == st.name or not st.name)), None)
    return next((c for c in node.children if not c.is_container and c.key == st.key
                 and (not st.name or not c.name or c.name == st.name)), None)


def _locate(doc: Doc, steps: list[Step]) -> tuple[Node, int]:
    node = doc.top
    for i, st in enumerate(steps):
        nxt = _find(node, st)
        if nxt is None:
            return node, i
        node = nxt
    return node, len(steps)


class Writer:
    """Accumulates text edits per file; every structural insert re-parses so later lookups see it."""

    def __init__(self, ws: Workspace):
        self.ws = ws
        self.texts: dict[str, str] = {}
        self.created: dict[str, str] = {}     # new files: path -> guid
        self.log: list[str] = []

    def text(self, path: str) -> str:
        path = ref_path(path)
        if path not in self.texts:
            t = self.ws.load(path)
            if t is None:
                raise VehicleError(f'cannot read {path}')
            self.texts[path] = t
        return self.texts[path]

    def ensure(self, path: str, steps: list[Step]) -> None:
        for _ in range(2 * len(steps) + 1):      # an item may need its container created first
            doc = Doc(self.text(path), path)
            node, i = _locate(doc, steps)
            if i == len(steps):
                return
            st = steps[i]
            p = Patcher(doc)
            if st.kind == 'item':
                cont = next((c for c in node.children if c.is_container and c.words[0] == st.container), None)
                if cont is None:
                    p.add_block(node, st.container)
                else:
                    p.add_block(cont, st.header)
            else:
                p.add_block(node, st.header)
            self.texts[path] = p.apply()
            self.log += [f'{path}: {line}' for line in p.log]
        raise VehicleError(f'{path}: could not create {steps}')

    def set(self, path: str, steps: list[Step], values: dict) -> int:
        if not values:
            return 0
        self.ensure(path, steps)
        doc = Doc(self.text(path), path)
        node, i = _locate(doc, steps)
        p = Patcher(doc)
        n = sum(1 for k, val in values.items() if p.set_prop(node, k, val))
        self.texts[path] = p.apply()
        self.log += [f'{path}: {line}' for line in p.log]
        return n

    def point(self, path: str, steps: list[Step], ref: str) -> None:
        self.ensure(path, steps)
        doc = Doc(self.text(path), path)
        node, _ = _locate(doc, steps)
        if ref_path(node.ancestor_ref) == ref_path(ref) and node.ancestor is not None:
            return
        p = Patcher(doc)
        p.set_ancestor(node, ref)
        self.texts[path] = p.apply()
        self.log += [f'{path}: {line}' for line in p.log]

    def create(self, path: str, text: str) -> str:
        guid = '%016X' % random.getrandbits(64)
        self.texts[ref_path(path)] = text
        self.created[ref_path(path)] = guid
        self.log.append(f'{path}: new file {{{guid}}}')
        return guid


def _changed(current, new) -> bool:
    if new is None:
        return False
    if current is None:
        return True
    if isinstance(new, (list, tuple)):
        return not isinstance(current, list) or len(current) != len(new) or \
            any(abs(float(a) - float(b)) > 1e-9 for a, b in zip(current, new))
    try:
        return abs(float(current) - float(new)) > 1e-9
    except (TypeError, ValueError):
        return str(current) != str(new)


def plan_apply(ws: Workspace, v: Vehicle, edits: dict, target_addon_root: str = '') -> Writer:
    """Turn UI edits into text edits. Only values that differ from the resolved vehicle are written.

    edits = {rigidBody: {Mass, CenterOfMass}, sim: {...}, axles: [{TorqueShare, Suspension: {...}, ...}],
             pacejka: {NominalLoad, NominalRadius, groups: {Lateral: {PCY1: ..}}}, pacejkaTarget: inline|conf|new}
    """
    if not ws.writable(v.prefab):
        raise VehicleError(f'{v.prefab} is not in one of your writable addons (packed or vanilla). '
                           'Create an inherited prefab in your addon and tune that.')
    w = Writer(ws)
    et = v.prefab

    rb = edits.get('rigidBody') or {}
    vals = {k: val for k, val in rb.items() if _changed(v.rigid.num(k) if v.rigid else None, val)}
    if vals:
        r = v.rigid
        w.set(et, [Step('item', 'components', f'{r.cls} "{r.name}"' if r.name else r.cls, r.cls, r.name, '')], vals)

    simv = {k: val for k, val in (edits.get('sim') or {}).items() if _changed(v.sim.num(k), val)}
    if simv:
        w.set(et, _steps_sim(v), simv)

    for i, ae in enumerate(edits.get('axles') or []):
        if i >= len(v.axles):
            break
        a = v.axles[i]
        top = {k: val for k, val in ae.items() if k in AXLE_PROPS and _changed(a.num(k), val)}
        if top:
            w.set(et, _steps_axle(v, i), top)
        for key in AXLE_FIELDS:
            obj = a.slots.get(key)
            if obj is None or not ae.get(key):
                continue
            ch = {k: val for k, val in ae[key].items() if k in AXLE_FIELDS[key] and _changed(obj.num(k), val)}
            if ch:
                w.set(et, _steps_axle(v, i) + [_slot_step(obj, key)], ch)

    pe = edits.get('pacejka') or {}
    if pe and v.tyre_model is not None:
        _apply_pacejka(ws, v, w, pe, edits.get('pacejkaTarget') or 'auto', target_addon_root)
    return w


def _pacejka_changes(tm: RObj, pe: dict) -> tuple[dict, dict]:
    top = {k: pe[k] for k in PACEJKA_TOP if k in pe and _changed(tm.num(k), pe[k])}
    groups = {}
    for gk, gv in (pe.get('groups') or {}).items():
        slot = tm.slots.get(gk)
        if slot is None:
            continue
        ch = {k: val for k, val in gv.items() if _changed(slot.num(k), val)}
        if ch:
            groups[gk] = ch
    return top, groups


def _apply_pacejka(ws: Workspace, v: Vehicle, w: Writer, pe: dict, target: str, addon_root: str) -> None:
    tm = v.tyre_model
    top, groups = _pacejka_changes(tm, pe)
    if not top and not groups:
        return
    tm_steps = _steps_sim(v) + [_slot_step(tm, 'TyreModel')]
    owned = bool(tm.anc) and ws.writable(tm.anc)
    if target == 'auto':
        target = 'conf' if owned else 'new'
    if target == 'conf' and not owned:
        target = 'new'
    if target == 'inline':
        w.set(v.prefab, tm_steps, top)
        for gk, ch in groups.items():
            w.set(v.prefab, tm_steps + [_slot_step(tm.slots[gk], gk)], ch)
        return
    if target == 'conf':
        conf = ref_path(tm.anc)
        w.set(conf, [], top)
        for gk, ch in groups.items():
            w.set(conf, [_slot_step(tm.slots[gk], gk)], ch)
        return
    # new config next to the prefab's addon, inheriting the current one
    stem = Path(v.prefab).stem
    rel = f'Configs/Vehicles/TireTune/{stem}_{tm.cls}.conf'
    parent = tm.anc if tm.anc else ''
    lines = [f'{tm.cls}' + (f' : "{parent}"' if parent else '') + ' {']
    for k, val in top.items():
        lines.append(f' {k} {fmt_value(val)}')
    for gk, ch in groups.items():
        slot = tm.slots[gk]
        lines.append(f' {slot.header or gk} {{')
        for k, val in ch.items():
            lines.append(f'  {k} {fmt_value(val)}')
        lines.append(' }')
    lines.append('}')
    if not parent:   # no ancestor: the new config must carry every coefficient, not only the changed ones
        raise VehicleError('TyreModel is fully inline in the prefab; use "inline" for this vehicle')
    guid = w.create(rel, '\n'.join(lines))
    w.point(v.prefab, tm_steps, f'{{{guid}}}{rel}')


META_CONF = '''MetaFileClass {{
 Name "{{{guid}}}{path}"
 Configurations {{
  CONFResourceClass PC {{
  }}
  CONFResourceClass XBOX_ONE : PC {{
  }}
  CONFResourceClass XBOX_SERIES : PC {{
  }}
  CONFResourceClass PS4 : PC {{
  }}
  CONFResourceClass PS5 : PC {{
  }}
  CONFResourceClass HEADLESS : PC {{
  }}
 }}
}}'''


def commit(ws: Workspace, w: Writer, target_addon_root: str, backup_dir: str) -> dict:
    """Write the planned texts. Existing files are backed up first (outside every addon). Returns paths for the
    Workbench side: `changed` (rebuild / reload) and `created` (register)."""
    stamp = time.strftime('%Y%m%d_%H%M%S')
    changed, created = [], []
    for path, text in w.texts.items():
        if path in w.created:
            dst = Path(target_addon_root) / path
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(text + '\n', encoding='utf-8', newline='\n')
            Path(str(dst) + '.meta').write_text(META_CONF.format(guid=w.created[path], path=path) + '\n',
                                                encoding='utf-8', newline='\n')
            created.append(str(dst))
            continue
        dst = ws.abs_path(path)
        if dst is None or not ws.writable(path):
            raise VehicleError(f'refusing to write {path}: not in a writable addon')
        old = dst.read_text(encoding='utf-8', errors='replace')
        if old == text:
            continue
        bak = Path(backup_dir) / stamp / path
        bak.parent.mkdir(parents=True, exist_ok=True)
        bak.write_text(old, encoding='utf-8', newline='')
        dst.write_text(text, encoding='utf-8', newline='')
        changed.append(str(dst))
    return {'changed': changed, 'created': created, 'backup': str(Path(backup_dir) / stamp), 'log': w.log}
