"""TireTune UI server (Python 3.11+, standard library only).

Started by the Workbench plugin:
    python serve.py --session <tool>/ui/state/session.json --app

Without Workbench (development, or a quick look at a stock vehicle):
    python serve.py --dev-dump <unpacked game data> --dev-addon <your addon> --prefab Prefabs/.../Car.et

The plugin writes session.json (the prefab, the creator's writable addons, the texts of read-only parents and
configs it read through Workbench, and Workbench-resolved values to cross-check). Edits are written straight into
the prefab / owned configs as text; Workbench is then asked over the Net API to register + reload them.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from tt import lint as lintmod  # noqa: E402
from tt import netapi  # noqa: E402
from tt.enftext import ref_path  # noqa: E402
from tt.model import Workspace, load_vehicle, describe, plan_apply, commit, VehicleError, Resolver  # noqa: E402
import difflib  # noqa: E402

STATIC = HERE / 'static'
STATE = HERE / 'state'
# backups must live OUTSIDE every addon: Workbench scans all folders of a loaded addon and would register backup
# .et/.conf copies as duplicate resources (same GUIDs)
BACKUPS = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'TireTune' / 'backups'
PRESET_PATHS = [
    'Prefabs/Vehicles/Core/Configs/Pacejka/Pacejka2002_base.conf',
    'Prefabs/Vehicles/Core/Configs/Pacejka/Pacejka2002_Car_80s.conf',
    'Prefabs/Vehicles/Core/Configs/Pacejka/Pacejka2002_MilitaryVehicle_80s.conf',
    'Prefabs/Vehicles/Core/Configs/Pacejka/Pacejka2002_Truck_80s.conf',
    'Prefabs/Vehicles/Wheeled/M151A2/Configs/Pacejka2002_M151A2.conf',
]


class App:
    def __init__(self, args):
        self.args = args
        self.lock = threading.RLock()
        self.session_path = Path(args.session) if args.session else STATE / 'session.json'
        self.session_mtime = 0.0
        self.session: dict = {}
        self.ws: Workspace | None = None
        self.vehicle = None
        self.desc: dict | None = None
        self.error = ''
        self.stamp = 0
        self.reload()

    # --- session ---------------------------------------------------------------------------------------------
    def _read_session(self) -> dict:
        a = self.args
        if a.dev_dump or a.dev_addon:
            s = {'prefab': a.prefab, 'addons': [], 'files': {}, 'wb': {}, 'source': 'dev'}
            for root in a.dev_addon or []:
                s['addons'].append({'id': Path(root).name, 'root': root})
            return s
        if not self.session_path.is_file():
            return {}
        try:
            return json.loads(self.session_path.read_text(encoding='utf-8'))
        except ValueError as e:
            raise ValueError(f'session.json is incomplete ({e}). Open the vehicle again from Plugins > TireTune; '
                             'if it repeats, check the Workbench console for a TireTune script error.') from e

    def reload(self, prefab: str | None = None) -> None:
        with self.lock:
            try:
                if self.session_path.is_file():
                    self.session_mtime = self.session_path.stat().st_mtime
                s = self._read_session()
                if prefab:
                    s['prefab'] = prefab
                self.session = s
                roots = [x['root'] for x in s.get('addons', [])]
                extra = [self.args.dev_dump] if self.args.dev_dump else []
                self.ws = Workspace(s.get('files') or {}, roots, extra)
                self.error = ''
                self.vehicle = self.desc = None
                if s.get('prefab'):
                    self.vehicle = load_vehicle(self.ws, s['prefab'])
                    self.desc = describe(self.vehicle, self.ws)
            except (VehicleError, OSError, ValueError) as e:
                self.error = str(e)
            self.stamp += 1

    def maybe_reload(self) -> None:
        if self.session_path.is_file() and self.session_path.stat().st_mtime != self.session_mtime:
            self.reload()

    def target_root(self) -> str:
        """Addon a new config goes into: the one holding the prefab."""
        p = self.ws.abs_path(self.desc['prefab']) if self.desc else None
        if p is not None:
            for a in self.session.get('addons', []):
                if str(p).replace('\\', '/').lower().startswith(a['root'].replace('\\', '/').lower().rstrip('/') + '/'):
                    return a['root']
        addons = self.session.get('addons') or [{}]
        return addons[0].get('root', '')

    # --- geometry ----------------------------------------------------------------------------------------------
    def geo_path(self) -> Path:
        key = re.sub(r'[^A-Za-z0-9_.-]+', '_', self.desc['prefab']) if self.desc else 'none'
        return STATE / 'geometry' / f'{key}.json'

    def geometry(self) -> dict:
        p = self.geo_path()
        if p.is_file():
            try:
                g = json.loads(p.read_text(encoding='utf-8'))
                if len(g.get('axles', [])) == len(self.desc['axles']):
                    return g
            except ValueError:
                pass
        g = self.estimate_geometry()
        self.save_geometry(g)
        return g

    def estimate_geometry(self) -> dict:
        """No captured wheel positions yet: spread the axles over a plausible wheelbase around the CoM."""
        axles = self.desc['axles']
        n = max(1, len(axles))
        r = axles[0]['Wheel']['fields']['Radius']['value'] or 0.35 if axles else 0.35
        mass = self.desc['rigidBody']['Mass']['value'] or 1500
        wheelbase = 2.3 + min(2.2, mass / 4000.0) if n == 2 else 1.4 * (n - 1) + 2.0
        track = 1.45 + min(0.6, mass / 12000.0)
        # anchored on the prefab origin (not the CoM, which is being tuned) and saved on first use, so moving the
        # CoM moves weight between the axles instead of dragging the guessed axles along with it
        front = wheelbase * (0.5 if n <= 2 else 0.6)
        out = []
        for i in range(n):
            if n == 1:
                z = 0.0
            elif n == 2:
                z = front - wheelbase * i
            else:    # trucks: steer axle in front, the others as a rear tandem / tridem
                z = front - (0 if i == 0 else wheelbase * (0.8 + 0.2 * (i - 1) / (n - 2)))
            out.append({'z': round(z, 3), 'track': round(track, 3), 'y': round(r, 3)})
        return {'axles': out, 'groundY': 0.0, 'source': 'estimate'}

    def save_geometry(self, g: dict) -> None:
        p = self.geo_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(g, indent=1), encoding='utf-8')

    # --- presets -----------------------------------------------------------------------------------------------
    def presets(self) -> list[dict]:
        res = Resolver(self.ws.load)
        out = []
        for path in self.session.get('presets') or PRESET_PATHS:   # the plugin searches the installed build
            try:
                o = res.resolve_file(path)
            except ValueError:
                continue
            if o is None or o.cls != 'Pacejka2002' or not o.slots:
                continue
            coeff = {}
            for k in ('NominalLoad', 'NominalRadius'):
                if o.num(k) is not None:
                    coeff[k] = o.num(k)
            for slot in o.slots.values():
                for k in slot.props:
                    if not k.startswith('__'):
                        coeff[k] = slot.num(k)
            out.append({'name': Path(path).stem.replace('Pacejka2002_', ''), 'path': path, 'coeff': coeff})
        return out

    # --- payload -------------------------------------------------------------------------------------------------
    def payload(self) -> dict:
        with self.lock:
            out = {'stamp': self.stamp, 'error': self.error, 'source': self.session.get('source', 'workbench'),
                   'addons': [a.get('id') for a in self.session.get('addons', [])], 'wbPort': self.args.wb_port}
            if self.desc:
                geo = self.geometry()
                wb = self.session.get('wb') or {}
                from tt.model import AXLE_FIELDS
                for key, names in self.engine_fields().items():
                    ai, obj = int(key.split('.')[0][4:]), key.split('.')[1]
                    if ai >= len(self.desc['axles']) or obj not in AXLE_FIELDS or obj not in self.desc['axles'][ai]:
                        continue
                    fields = self.desc['axles'][ai][obj]['fields']
                    res = self.vehicle.axles[ai].slots.get(obj)
                    for n in sorted(names - set(AXLE_FIELDS[obj])):
                        if n not in fields and isinstance(wb.get(f'{key}.{n}'), (int, float)):
                            fields[n] = {'value': res.num(n) if res else None, 'src': res.src.get(n, '') if res else '', 'engine': True}
                out.update({'vehicle': self.desc, 'geometry': geo, 'presets': self.presets(),
                            'lint': lintmod.checks(self.desc, geo), 'wbMismatch': annotate_wb(self.desc, wb),
                            'targetAddon': self.target_root()})
            return out

    def engine_fields(self) -> dict:
        """Numeric fields the running engine reported per object (session wb keys like axle0.Wheel.ABS_Slip_Threshold)."""
        out: dict = {}
        for k in (self.session.get('wb') or {}):
            parts = k.split('.')
            if len(parts) == 3 and parts[0].startswith('axle'):
                out.setdefault(f'{parts[0]}.{parts[1]}', set()).add(parts[2])
        return out

    def plan(self, edits: dict):
        w = plan_apply(self.ws, self.vehicle, edits, self.target_root(), self.engine_fields())
        files = []
        for path, text in w.texts.items():
            old = '' if path in w.created else (self.ws.load(path) or '')
            diff = ''.join(difflib.unified_diff(old.splitlines(True), (text + ('\n' if path in w.created else '')).splitlines(True),
                                                 'a/' + path, 'b/' + path, n=2))
            files.append({'path': path, 'new': path in w.created, 'diff': diff})
        return w, files

    def reimport(self, changed: list[str], created: list[str]) -> dict:
        """Ask Workbench (Net API handler TT_NetApi) to register new files and reload changed ones. When the Net
        API is off, queue them for the plugin's Reimport button."""
        try:
            r = netapi.call('TT_NetApi', {'op': 'reimport', 'changed': changed, 'created': created}, self.args.wb_port)
            return {'ok': r.get('status') == 'OK', 'via': 'netapi', 'reply': r}
        except OSError as e:
            q = STATE / 'pending.json'
            data = {'changed': [], 'created': []}
            if q.is_file():
                try:
                    data = json.loads(q.read_text(encoding='utf-8'))
                except ValueError:
                    pass
            data['changed'] = sorted(set(data.get('changed', [])) | set(changed))
            data['created'] = sorted(set(data.get('created', [])) | set(created))
            q.parent.mkdir(parents=True, exist_ok=True)
            q.write_text(json.dumps(data, indent=1), encoding='utf-8')
            return {'ok': False, 'via': 'queue', 'reason': f'Net API not reachable ({e}); press Reimport in the plugin'}


def annotate_wb(desc: dict, wb: dict) -> list[dict]:
    """Attach Workbench-resolved values (session "wb", BaseContainer API) to every described field as `wb`, so the
    UI can show engine defaults for values the text leaves unset. Returns fields where the text resolution and
    Workbench disagree (a resolver bug or a file changed since the session was written)."""
    if not wb:
        return []
    mismatch = []

    def visit(field: dict, key: str):
        if key not in wb:
            return
        w = wb[key]
        field['wb'] = w
        v = field.get('value')
        if v is None:
            return
        a = v if isinstance(v, list) else [v]
        b = w if isinstance(w, list) else [w]
        try:
            if len(a) != len(b) or any(abs(float(x) - float(y)) > 1e-4 * max(1.0, abs(float(y))) for x, y in zip(a, b)):
                mismatch.append({'key': key, 'text': v, 'workbench': w})
        except (TypeError, ValueError):
            pass

    for k, f in desc['rigidBody'].items():
        visit(f, f'rigidBody.{k}')
    for k, f in desc['sim'].items():
        visit(f, f'sim.{k}')
    for i, a in enumerate(desc['axles']):
        for k, f in a['props'].items():
            visit(f, f'axle{i}.{k}')
        for obj in ('Suspension', 'Wheel', 'Tyre', 'Steering', 'Swaybar'):
            for k, f in a.get(obj, {}).get('fields', {}).items():
                visit(f, f'axle{i}.{obj}.{k}')
    pj = desc.get('pacejka')
    if pj:
        for k, f in pj['top'].items():
            visit(f, f'tyre.{k}')
        for g, gv in pj['groups'].items():
            for k, f in gv['fields'].items():
                visit(f, f'tyre.{g}.{k}')
    return mismatch


APP: App | None = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _send(self, code, payload, ctype='application/json'):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/session':
            APP.maybe_reload()
            return self._send(200, APP.payload())
        if url.path == '/api/stamp':
            APP.maybe_reload()
            return self._send(200, {'stamp': APP.stamp, 'session': str(APP.session_path.resolve()),
                                    'dev': bool(APP.args.dev_dump or APP.args.dev_addon)})
        if url.path == '/api/live':
            try:
                return self._send(200, netapi.call('TT_NetApi', {'op': 'telemetry', 'prefab': APP.desc['prefab'] if APP.desc else ''},
                                                   APP.args.wb_port, timeout=2))
            except OSError as e:
                return self._send(200, {'status': 'offline', 'message': str(e)})
        if url.path == '/api/vehicles':
            return self._send(200, list_vehicles(APP))
        rel = url.path.lstrip('/') or 'index.html'
        p = (STATIC / rel).resolve()
        if not str(p).startswith(str(STATIC.resolve())) or not p.is_file():
            return self._send(404, {'error': 'not found'})
        ctype = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                 '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}.get(p.suffix, 'application/octet-stream')
        return self._send(200, p.read_bytes(), ctype)

    def do_POST(self):
        url = urlparse(self.path)
        try:
            body = self._body()
            if url.path == '/api/preview':
                with APP.lock:
                    _, files = APP.plan(body.get('edits') or {})
                return self._send(200, {'files': files})
            if url.path == '/api/apply':
                with APP.lock:
                    w, files = APP.plan(body.get('edits') or {})
                    if not files:
                        return self._send(200, {'files': [], 'message': 'Nothing changed.'})
                    res = commit(APP.ws, w, APP.target_root(), str(BACKUPS))
                    res['reimport'] = APP.reimport(res['changed'], res['created'])
                    APP.reload()
                return self._send(200, res)
            if url.path == '/api/geometry':
                with APP.lock:
                    APP.save_geometry(body)
                return self._send(200, {'ok': True})
            if url.path == '/api/capture':
                r = netapi.call('TT_NetApi', {'op': 'geometry', 'prefab': APP.desc['prefab']}, APP.args.wb_port, timeout=5)
                return self._send(200, r)
            if url.path == '/api/open':
                APP.reload(prefab=body.get('prefab'))
                return self._send(200, {'ok': not APP.error, 'error': APP.error})
            if url.path == '/api/reimport':
                return self._send(200, APP.reimport(body.get('changed') or [], body.get('created') or []))
        except VehicleError as e:
            return self._send(400, {'error': str(e)})
        except OSError as e:
            return self._send(200, {'status': 'offline', 'error': str(e)})
        return self._send(404, {'error': 'not found'})


def list_vehicles(app: App) -> list[dict]:
    """Prefabs in the writable addons that look like vehicles (root object 'Vehicle')."""
    out = []
    for a in app.session.get('addons', []):
        root = Path(a['root'])
        base = root / 'Prefabs'
        if not base.is_dir():
            continue
        for p in base.rglob('*.et'):
            try:
                with p.open(encoding='utf-8', errors='replace') as fh:
                    head = fh.readline()
            except OSError:
                continue
            if head.lstrip('\ufeff').startswith('Vehicle'):     # Workbench may save with a UTF-8 BOM
                out.append({'addon': a.get('id'), 'path': p.relative_to(root).as_posix()})
            if len(out) > 400:
                return out
    return out


def same_tiretune(port: int, session: Path, dev: bool) -> bool:
    """True when the server on `port` is TireTune serving this same session (so it can simply be reused). A dev
    server or one serving another session is never reused: the plugin's vehicle would not be the one shown."""
    import urllib.request
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/stamp', timeout=1.5) as r:
            info = json.loads(r.read() or b'{}')
    except (OSError, ValueError):
        return False
    if 'stamp' not in info or dev or info.get('dev'):
        return False
    return Path(info.get('session', '')).resolve() == session.resolve()


def open_window(url: str) -> None:
    """An app-style window (Edge/Chrome --app) when available, else the default browser."""
    candidates = [
        os.path.expandvars(r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe'),
        os.path.expandvars(r'%ProgramFiles%\Microsoft\Edge\Application\msedge.exe'),
        os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
        os.path.expandvars(r'%LocalAppData%\Google\Chrome\Application\chrome.exe'),
    ]
    for exe in candidates:
        if os.path.isfile(exe):
            subprocess.Popen([exe, f'--app={url}', '--window-size=1480,940'], close_fds=True)
            return
    webbrowser.open(url)


def main():
    global APP
    ap = argparse.ArgumentParser()
    ap.add_argument('--session')
    ap.add_argument('--port', type=int, default=0, help='default 8790 (8795 in dev mode)')
    ap.add_argument('--wb-port', type=int, default=5775)
    ap.add_argument('--app', action='store_true', help='open an app window')
    ap.add_argument('--dev-dump', help='unpacked game data root (read-only parents and configs)')
    ap.add_argument('--dev-addon', action='append', help='a writable addon folder (repeatable)')
    ap.add_argument('--prefab', help='prefab path to open in dev mode')
    args = ap.parse_args()
    if not args.port:
        args.port = 8795 if (args.dev_dump or args.dev_addon) else 8790
    APP = App(args)
    # One TireTune server per machine. Windows lets two sockets share a port when SO_REUSEADDR is set, so bind
    # exclusively; a busy port is reused only when it answers as TireTune (it picks up the new session.json itself).
    ThreadingHTTPServer.allow_reuse_address = False
    httpd = None
    for port in range(args.port, args.port + 10):
        try:
            httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            if same_tiretune(port, APP.session_path, bool(args.dev_dump or args.dev_addon)):
                if args.app:
                    open_window(f'http://127.0.0.1:{port}/')
                print(f'[TireTune] already running on {port}')
                return
    if httpd is None:
        sys.exit(f'[TireTune] no free port in {args.port}-{args.port + 9}')
    url = f'http://127.0.0.1:{httpd.server_address[1]}/'
    print(f'[TireTune] {url}  session={APP.session_path}  error={APP.error or "-"}', flush=True)
    if args.app:
        threading.Timer(0.3, open_window, [url]).start()
    httpd.serve_forever()


if __name__ == '__main__':
    main()
