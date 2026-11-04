"""Chassis sanity checks on a described vehicle (model.describe output, with the UI's edits applied).

Values in Enfusion configs are engine units. The estimates here assume SpringRate in N/mm and dampers in N s/m,
which gives plausible numbers on every stock 1.9 vehicle (M151A2 front: about 1.9 Hz, damping ratio 0.23), but
they are estimates to compare setups against each other, not engine truth.
"""
from __future__ import annotations

import math

G = 9.81


def _v(f):
    return f.get('value') if isinstance(f, dict) else f


def static_loads(desc: dict, geo: dict) -> list[float]:
    """Static load per wheel (N) for each axle, from the CoM position along the axle positions (lever rule
    between the first axle and the mean of the others when there are more than two)."""
    mass = _v(desc['rigidBody']['Mass']) or 1500
    com = _v(desc['rigidBody']['CenterOfMass']) or [0, 0, 0]
    zs = [a['z'] for a in geo['axles']]
    n = len(zs)
    if n == 0:
        return []
    if n == 1:
        return [mass * G / 2]
    zf, zr = zs[0], sum(zs[1:]) / (n - 1)
    span = (zf - zr) or 1
    front_share = min(0.95, max(0.05, (com[2] - zr) / span))
    out = [mass * G * front_share / 2]
    out += [mass * G * (1 - front_share) / (n - 1) / 2] * (n - 1)
    return out


def checks(desc: dict, geo: dict) -> list[dict]:
    out = []

    def add(level, axle, title, detail):
        out.append({'level': level, 'axle': axle, 'title': title, 'detail': detail})

    axles = desc['axles']
    loads = static_loads(desc, geo)
    driven = [a for a in axles if (_v(a['props']['TorqueShare']) or 0) > 0]
    share = sum(_v(a['props']['TorqueShare']) or 0 for a in axles)
    if driven and abs(share - 1) > 0.02:
        add('warn', None, 'Torque shares do not add up to 1',
            f'Axle TorqueShare sums to {share:.2f}. Stock vehicles split 1.0 across the driven axles.')

    pac = desc.get('pacejka')
    for i, a in enumerate(axles):
        name = f'Axle {i + 1}'
        tyre = {k: _v(f) for k, f in a['Tyre']['fields'].items()}
        if not a['Tyre']['conf'] and all(v is None for v in tyre.values()):
            add('warn', i, f'{name}: Tyre uses engine defaults',
                'This axle\'s Tyre has no config and no values (stock Ural4320 axle 3 does this). '
                'Point it at the same Tyre config as the other axles unless the defaults are intended.')
        susp = {k: _v(f) for k, f in a['Suspension']['fields'].items()}
        wheel = {k: _v(f) for k, f in a['Wheel']['fields'].items()}
        fz = loads[i] if i < len(loads) else None
        k = susp.get('SpringRate')
        if fz and k:
            m = fz / G
            kn = k * 1000.0
            freq = math.sqrt(kn / m) / (2 * math.pi)
            sag = fz / kn
            travel = (susp.get('MaxTravelUp') or 0) + (susp.get('MaxTravelDown') or 0)
            if freq < 0.8:
                add('warn', i, f'{name}: very soft springs', f'Ride frequency about {freq:.2f} Hz (cars 1.0-2.5 Hz).')
            elif freq > 3.5:
                add('info', i, f'{name}: very stiff springs', f'Ride frequency about {freq:.2f} Hz (cars 1.0-2.5 Hz).')
            if travel and sag > travel * 0.8:
                add('error', i, f'{name}: springs too soft for the travel',
                    f'Static sag about {sag * 1000:.0f} mm against {travel * 1000:.0f} mm total travel: the axle '
                    'will sit on its bump stop. Raise SpringRate or travel.')
            c = susp.get('CompressionDamper')
            if c:
                zeta = c / (2 * math.sqrt(kn * m))
                if zeta < 0.1:
                    add('warn', i, f'{name}: under-damped', f'Damping ratio about {zeta:.2f} (0.2-0.5 is usual): bouncy.')
                elif zeta > 1.0:
                    add('warn', i, f'{name}: over-damped', f'Damping ratio about {zeta:.2f}: harsh, slow to settle.')
        r = wheel.get('Radius')
        if pac and r:
            nr = _v(pac['top']['NominalRadius'])
            if nr and abs(nr - r) / r > 0.15:
                add('warn', i, f'{name}: wheel radius differs from Pacejka NominalRadius',
                    f'Wheel Radius {r:.3f} m, tyre model NominalRadius {nr:.3f} m. The tyre model is shared by '
                    'every wheel; keep NominalRadius near the real tyre radius.')
        bt = wheel.get('BrakeTorque')
        if bt and r and fz:
            mu = 1.0
            if pac:
                mu = (_v(pac['groups'].get('Longitudinal', {}).get('fields', {}).get('PDX1', {})) or 1.0)
            mu *= tyre.get('LongitudinalFriction') or 1.0
            grip_torque = mu * fz * r
            ratio = bt / grip_torque if grip_torque else 0
            if ratio > 2.5:
                add('info', i, f'{name}: brakes lock easily',
                    f'Brake torque is {ratio:.1f}x what the tyre can hold at static load.')
            elif ratio < 0.6:
                add('info', i, f'{name}: brakes below tyre grip',
                    f'Brake torque reaches about {ratio:.0%} of peak tyre grip at static load (estimate; heavy '
                    'stock vehicles sit here too).')

    if pac and loads:
        nl = _v(pac['top']['NominalLoad'])
        avg = sum(loads) / len(loads)
        if nl and not 0.5 < avg / nl < 1.8:
            add('warn', None, 'Pacejka NominalLoad far from the wheel loads',
                f'NominalLoad {nl:.0f} N, average static wheel load {avg:.0f} N. Load-sensitive terms are '
                'centred on NominalLoad; heavy vehicles use a truck-class tyre model (Pacejka2002_Truck_80s).')
    com = _v(desc['rigidBody']['CenterOfMass'])
    if com and geo.get('axles') and geo.get('source') != 'estimate':
        track = min(a['track'] for a in geo['axles'])
        h = com[1] - geo.get('groundY', 0)
        if h > 0:
            ssf = track / (2 * h)
            if ssf < 1.0:
                add('warn', None, 'Rollover risk', f'Static stability factor {ssf:.2f} (track / 2 x CoM height); '
                    'below about 1.0 the vehicle tips before it slides on dry tarmac.')
    return out
