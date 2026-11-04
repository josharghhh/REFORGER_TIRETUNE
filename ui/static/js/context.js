// TireTune context: plain-language meaning and slider range for every Pacejka2002 coefficient, and the small live
// graph each setup card shows (spring vs load, damper vs critical damping, brake vs tyre grip, steering ratio, and
// one force graph per Pacejka group). Meanings follow the MF5.2 (Pacejka 2002) definitions the evaluator uses.
(() => {
  'use strict';
  const P = globalThis.TireLabPhysics, S = globalThis.TireTuneSim;
  const DEG = Math.PI / 180;

  // key: [label, what it does]; group decides which graph shows it
  const PAC_META = {
    NominalLoad: ['Nominal load', 'The wheel load (N) every other coefficient is measured at. Keep it near the real static wheel load.'],
    NominalRadius: ['Nominal radius', 'Tyre reference radius (m). Keep it near the wheel Radius.'],
    PCX1: ['Shape', 'How peaky the drive/brake curve is. Higher: force drops off more after the peak.'],
    PDX1: ['Peak grip', 'Peak drive/brake friction (mu) at nominal load. The height of the curve.'],
    PDX2: ['Grip vs load', 'How peak grip changes with load. Negative: heavier wheels grip relatively less.'],
    PEX1: ['Curvature', 'Shape of the knee near the peak. Lower: sharper peak, more abrupt breakaway.'],
    PEX2: ['Curvature vs load', 'How the knee changes with load.'],
    PEX3: ['Curvature vs load²', 'Second-order load effect on the knee.'],
    PEX4: ['Drive/brake asymmetry', 'Makes braking and driving curves differ.'],
    PKX1: ['Slip stiffness', 'Initial slope: how much force a little wheel slip makes. Higher: crisper throttle/brake response.'],
    PKX2: ['Slip stiffness vs load', 'How the initial slope changes with load.'],
    PKX3: ['Slip stiffness load curve', 'Exponential load effect on the slope.'],
    PHX1: ['Horizontal shift', 'Shifts the curve along slip (small offsets, conicity).'],
    PHX2: ['Horizontal shift vs load', 'Load effect on that shift.'],
    PVX1: ['Vertical shift', 'Force offset at zero slip.'],
    PVX2: ['Vertical shift vs load', 'Load effect on that offset.'],
    PCY1: ['Shape', 'How peaky the cornering curve is. Higher: grip falls away more after the limit (snappier).'],
    PDY1: ['Peak grip', 'Peak cornering friction (mu) at nominal load. The height of the curve: overall cornering grip.'],
    PDY2: ['Grip vs load', 'How cornering grip changes with load. Negative: weight transfer costs grip (real tyres); BI stock is positive.'],
    PDY3: ['Grip vs camber²', 'Camber effect on peak grip.'],
    PEY1: ['Curvature', 'Shape of the knee near the limit. Lower: more abrupt breakaway.'],
    PEY2: ['Curvature vs load', 'How the knee changes with load.'],
    PEY3: ['Curvature asymmetry', 'Left/right difference in the knee.'],
    PEY4: ['Curvature vs camber', 'Camber effect on the knee.'],
    PKY1: ['Cornering stiffness', 'Initial slope (more negative = sharper turn-in, less slip for the same force).'],
    PKY2: ['Stiffness peak load', 'Load (x nominal) where cornering stiffness is highest.'],
    PKY3: ['Stiffness vs camber', 'Camber effect on cornering stiffness.'],
    PHY1: ['Horizontal shift', 'Shifts the cornering curve along slip angle (pull to one side).'],
    PHY2: ['Horizontal shift vs load', 'Load effect on that shift.'],
    PHY3: ['Horizontal shift vs camber', 'Camber effect on that shift.'],
    PVY1: ['Vertical shift', 'Side force at zero slip angle (pull).'],
    PVY2: ['Vertical shift vs load', 'Load effect on that pull.'],
    PVY3: ['Vertical shift vs camber', 'Camber thrust.'],
    PVY4: ['Vertical shift vs camber & load', 'Load effect on camber thrust.'],
    RBX1: ['Drive loss while cornering', 'How fast drive/brake force drops when the tyre also has slip angle. Higher: less traction mid-corner.'],
    RBX2: ['...vs slip ratio', 'How that drop changes with wheel slip.'],
    RCX1: ['Shape', 'Shape of the drive-force reduction.'],
    REX1: ['Curvature', 'Curvature of the drive-force reduction.'],
    REX2: ['Curvature vs load', 'Load effect on that curvature.'],
    RHX1: ['Shift', 'Slip-angle shift of the reduction.'],
    RBY1: ['Corner loss while braking', 'How fast cornering force drops under brake/throttle slip. Higher: trail-braking pushes wide sooner.'],
    RBY2: ['...vs slip angle', 'How that drop changes with slip angle.'],
    RBY3: ['...shift', 'Slip-angle shift inside that term.'],
    RCY1: ['Shape', 'Shape of the cornering-force reduction.'],
    REY1: ['Curvature', 'Curvature of the cornering-force reduction.'],
    REY2: ['Curvature vs load', 'Load effect on that curvature.'],
    RHY1: ['Shift', 'Slip-ratio shift of the reduction.'],
    RVY1: ['Slip-induced side force', 'Side force created by drive/brake slip while cornering.'],
    RVY2: ['...vs load', 'Load effect.'],
    RVY3: ['...vs camber', 'Camber effect.'],
    RVY4: ['...vs slip angle', 'Slip-angle effect.'],
    RVY5: ['...shape', 'Shape over slip ratio.'],
    RVY6: ['...slip factor', 'Slip-ratio factor.'],
    QBZ1: ['Trail slope', 'How quickly pneumatic trail builds: steering weight as you turn in.'],
    QBZ2: ['Trail slope vs load', 'Load effect.'], QBZ3: ['Trail slope vs load²', 'Second-order load effect.'],
    QBZ4: ['Trail slope vs camber', 'Camber effect.'], QBZ5: ['Trail slope vs |camber|', 'Camber magnitude effect.'],
    QBZ6: ['Trail slope (MF6)', 'Kept and written, not used by the preview.'], QBZ7: ['Trail slope (MF6)', 'Kept and written, not used by the preview.'],
    QBZ8: ['Trail slope (MF6)', 'Kept and written, not used by the preview.'],
    QBZ9: ['Residual torque slope', 'Slope of the residual aligning torque.'], QBZ10: ['Residual slope x cornering', 'Residual slope scaled by cornering stiffness.'],
    QCZ1: ['Trail shape', 'Shape of the aligning torque curve: how fast steering goes light at the limit.'],
    QDZ1: ['Peak trail', 'Peak pneumatic trail: overall steering weight / self-centring.'],
    QDZ2: ['Peak trail vs load', 'Load effect.'], QDZ3: ['Peak trail vs camber', 'Camber effect.'], QDZ4: ['Peak trail vs camber²', 'Camber² effect.'],
    QDZ6: ['Residual torque', 'Peak residual aligning torque.'], QDZ7: ['Residual vs load', 'Load effect.'],
    QDZ8: ['Residual vs camber', 'Camber effect.'], QDZ9: ['Residual vs camber & load', 'Camber and load effect.'],
    QDZ10: ['Residual (MF6)', 'Kept and written, not used by the preview.'], QDZ11: ['Residual (MF6)', 'Kept and written, not used by the preview.'],
    QEZ1: ['Trail curvature', 'Knee of the aligning torque curve.'], QEZ2: ['...vs load', 'Load effect.'], QEZ3: ['...vs load²', 'Second-order load effect.'],
    QEZ4: ['...asymmetry', 'Left/right difference.'], QEZ5: ['...vs camber', 'Camber effect.'],
    QHZ1: ['Trail shift', 'Slip-angle shift of the trail.'], QHZ2: ['...vs load', 'Load effect.'], QHZ3: ['...vs camber', 'Camber effect.'], QHZ4: ['...vs camber & load', 'Camber and load effect.'],
    QSSZ1: ['Drive-force lever', 'Moment arm of drive/brake force on the steering.'], QSSZ2: ['...vs side force', 'Side-force effect.'],
    QSSZ3: ['...vs camber', 'Camber effect.'], QSSZ4: ['...vs camber & load', 'Camber and load effect.'],
  };

  // what each Pacejka group graph shows
  const GROUP_INFO = {
    Longitudinal: 'Drive / brake force vs wheel slip, at light, nominal and heavy load.',
    Lateral: 'Cornering force vs slip angle, at light, nominal and heavy load.',
    CombinedLongitudinal: 'Drive force at 10 % slip as the tyre also corners: how much traction cornering costs.',
    CombinedLateral: 'Cornering force at 6 degrees as the wheel also brakes/drives: how much grip braking costs.',
    Aligning: 'Self-aligning torque vs slip angle: steering weight, and how it goes light at the limit.',
    Reference: 'Peak cornering force vs wheel load: how grip scales as weight moves around.',
  };

  // slider range around the stock value: wide enough to explore, never a meaningless +-50
  function rangeFor(key, v) {
    const fixed = { NominalLoad: [300, 40000, 10], NominalRadius: [0.1, 1.2, 0.001], PDX1: [0.2, 2.5, 0.005], PDY1: [0.2, 2.5, 0.005],
      PCX1: [1, 2.5, 0.01], PCY1: [1, 2.5, 0.01], PKX1: [1, 60, 0.1], PKY1: [-60, -1, 0.1] };
    if (fixed[key]) return fixed[key];
    const a = Math.abs(v || 0), span = Math.max(a * 1.5, key.startsWith('Q') || key.startsWith('PH') || key.startsWith('PV') ? 0.05 : 0.5);
    const step = +(span / 200).toPrecision(2);
    return [+(v - span).toFixed(4), +(v + span).toFixed(4), step];
  }

  const LOADS = [[0.5, 'light', '#7fd3ff'], [1, 'nominal', '#4fb3ff'], [1.5, 'heavy', '#1f6fb8']];
  const range = (a, b, n, f) => { const out = []; for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; out.push([x, f(x)]); } return out; };

  // Pacejka group graph: returns {series, x0, x1, extra, opts}
  function pacGraph(group, cur, orig, preset) {
    const F0 = cur.NominalLoad || 4000;
    const fam = (c, ghost, fn, onlyNominal) => LOADS.filter(l => !onlyNominal || l[0] === 1).map(([k, name, col]) =>
      ({ name: ghost ? name + ' (orig)' : name, color: col, ghost, pts: fn(c, F0 * k) }));
    const kinds = {
      Longitudinal: { x0: 0, x1: 40, opts: { xLabel: 'WHEEL SLIP (%)', yLabel: 'kN', xUnit: '%' }, fn: (c, Fz) => range(0, 40, 50, s => P.forces(c, Fz, s / 100, 0, 0).Fx) },
      Lateral: { x0: 0, x1: 14, opts: { xLabel: 'SLIP ANGLE (deg)', yLabel: 'kN', xUnit: '°', xDigits: 1 }, fn: (c, Fz) => range(0, 14, 50, a => P.forces(c, Fz, 0, -a * DEG, 0).Fy) },
      CombinedLongitudinal: { x0: 0, x1: 14, opts: { xLabel: 'SLIP ANGLE (deg)', yLabel: 'kN', xUnit: '°', xDigits: 1 }, fn: (c, Fz) => range(0, 14, 40, a => P.forces(c, Fz, 0.1, -a * DEG, 0).Fx) },
      CombinedLateral: { x0: 0, x1: 40, opts: { xLabel: 'WHEEL SLIP (%)', yLabel: 'kN', xUnit: '%' }, fn: (c, Fz) => range(0, 40, 40, s => P.forces(c, Fz, -s / 100, -6 * DEG, 0).Fy) },
      Aligning: { x0: 0, x1: 14, opts: { xLabel: 'SLIP ANGLE (deg)', yLabel: 'N m', xUnit: '°', xDigits: 1, yDiv: 1, yUnit: 'Nm' }, fn: (c, Fz) => range(0, 14, 50, a => P.forces(c, Fz, 0, -a * DEG, 0).Mz) },
      Reference: { x0: 0, x1: 2 * F0 / 1000, opts: { xLabel: 'WHEEL LOAD (kN)', yLabel: 'kN', xUnit: ' kN', xDigits: 1 },
        fn: (c) => range(0.05, 2 * F0 / 1000, 30, kn => S.peakLateral({ coeff: c }, kn * 1000)), single: true },
    };
    const k = kinds[group];
    if (!k) return null;
    let series;
    if (k.single) {
      series = [{ name: 'original', color: '#93a4ba', ghost: true, pts: k.fn(orig) }, { name: 'peak grip', color: '#4fb3ff', pts: k.fn(cur) }];
      if (preset) series.unshift({ name: 'stock', color: '#7d8ea5', preset: true, pts: k.fn(preset) });
    } else {
      series = [...fam(orig, true, k.fn, true)];
      if (preset) series.push({ name: 'stock', color: '#7d8ea5', preset: true, pts: k.fn(preset, F0) });
      series.push(...fam(cur, false, k.fn));
    }
    const extra = k.single ? { vlines: [{ x: F0 / 1000, label: 'nominal', color: '#93a4ba' }] } : {};
    return { series, x0: k.x0, x1: k.x1, extra, opts: { ...k.opts, small: true, h: 210 } };
  }

  // Axle card graphs. a/ao: sim axle (current / original), Fz: static wheel load (N)
  function axleGraph(kind, a, ao, Fz, FzO, extra = {}) {
    if (!a) return null;
    if (kind === 'Suspension') {
      const travel = (a.travelUp + a.travelDown) * 1000, travelO = (ao.travelUp + ao.travelDown) * 1000;
      const xmax = Math.max(travel, travelO, Fz / a.spring * 1000, 20) * 1.25;
      const line = (ax, t) => range(0, xmax, 30, mm => ax.spring * mm / 1000);
      const sag = Fz / a.spring * 1000;
      return {
        series: [{ name: 'original', color: '#93a4ba', ghost: true, pts: line(ao) }, { name: 'spring', color: '#4fb3ff', pts: line(a) }],
        x0: 0, x1: xmax,
        extra: { bands: [{ x0: travel, x1: xmax, bad: true, label: 'past bump stop' }],
                 hlines: [{ y: Fz, label: 'static wheel load', color: '#f0b35a' }],
                 vlines: [{ x: sag, label: `sag ${sag.toFixed(0)} mm`, color: sag > travel * 0.8 ? '#ef6d78' : '#5ed6a0' }] },
        opts: { xLabel: 'COMPRESSION FROM FULL DROOP (mm)', yLabel: 'kN', xUnit: ' mm', small: true, h: 200 },
        note: 'Drag the blue dot to stiffen or soften the spring, the red one to move the bump stop. The spring line must meet the load line inside the travel.',
        handles: extra.set ? [
          { id: 'k', label: `${Math.round(a.spring / 1000)} N/mm`, color: '#4fb3ff', axis: 'y', x: xmax * 0.72, y: a.spring * xmax * 0.72 / 1000,
            onDrag: (x, y) => extra.set('Suspension', 'SpringRate', Math.max(1, Math.round(y / x))) },
          { id: 'bump', label: 'bump stop', color: '#ef6d78', axis: 'x', x: travel, y: Math.max(a.spring * xmax / 1000, Fz) * 0.93,
            onDrag: x => extra.set('Suspension', 'MaxTravelUp', +Math.max(0.005, x / 1000 - a.travelDown).toFixed(3)) },
        ] : [],
      };
    }
    if (kind === 'Damper') {
      const m = Fz / 9.81, crit = 2 * Math.sqrt(a.spring * m);
      const ln = c => range(0, 0.6, 12, v => c * v);
      return {
        series: [{ name: 'critical', color: '#64768d', thin: true, ghost: true, pts: ln(crit) },
                 { name: 'compression (orig)', color: '#4fb3ff', ghost: true, pts: ln(ao.damper) },
                 { name: 'rebound (orig)', color: '#f0b35a', ghost: true, pts: ln(ao.rebound) },
                 { name: 'compression', color: '#4fb3ff', pts: ln(a.damper) },
                 { name: 'rebound', color: '#f0b35a', pts: ln(a.rebound) }],
        x0: 0, x1: 0.6, extra: {},
        opts: { xLabel: 'SUSPENSION SPEED (m/s)', yLabel: 'kN', xUnit: ' m/s', xDigits: 2, small: true, h: 200 },
        note: `Drag the dots: blue = compression, amber = rebound. Grey = critical damping (${(crit / 1000).toFixed(1)} kN per m/s); cars sit at 20-50 % of it.`,
        handles: extra.set ? [
          { id: 'c', label: 'bump', color: '#4fb3ff', axis: 'y', x: 0.42, y: a.damper * 0.42, onDrag: (x, y) => extra.set('Suspension', 'CompressionDamper', Math.round(y / 0.42 / 10) * 10) },
          { id: 'r', label: 'rebound', color: '#f0b35a', axis: 'y', x: 0.56, y: a.rebound * 0.56, onDrag: (x, y) => extra.set('Suspension', 'RelaxationDamper', Math.round(y / 0.56 / 10) * 10) },
        ] : [],
      };
    }
    if (kind === 'Wheel') {
      const grip = ax => range(0.05, 2 * Fz / 1000, 24, kn => S.peakLongitudinal(ax, kn * 1000));
      const brake = ax => range(0.05, 2 * Fz / 1000, 2, () => ax.brakeTorque / ax.radius);
      const pts = grip(a), bf = a.brakeTorque / a.radius;
      const lockTo = (pts.find(p => p[1] >= bf) || [2 * Fz / 1000])[0];
      return {
        series: [{ name: 'grip (orig)', color: '#5ed6a0', ghost: true, pts: grip(ao) }, { name: 'brake (orig)', color: '#ef6d78', ghost: true, pts: brake(ao) },
                 { name: 'tyre grip', color: '#5ed6a0', pts }, { name: 'brake force', color: '#ef6d78', pts: brake(a) }],
        x0: 0, x1: 2 * Fz / 1000,
        extra: { bands: [{ x0: 0, x1: lockTo, bad: true, label: 'wheel locks' }], vlines: [{ x: Fz / 1000, label: 'static', color: '#f0b35a' }] },
        opts: { xLabel: 'WHEEL LOAD (kN)', yLabel: 'kN', xUnit: ' kN', xDigits: 1, small: true, h: 200 },
        note: a.abs < 1 ? 'ABS is on: the wheel is held near the grip limit instead of locking. Drag the red dot to change brake torque.'
          : 'Drag the red dot to change brake torque. Where the red line is above the green grip curve, full braking locks this wheel.',
        handles: extra.set ? [{ id: 'b', label: `${Math.round(a.brakeTorque)} N m`, color: '#ef6d78', axis: 'y', x: Fz / 1000 * 1.45, y: bf,
          onDrag: (x, y) => extra.set('Wheel', 'BrakeTorque', Math.max(0, Math.round(y * a.radius / 10) * 10)) }] : [],
      };
    }
    if (kind === 'Tyre') {
      const c = ax => S.curveLateral(ax, Fz, 14, 40);
      return {
        series: [{ name: 'original', color: '#93a4ba', ghost: true, pts: S.curveLateral(ao, FzO, 14, 40) }, { name: 'this axle', color: extra.color || '#4fb3ff', pts: c(a) }],
        x0: 0, x1: 14, extra: {},
        opts: { xLabel: 'SLIP ANGLE (deg)', yLabel: 'kN', xUnit: '°', xDigits: 1, small: true, h: 200 },
        note: 'Drag the dot up or down to change this axle\'s lateral friction factor (preview: it scales the tyre model\'s peak).',
        handles: extra.set ? (() => { const pts = c(a), pk = pts.reduce((m, p) => p[1] > m[1] ? p : m, [0, 0]);
          return [{ id: 'g', label: `x${(extra.latF || 1).toFixed(2)}`, color: extra.color || '#4fb3ff', axis: 'y', x: pk[0], y: pk[1],
            onDrag: (x, y) => extra.set('Tyre', 'LateralFriction', +Math.max(0.05, (extra.latF || 1) * y / pk[1]).toFixed(3)) }]; })() : [],
      };
    }
    if (kind === 'Steering') {
      const ratio = extra.ratio || 15, ratioO = extra.ratioO || 15, max = Math.abs(extra.max || 0), maxO = Math.abs(extra.maxO || 0);
      const ln = (r, m) => range(0, 720, 36, sw => Math.min(sw / r, m));
      return {
        series: [{ name: 'original', color: '#93a4ba', ghost: true, pts: ln(ratioO, maxO) }, { name: 'road wheel', color: '#4fb3ff', pts: ln(ratio, max) }],
        x0: 0, x1: 720, extra: { hlines: max ? [{ y: max, label: `lock ${max.toFixed(0)}°`, color: '#f0b35a' }] : [] },
        opts: { xLabel: 'STEERING WHEEL (deg)', yLabel: 'deg', xUnit: '°', small: true, h: 190, yDiv: 1, yUnit: '°' },
        note: max ? `Drag the amber dot for the lock angle, the blue one for the ratio. Lock is reached after ${(max * ratio).toFixed(0)}° of steering wheel.` : 'This axle does not steer (no MaxSteeringAngle).',
        handles: extra.set && max ? [
          { id: 'lock', label: `lock ${max.toFixed(0)}°`, color: '#f0b35a', axis: 'y', x: 660, y: max,
            onDrag: (x, y) => extra.set('Suspension', 'MaxSteeringAngle', +(Math.sign(extra.maxSigned || 1) * Math.max(1, y)).toFixed(1)) },
          { id: 'ratio', label: `ratio ${ratio.toFixed(1)}`, color: '#4fb3ff', axis: 'y', x: 120, y: 120 / ratio,
            onDrag: (x, y) => extra.set('Steering', 'SteeringRatio', +Math.max(1, Math.min(40, 120 / Math.max(0.1, y))).toFixed(1)) },
        ] : [],
      };
    }
    return null;
  }

  globalThis.TireTuneContext = { PAC_META, GROUP_INFO, rangeFor, pacGraph, axleGraph };
})();
