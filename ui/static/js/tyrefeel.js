// TireTune tyre feel: the Pacejka curve described in plain words (grip, turn-in, where it peaks, how it breaks away)
// and draggable handles that edit those things directly. Each handle reads the real curve from the evaluator
// (TireLabPhysics.forces) and solves the coefficient that puts the curve under the pointer:
//   grip (peak height)        -> PDY1 / PDX1  (peak force = D = mu * Fz at nominal load)
//   peak position (sideways)  -> PEY1 / PEX1  (curvature E moves the peak along the slip axis)
//   turn-in (initial slope)   -> PKY1 / PKX1  (cornering / slip stiffness)
//   breakaway (tail height)   -> PCY1 / PCX1  (shape C: higher = force falls further after the peak)
(() => {
  'use strict';
  const P = globalThis.TireLabPhysics;
  const DEG = Math.PI / 180;

  const AXES = {
    lat: { group: 'Lateral', D: 'PDY1', E: 'PEY1', K: 'PKY1', C: 'PCY1', x1: 14, unit: '°', toSlip: x => x * DEG,
           force: (c, Fz, x) => P.forces(c, Fz, 0, -x * DEG, 0).Fy, xLabel: 'SLIP ANGLE (deg)', name: 'Cornering' },
    lon: { group: 'Longitudinal', D: 'PDX1', E: 'PEX1', K: 'PKX1', C: 'PCX1', x1: 40, unit: '%', toSlip: x => x / 100,
           force: (c, Fz, x) => P.forces(c, Fz, x / 100, 0, 0).Fx, xLabel: 'WHEEL SLIP (%)', name: 'Drive / brake' },
  };

  // where the curve peaks, its initial slope (force per unit slip) and how much is left at the end of the axis
  function shape(ax, c, Fz) {
    const A = AXES[ax];
    let px = A.x1, pf = 0;
    for (let i = 1; i <= 280; i++) {
      const x = A.x1 * 1.4 * i / 280, f = Math.abs(A.force(c, Fz, x));
      if (f > pf) { pf = f; px = x; }
    }
    const dx = A.x1 * 0.002, k = Math.abs(A.force(c, Fz, dx) - A.force(c, Fz, 0)) / A.toSlip(dx);
    const tail = Math.abs(A.force(c, Fz, A.x1));
    // slip needed for 80 % of the peak: how quickly the tyre bites
    let bite = A.x1;
    for (let i = 1; i <= 400; i++) { const x = A.x1 * i / 400; if (Math.abs(A.force(c, Fz, x)) >= pf * 0.8) { bite = x; break; } }
    return { peakX: px, peakF: pf, mu: pf / Fz, K: k, tail, drop: pf > 0 ? 1 - tail / pf : 0, bite };
  }

  function bisect(f, lo, hi, target, iters = 26) {
    let flo = f(lo) - target, fhi = f(hi) - target;
    if (flo * fhi > 0) return Math.abs(flo) < Math.abs(fhi) ? lo : hi;   // out of reach: closest end
    for (let i = 0; i < iters; i++) {
      const m = (lo + hi) / 2, fm = f(m) - target;
      if (fm * flo <= 0) { hi = m; fhi = fm; } else { lo = m; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  const r4 = v => +(+v).toFixed(4);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // handle edits: c is the flat coefficient set (read), set(key, value) writes into the setup
  function setGrip(ax, c, Fz, targetF, set) {
    const A = AXES[ax], s = shape(ax, c, Fz);
    if (s.peakF <= 0) return;
    const v = clamp(c[A.D] * targetF / s.peakF, 0.15, 3);
    set(A.D, r4(v));
  }
  function setPeakX(ax, c, Fz, targetX, set) {
    const A = AXES[ax];
    const at = e => shape(ax, { ...c, [A.E]: e }, Fz).peakX;
    set(A.E, r4(bisect(at, -4, 0.98, targetX, 18)));
  }
  function setTurnIn(ax, c, Fz, slopeTarget, set) {
    const A = AXES[ax], s = shape(ax, c, Fz);
    if (!s.K) return;
    const k = clamp(slopeTarget / s.K, 0.2, 5);
    set(A.K, r4(clamp(c[A.K] * k, ax === 'lat' ? -80 : 0.5, ax === 'lat' ? -0.5 : 80)));
  }
  function setTail(ax, c, Fz, targetF, set) {
    const A = AXES[ax];
    const tailAt = cc => Math.abs(A.force({ ...c, [A.C]: cc }, Fz, A.x1));
    set(A.C, r4(bisect(tailAt, 1.0, 2.4, targetF, 22)));
  }

  // chart spec with handles for one axis at nominal load
  function editor(ax, get, orig, preset, set) {
    const cur = get(), A = AXES[ax], F0 = cur.NominalLoad || 4000;
    const s = shape(ax, cur, F0);
    // the axis always shows the real peak (a grippier tyre peaks at more slip), the breakaway dot stays at the nominal end
    const xMax = Math.max(A.x1, Math.ceil(s.peakX * 1.3));
    const pts = (c, Fz) => { const out = []; for (let i = 0; i <= 70; i++) { const x = xMax * i / 70; out.push([x, A.force(c, Fz, x)]); } return out; };
    const series = [
      { name: 'light load', color: '#7fd3ff', thin: true, pts: pts(cur, F0 * 0.5) },
      { name: 'heavy load', color: '#1f6fb8', thin: true, pts: pts(cur, F0 * 1.5) },
      { name: 'original', color: '#93a4ba', ghost: true, pts: pts(orig, F0) },
    ];
    if (preset) series.push({ name: 'stock', color: '#7d8ea5', preset: true, pts: pts(preset, F0) });
    // turn-in tangent: a straight line from the origin with the initial slope, ending at the turn-in handle
    const tx = Math.min(s.peakX * 0.7, (s.peakF * 0.85) / s.K / (A.toSlip(1)));
    const tY = s.K * A.toSlip(tx);
    series.push({ name: 'turn-in', color: '#5ed6a0', tangent: true, pts: [[0, 0], [tx, tY]] });
    series.push({ name: 'this tyre', color: '#4fb3ff', pts: pts(cur, F0) });
    const handles = [
      { id: ax + '-grip', label: `grip ${s.mu.toFixed(2)}`, color: '#4fb3ff', axis: 'xy', x: s.peakX, y: s.peakF,
        hint: 'up/down = more/less grip, left/right = where it peaks',
        onDrag: (x, y) => { setGrip(ax, get(), F0, y, set); setPeakX(ax, get(), F0, x, set); } },
      { id: ax + '-turnin', label: 'turn-in', color: '#5ed6a0', axis: 'xy', x: tx, y: tY,
        hint: 'steeper = sharper, quicker response',
        onDrag: (x, y) => { if (x > 0) setTurnIn(ax, get(), F0, y / A.toSlip(x), set); } },
      { id: ax + '-tail', label: s.drop > 0.22 ? 'snappy' : s.drop > 0.08 ? 'breakaway' : 'progressive', color: '#f0b35a', axis: 'y', x: A.x1, y: s.tail,
        hint: 'lower = grip falls away harder after the limit',
        onDrag: (x, y) => setTail(ax, get(), F0, y, set) },
    ];
    return {
      series, x0: 0, x1: xMax, handles, shape: s,
      opts: { xLabel: A.xLabel, yLabel: 'kN', xUnit: A.unit, xDigits: ax === 'lat' ? 1 : 0, small: true, h: 230 },
    };
  }

  // plain words for a shape
  function words(ax, s) {
    const grip = s.mu < 0.75 ? 'low' : s.mu < 1.05 ? 'road' : s.mu < 1.3 ? 'sport' : 'race';
    const bite = ax === 'lat' ? (s.bite < 2.5 ? 'sharp' : s.bite < 4.5 ? 'normal' : 'soft') : (s.bite < 4 ? 'sharp' : s.bite < 8 ? 'normal' : 'soft');
    const brk = s.drop < 0.08 ? 'progressive' : s.drop < 0.22 ? 'moderate' : 'snappy';
    return { grip, bite, brk };
  }

  globalThis.TireTuneFeel = { AXES, shape, editor, words };
})();
