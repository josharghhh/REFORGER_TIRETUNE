"""TireTune text engine tests. No Workbench needed.

    python -I ui/tests/test_model.py [--dump E:/DUMP-FORAI/1.9exp/data] [--apoc <ARGH_APOC_CARS addon>]

Synthetic tests always run. With --dump (unpacked 1.9 game data) it also parses every vehicle .et/.conf and runs
apply round trips on an inherited M151A2; with --apoc it edits a copy of Car06 (inline per-axle values).
"""
import argparse
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from tt.enftext import Doc, Patcher, fmt_num  # noqa: E402
from tt.model import Workspace, load_vehicle, describe, plan_apply, commit, VehicleError  # noqa: E402

FAILS = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


def test_synthetic():
    print('synthetic')
    t = 'Wheel {\n Radius 0.4\n Mass 38.6\n}\n'
    d = Doc(t)
    p = Patcher(d)
    p.set_prop(d.top, 'Radius', 0.45)
    p.set_prop(d.top, 'BrakeTorque', 1200)
    out = p.apply()
    check(out == 'Wheel {\n Radius 0.45\n Mass 38.6\n BrakeTorque 1200\n}\n', 'set + insert keeps layout')

    crlf = t.replace('\n', '\r\n')
    d = Doc(crlf)
    p = Patcher(d)
    p.set_prop(d.top, 'Tread', 0.5)
    out = p.apply()
    check('\r\n Tread 0.5\r\n}' in out and '\n\n' not in out.replace('\r\n', ''), 'CRLF preserved on insert')

    one = 'Axle "{AA}" {\n Wheel Wheel "{BB}" { Radius 0.62 Mass 38 BrakeTorque 900 }\n Type Locked\n}\n'
    d = Doc(one)
    w = d.top.child(key='Wheel')
    check(w is not None and w.one_liner and w.prop('Mass').strings() == ['38'], 'one-liner parsed')
    p = Patcher(d)
    p.set_prop(w, 'Mass', 40)
    p.set_prop(w, 'HandbrakeTorqueFactor', 2)
    out = p.apply()
    check('Wheel Wheel "{BB}" { Radius 0.62 Mass 40 BrakeTorque 900 HandbrakeTorqueFactor 2 }' in out, 'one-liner patched')
    check(Doc(out).top.prop('Type').strings() == ['Locked'], 'bare enum value read')

    check(fmt_num(0.1 + 0.2) == '0.3' and fmt_num(-0.0) == '0' and fmt_num(1e-5) == '0.00001', 'number format')
    hexy = Doc('X {\n IgnoreFlags 0x1c 0\n Name "a b" // c\n LOD {\n  4 2 1 0.1\n }\n}\n')
    check(hexy.top.prop('Name').strings() == ['"a b"'], 'comment stripped, quoted value kept')
    check([t.text for t in hexy.top.child(key='LOD').values[0]] == ['4', '2', '1', '0.1'], 'value rows')


def test_dump(dump: Path):
    print('dump parse smoke')
    n = bad = 0
    for p in list((dump / 'Prefabs/Vehicles').rglob('*.et')) + list((dump / 'Prefabs/Vehicles').rglob('*.conf')):
        n += 1
        try:
            Doc(p.read_text(encoding='utf-8', errors='replace'), str(p))
        except Exception as e:   # noqa: BLE001
            bad += 1
            if bad <= 5:
                print('   ', e)
    check(bad == 0, f'parsed {n} vehicle .et/.conf files, {bad} failed')

    print('dump M151A2 inherited prefab')
    tmp = Path(tempfile.mkdtemp(prefix='tt_test_'))
    try:
        addon = tmp / 'MyAddon'
        child = addon / 'Prefabs/Vehicles/M151A2_Tuned.et'
        child.parent.mkdir(parents=True)
        child.write_text('Vehicle : "{0ABD8CD4D1F28A33}Prefabs/Vehicles/Wheeled/M151A2/M151A2.et" {\n ID "5E1A0C7D2B3F4E01"\n}\n',
                         encoding='utf-8', newline='\n')
        ws = Workspace(addon_roots=[str(addon)], extra_roots=[str(dump)])
        v = load_vehicle(ws, 'Prefabs/Vehicles/M151A2_Tuned.et')
        before = describe(v, ws)
        check(before['writable'] and before['rigidBody']['Mass']['value'] == 1173, 'child resolves through M151A2')

        edits = {'rigidBody': {'Mass': 1250, 'CenterOfMass': [0, 0.65, 0.15]},
                 'axles': [{'Suspension': {'SpringRate': 44, 'CompressionDamper': 1600}},     # damper unchanged
                           {'Tyre': {'LateralFriction': 1.05}, 'TorqueShare': 0.6}],
                 'pacejka': {'NominalLoad': 3800, 'groups': {'Lateral': {'PCY1': 1.4}}}}
        w = plan_apply(ws, v, edits, str(addon))
        res = commit(ws, w, str(addon), str(tmp / 'backups'))
        text = child.read_text(encoding='utf-8')
        check(len(res['created']) == 1 and Path(res['created'][0] + '.meta').is_file(), 'new Pacejka conf + meta written')
        check('CompressionDamper' not in text, 'unchanged values are not written')
        check(Path(res['backup']).is_dir(), 'backup taken')

        ws2 = Workspace(addon_roots=[str(addon)], extra_roots=[str(dump)])
        after = describe(load_vehicle(ws2, 'Prefabs/Vehicles/M151A2_Tuned.et'), ws2)
        check(after['rigidBody']['Mass']['value'] == 1250, 'Mass round trip')
        check(after['axles'][0]['Suspension']['fields']['SpringRate']['value'] == 44, 'front SpringRate round trip')
        check(after['axles'][1]['Suspension']['fields']['SpringRate']['value'] == before['axles'][1]['Suspension']['fields']['SpringRate']['value'], 'rear SpringRate untouched')
        check(after['axles'][1]['Tyre']['fields']['LateralFriction']['value'] == 1.05, 'rear Tyre override round trip')
        check(after['axles'][1]['Tyre']['fields']['Tread']['value'] == before['axles'][1]['Tyre']['fields']['Tread']['value'], 'rear Tyre keeps conf values')
        check(after['axles'][0]['Tyre']['fields']['LateralFriction']['value'] == 1.0, 'front Tyre untouched')
        check(after['axles'][1]['props']['TorqueShare']['value'] == 0.6, 'TorqueShare round trip')
        pj = after['pacejka']
        check(pj['conf'].startswith('Configs/Vehicles/TireTune/'), 'TyreModel re-pointed to the new conf')
        check(pj['groups']['Lateral']['fields']['PCY1']['value'] == 1.4 and pj['top']['NominalLoad']['value'] == 3800, 'Pacejka changes round trip')
        check(pj['groups']['Lateral']['fields']['PDY1']['value'] == before['pacejka']['groups']['Lateral']['fields']['PDY1']['value'], 'other coefficients inherited')

        # second pass edits the now-owned conf in place and the prefab only where needed
        v2 = load_vehicle(ws2, 'Prefabs/Vehicles/M151A2_Tuned.et')
        w2 = plan_apply(ws2, v2, {'pacejka': {'groups': {'Lateral': {'PCY1': 1.35}}}}, str(addon))
        check(list(w2.texts) == [pj['conf']], 'owned conf edited in place, prefab untouched')
        commit(ws2, w2, str(addon), str(tmp / 'backups'))
        conf_text = (addon / pj['conf']).read_text(encoding='utf-8')
        check('PCY1 1.35' in conf_text and conf_text.count('PCY1') == 1, 'conf value replaced, not duplicated')

        print('    prefab after apply:\n' + '\n'.join('      ' + l for l in text.splitlines()))

        # refusing to write vanilla
        wsv = Workspace(extra_roots=[str(dump)])
        try:
            plan_apply(wsv, load_vehicle(wsv, 'Prefabs/Vehicles/Wheeled/M151A2/M151A2.et'), edits)
            check(False, 'vanilla prefab refused')
        except VehicleError:
            check(True, 'vanilla prefab refused')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_session(dump: Path):
    """The plugin's session.json contract: packed parents as embedded text, the creator's addon on disk, wb values."""
    print('session.json contract (as TT_Session writes it)')
    import json
    import serve
    tmp = Path(tempfile.mkdtemp(prefix='tt_sess_'))
    try:
        addon = tmp / 'MyAddon'
        child = addon / 'Prefabs/Vehicles/M151A2_Tuned.et'
        child.parent.mkdir(parents=True)
        child.write_text('Vehicle : "{0ABD8CD4D1F28A33}Prefabs/Vehicles/Wheeled/M151A2/M151A2.et" {\n ID "5E1A0C7D2B3F4E01"\n}\n', encoding='utf-8')
        files = {'Prefabs/Vehicles/M151A2_Tuned.et': {'writable': True, 'abs': str(child)}}
        # embed every packed text the resolver needs, as the plugin does
        res_ws = Workspace(addon_roots=[str(addon)], extra_roots=[str(dump)])
        v = load_vehicle(res_ws, 'Prefabs/Vehicles/M151A2_Tuned.et')
        for path in v.resolver.docs:
            if path not in files:
                files[path] = {'writable': False, 'text': (dump / path).read_text(encoding='utf-8')}
        for p in serve.PRESET_PATHS:
            files.setdefault(p, {'writable': False, 'text': (dump / p).read_text(encoding='utf-8')})
        wb = {'rigidBody.Mass': 1173, 'axle0.Suspension.SpringRate': 40, 'axle0.Suspension.RayStartOffsetUp': 0.25,
              'axle1.Tyre.LateralFriction': 0.95, 'tyre.Lateral.PCY1': 1.34}
        sess = tmp / 'session.json'
        sess.write_text(json.dumps({'version': 1, 'source': 'workbench', 'prefab': '{ABCDEF0123456789}Prefabs/Vehicles/M151A2_Tuned.et',
                                    'addons': [{'id': 'MyAddon', 'root': str(addon).replace('\\', '/')}], 'files': files, 'wb': wb}), encoding='utf-8')

        class A:
            session = str(sess); port = 0; wb_port = 1; app = False; dev_dump = None; dev_addon = None; prefab = None
        serve.STATE = tmp / 'state'
        app = serve.App(A)
        p = app.payload()
        check(not p['error'] and p['vehicle']['rigidBody']['Mass']['value'] == 1173, 'server resolves from embedded texts only')
        f = p['vehicle']['axles'][0]['Suspension']['fields']['RayStartOffsetUp']
        check(f['value'] is None and f['wb'] == 0.25, 'engine default attached from wb')
        check([m['key'] for m in p['wbMismatch']] == ['axle1.Tyre.LateralFriction'], 'text vs Workbench mismatch reported')
        check(len(p['presets']) == 5, 'stock presets from embedded texts')
        w, diff = app.plan({'axles': [{'Suspension': {'SpringRate': 45}}]})
        check(len(diff) == 1 and '+       SpringRate 45' in diff[0]['diff'], 'preview diff for the creator prefab')
        r = app.reimport(['x'], [])
        check(r['via'] == 'queue' and (serve.STATE / 'pending.json').is_file(), 'reimport queues when the Net API is off')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_apoc(apoc: Path, dump: Path | None):
    print('APOC Car06 copy (inline per-axle values)')
    tmp = Path(tempfile.mkdtemp(prefix='tt_apoc_'))
    try:
        rel = 'Prefabs/Vehicles/Wheeled/Car06/Car06_Base.et'
        dst = tmp / 'Apoc' / rel
        dst.parent.mkdir(parents=True)
        shutil.copyfile(apoc / rel, dst)
        original = dst.read_bytes()
        ws = Workspace(addon_roots=[str(tmp / 'Apoc')], extra_roots=[str(dump)] if dump else [])
        v = load_vehicle(ws, rel)
        d = describe(v, ws)
        check(d['axles'][0]['Wheel']['fields']['Radius']['value'] == 0.62, 'Car06 inline Radius read')
        w = plan_apply(ws, v, {'axles': [{'Suspension': {'SpringRate': 34}}, {'Tyre': {'LateralFriction': 1.2}}]})
        commit(ws, w, str(tmp / 'Apoc'), str(tmp / 'bak'))
        new = dst.read_bytes()
        diff = [(a, b) for a, b in zip(original.splitlines(), new.splitlines()) if a != b]
        check(len(original.splitlines()) == len(new.splitlines()) and len(diff) == 2, f'exactly 2 lines changed ({len(diff)})')
        for a, b in diff:
            print('      -', a.decode().strip(), ' +', b.decode().strip())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--dump')
    ap.add_argument('--apoc')
    a = ap.parse_args()
    test_synthetic()
    if a.dump:
        test_dump(Path(a.dump))
        test_session(Path(a.dump))
    if a.apoc:
        test_apoc(Path(a.apoc), Path(a.dump) if a.dump else None)
    print(f'\n{len(FAILS)} failure(s)')
    sys.exit(1 if FAILS else 0)
