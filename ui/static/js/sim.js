// TireTune vehicle simulation: N axles, per-wheel loads and Pacejka forces (TireLabPhysics.forces).
// Approximate by design: a planar bicycle model per axle, quasi-static load transfer, springs from SpringRate.
// It shows how a setup change moves balance, loads and limits; the engine's own simulation is the authority.
(() => {
  'use strict';
  const P = globalThis.TireLabPhysics;
  const G = 9.81;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Build a simulation car from the UI state: vals = edit tree, geo = {axles:[{z,track,y}], groundY}
  function buildCar(vals, geo, opts = {}) {
    const mass = vals.rigidBody.Mass || 1500;
    const com = vals.rigidBody.CenterOfMass || [0, 0.6, 0];
    const groundY = geo.groundY || 0;
    const base = flatPacejka(vals.pacejka);
    const axles = vals.axles.map((a, i) => {
      const g = geo.axles[i] || { z: 0, track: 1.5, y: 0.35 };
      const tyre = a.Tyre || {}, susp = a.Suspension || {}, wheel = a.Wheel || {};
      const latF = opts.frictionScale === false ? 1 : num(tyre.LateralFriction, 1);
      const lonF = opts.frictionScale === false ? 1 : num(tyre.LongitudinalFriction, 1);
      // assumption, labelled in the UI: the Tyre friction factors scale the Pacejka peak (D) of this axle
      const coeff = { ...base, PDY1: base.PDY1 * latF, PDY2: base.PDY2 * latF, PDX1: base.PDX1 * lonF, PDX2: base.PDX2 * lonF };
      return {
        index: i, z: g.z, track: g.track, y: g.y,
        d: g.z - com[2],                                      // + forward of the CoM
        radius: num(wheel.Radius, g.y || 0.35),
        steerMax: num(susp.MaxSteeringAngle, 0),
        torqueShare: num(a.TorqueShare, 0),
        brakeTorque: num(wheel.BrakeTorque, 1500), abs: num(wheel.ABS_Slip_Threshold, 1),
        spring: num(susp.SpringRate, 40) * 1000,            // N/m (SpringRate read as N/mm)
        damper: num(susp.CompressionDamper, 2000), rebound: num(susp.RelaxationDamper, num(susp.CompressionDamper, 2000)),
        travelUp: num(susp.MaxTravelUp, 0.12), travelDown: num(susp.MaxTravelDown, 0.12),
        sway: a.Swaybar ? num(a.Swaybar.Stiffness, 0) : 0,
        coeff,
        align: (() => {
          const AL = globalThis.TireTuneAlign, al = a.align || {};
          if (!AL) return null;
          const w = AL.decodeWheel(Object.values(al.wheels || {})[0]), k = AL.decodeKingpin(Object.values(al.kingpins || {})[0]);
          return { camber: w.camber || 0, toe: w.toe || 0, caster: k.caster || 0, sai: k.sai || 0, hasKingpin: k.family !== 'none' };
        })(),
      };
    });
    const zs = axles.map(a => a.z);
    const wheelbase = axles.length > 1 ? Math.max(...zs) - Math.min(...zs) : 2.5;
    const iz = vals.sim && vals.sim.InertiaOverrideEnabled && Array.isArray(vals.sim.InertiaOverride)
      ? vals.sim.InertiaOverride[1] : mass * (wheelbase * wheelbase + 1.6 * 1.6) / 9;
    const h = Math.max(0.15, com[1] - groundY);
    const car = { mass, com, h, axles, wheelbase, iz, groundY, area: num(vals.aero && vals.aero.ReferenceArea, 2.2),
                  cd: num(vals.aero && vals.aero.DragCoefficient, 0.4) };
    car.static = staticAxleLoads(car);
    const rollK = axles.map(a => a.spring * a.track * a.track / 2 + a.sway);
    const sumK = rollK.reduce((s, v) => s + v, 0) || 1;
    car.rollShare = rollK.map(k => k / sumK);
    return car;
  }

  function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

  function flatPacejka(p) {
    const c = { ...P.source };
    if (!p) return c;
    if (p.NominalLoad != null) c.NominalLoad = p.NominalLoad;
    if (p.NominalRadius != null) c.NominalRadius = p.NominalRadius;
    for (const g of Object.values(p.groups || {})) for (const [k, v] of Object.entries(g)) if (Number.isFinite(v)) c[k] = v;
    return c;
  }

  // Static axle loads (N, whole axle): two axles by lever rule; more axles: the first against the others' centroid
  function staticAxleLoads(car) {
    const W = car.mass * G, ax = car.axles, n = ax.length;
    if (n === 1) return [W];
    const zf = ax[0].z, zr = ax.slice(1).reduce((s, a) => s + a.z, 0) / (n - 1);
    const fs = clamp((car.com[2] - zr) / ((zf - zr) || 1), 0.03, 0.97);
    return ax.map((_, i) => i === 0 ? W * fs : W * (1 - fs) / (n - 1));
  }

  // Per-wheel loads [left, right] for every axle under accelerations ax (+ forward), ay (+ left)
  function wheelLoads(car, ax, ay) {
    const n = car.axles.length;
    const dLong = car.mass * ax * car.h / (car.wheelbase || 1);   // accelerating: load moves rearward
    return car.axles.map((a, i) => {
      let F = car.static[i];
      if (n > 1) F += i === 0 ? -dLong : dLong / (n - 1);
      F = Math.max(0, F);
      const dLat = car.mass * ay * car.h / a.track * car.rollShare[i];  // turning left (ay>0) loads the right side
      const l = clamp(F / 2 - dLat, 0, F), r = F - l;
      return [l, r];
    });
  }

  function axleLateral(a, pair, alpha) {
    const l = P.forces(a.coeff, pair[0], 0, alpha, 0), r = P.forces(a.coeff, pair[1], 0, alpha, 0);
    return { Fy: l.Fy + r.Fy, l, r };
  }

  function peakLateral(a, Fz) {
    let best = 0;
    for (let i = 1; i <= 40; i++) { const f = P.forces(a.coeff, Fz, 0, -i * 0.006, 0).Fy; if (f > best) best = f; }
    return Math.max(1, best);
  }

  function peakLongitudinal(a, Fz) {
    let best = 0;
    for (let i = 1; i <= 40; i++) { const f = Math.abs(P.forces(a.coeff, Fz, -i * 0.01, 0, 0).Fx); if (f > best) best = f; }
    return Math.max(1, best);
  }

  // ---- scenario: hold a speed and steer onto a circle ---------------------------------------------------------
  function corner(car, speedKmh, radius, seconds = 6) {
    const U = Math.max(0.5, speedKmh / 3.6);
    const front = car.axles[0];
    const L = car.wheelbase || 2.5;
    const delta0 = Math.atan(L / radius);
    const steerRef = Math.abs(front.steerMax) > 0.01 ? front.steerMax : 30;
    const dt = 1 / 240, out = [];
    let x = 0, y = 0, psi = 0, v = 0, r = 0, ay = 0;
    for (let i = 0, steps = Math.round(seconds / dt); i <= steps; i++) {
      const t = i * dt, ramp = Math.min(1, t / 0.8);
      const loads = wheelLoads(car, 0, ay);
      let Fy = 0, Mz = 0;
      const axles = car.axles.map((a, k) => {
        const lim = Math.abs(a.steerMax) * Math.PI / 180;
        const steer = clamp(delta0 * ramp * (a.steerMax / steerRef), -lim, lim);
        const alpha = Math.atan2(v + a.d * r, U) - steer;
        const f = axleLateral(a, loads[k], alpha);
        const fy = f.Fy * Math.cos(steer);
        Fy += fy; Mz += a.d * fy;
        return { steer, alpha, Fy: f.Fy, loads: loads[k], use: [Math.abs(f.l.Fy) / peakLateral(a, loads[k][0]), Math.abs(f.r.Fy) / peakLateral(a, loads[k][1])] };
      });
      const accel = Fy / car.mass;
      if (i % 4 === 0) out.push({ t, x, y, psi, U, v, r, ay: accel, ax: 0, axles });
      v += clamp(accel - U * r, -60, 60) * dt;
      r += clamp(Mz / car.iz, -20, 20) * dt;
      v = clamp(v, -U * 2, U * 2); r = clamp(r, -4, 4);
      psi += r * dt;
      x += (U * Math.cos(psi) - v * Math.sin(psi)) * dt;
      y += (U * Math.sin(psi) + v * Math.cos(psi)) * dt;
      ay = ay * 0.85 + accel * 0.15;
    }
    return out;
  }

  // ---- scenario: full brakes from a speed -----------------------------------------------------------------------
  function brake(car, speedKmh) {
    let U = speedKmh / 3.6, x = 0, ax = 0, t = 0;
    const dt = 1 / 240, out = [];
    while (U > 0.05 && t < 20) {
      const loads = wheelLoads(car, ax, 0);
      let Fx = 0;
      const axles = car.axles.map((a, k) => {
        const per = loads[k].map(Fz => {
          const peak = peakLongitudinal(a, Fz), want = a.brakeTorque / a.radius;
          const abs = a.abs < 1 && want > peak;          // ABS holds the wheel just under the peak instead of locking
          const locked = want > peak && !abs;
          const f = locked ? Math.abs(P.forces(a.coeff, Fz, -1, 0, 0).Fx) : abs ? peak * 0.96 : want;
          return { f, peak, locked, abs, use: Math.min(1, want / peak) };
        });
        Fx += per[0].f + per[1].f;
        return { loads: loads[k], wheels: per, use: [per[0].use, per[1].use], locked: per.some(p => p.locked) };
      });
      const drag = 0.5 * 1.2 * car.cd * car.area * U * U;
      const decel = (Fx + drag) / car.mass;
      if (out.length === 0 || t - out[out.length - 1].t >= 1 / 60) out.push({ t, x, U, ax: -decel, ay: 0, axles });
      ax = ax * 0.8 + (-decel) * 0.2;
      U = Math.max(0, U - decel * dt); x += U * dt; t += dt;
    }
    out.push({ t, x, U: 0, ax: 0, ay: 0, axles: out.length ? out[out.length - 1].axles : [], stopped: true });
    return out;
  }

  // ---- scenario: traction-limited launch (grip only; engine torque is not modelled) ----------------------------
  function launch(car, seconds = 4) {
    let U = 0, x = 0, ax = 0;
    const dt = 1 / 240, out = [];
    const shares = car.axles.map(a => a.torqueShare), total = shares.reduce((s, v) => s + v, 0) || 1;
    for (let t = 0; t <= seconds; t += dt) {
      const loads = wheelLoads(car, ax, 0);
      let Fx = 0;
      const axles = car.axles.map((a, k) => {
        const driven = shares[k] > 0;
        const per = loads[k].map(Fz => (driven ? peakLongitudinal(a, Fz) * 0.95 : 0));
        Fx += per[0] + per[1];
        return { loads: loads[k], use: driven ? [0.95, 0.95] : [0, 0], driven };
      });
      const drag = 0.5 * 1.2 * car.cd * car.area * U * U;
      const acc = Math.max(0, (Fx - drag) / car.mass);
      if (out.length === 0 || t - out[out.length - 1].t >= 1 / 60) out.push({ t, x, U, ax: acc, ay: 0, axles });
      ax = ax * 0.8 + acc * 0.2;
      U += acc * dt; x += U * dt;
    }
    return out;
  }

  // ---- steady-state summary for the readouts -----------------------------------------------------------------
  function summary(car, speedKmh, radius) {
    const U = speedKmh / 3.6, ay = U * U / radius;
    const loads = wheelLoads(car, 0, ay);
    const need = car.axles.map((a, i) => car.mass * ay * (car.static[i] / (car.mass * G)));
    const cap = car.axles.map((a, i) => peakLateral(a, loads[i][0]) + peakLateral(a, loads[i][1]));
    const use = need.map((n, i) => n / cap[i]);
    // limit speed: largest speed where every axle still holds its share
    let lo = 0, hi = 90;
    for (let it = 0; it < 18; it++) {
      const v = (lo + hi) / 2, a2 = v * v / radius, l2 = wheelLoads(car, 0, a2);
      const ok = car.axles.every((a, i) => car.mass * a2 * (car.static[i] / (car.mass * G)) <= peakLateral(a, l2[i][0]) + peakLateral(a, l2[i][1]));
      if (ok) lo = v; else hi = v;
    }
    const f = use[0], rmax = Math.max(...use.slice(1));
    let balance = 'Neutral', tone = 'ok';
    if (f > 1 || rmax > 1) { balance = f >= rmax ? 'Understeer - front axle saturates' : 'Oversteer - rear axle saturates'; tone = 'bad'; }
    else if (f - rmax > 0.06) balance = 'Mild understeer';
    else if (rmax - f > 0.06) { balance = 'Mild oversteer'; tone = 'warn'; }
    const ride = car.axles.map((a, i) => {
      const m = car.static[i] / 2 / G, f0 = Math.sqrt(a.spring / m) / (2 * Math.PI);
      return { freq: f0, zeta: a.damper / (2 * Math.sqrt(a.spring * m)), sag: car.static[i] / 2 / a.spring,
               travel: a.travelUp + a.travelDown };
    });
    return { ay, ayG: ay / G, use, limitKmh: lo * 3.6, balance, tone, loads, ride,
             frontShare: car.static[0] / (car.mass * G) };
  }

  // Lateral force curve of one axle's wheel at a given load (for the charts)
  function curveLateral(a, Fz, maxDeg = 14, n = 80) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const d = maxDeg * i / n; pts.push([d, P.forces(a.coeff, Fz, 0, -d * Math.PI / 180, 0).Fy]); }
    return pts;
  }
  function curveLongitudinal(a, Fz, maxSlip = 0.4, n = 80) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const k = maxSlip * i / n; pts.push([k * 100, P.forces(a.coeff, Fz, k, 0, 0).Fx]); }
    return pts;
  }

  globalThis.TireTuneSim = { buildCar, wheelLoads, corner, brake, launch, summary, curveLateral, curveLongitudinal,
                             peakLateral, peakLongitudinal, flatPacejka };
})();
