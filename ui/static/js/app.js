// TireTune app: loads the vehicle from the server, edits a copy of its setup, animates the result and writes it back.
(() => {
  'use strict';
  const S = globalThis.TireTuneSim, P = globalThis.TireLabPhysics;
  const $ = id => document.getElementById(id);
  const AX_COLORS = ['var(--ax-0)', 'var(--ax-1)', 'var(--ax-2)', 'var(--ax-3)', 'var(--ax-4)'];
  const AX_HEX = ['#4fb3ff', '#f0b35a', '#b18cff', '#5ed6a0', '#ff8fb1'];
  const clone = o => JSON.parse(JSON.stringify(o));

  // Field definitions: [key, label, unit, min, max, step, help]. Names are the Enfusion property names.
  const AXLE_DEFS = {
    Suspension: [
      ['MaxSteeringAngle', 'Max steering angle', 'deg', -60, 60, 0.5, 'Road-wheel lock. Negative steers this axle the other way.'],
      ['SpringRate', 'Spring rate', 'N/mm', 1, 400, 1, 'Spring force per mm. Sets ride height under load, ride frequency and roll split.'],
      ['CompressionDamper', 'Compression damper', 'N s/m', 0, 20000, 50, 'Resistance while compressing.'],
      ['RelaxationDamper', 'Relaxation damper', 'N s/m', 0, 20000, 50, 'Rebound resistance while extending.'],
      ['MaxTravelUp', 'Max travel up', 'm', 0, 0.5, 0.005, 'Compression limit (bump).'],
      ['MaxTravelDown', 'Max travel down', 'm', 0, 0.5, 0.005, 'Extension limit (droop).'],
      ['RayStartOffsetUp', 'Ray start offset up', 'm', 0, 1, 0.005, 'Starts the contact ray higher; does not add travel.'],
    ],
    Wheel: [
      ['Radius', 'Radius', 'm', 0.12, 1.2, 0.001, 'Simulation wheel radius (separate from Pacejka NominalRadius).'],
      ['Mass', 'Mass', 'kg', 1, 300, 0.5, 'Wheel assembly mass.'],
      ['Ratio', 'Ratio', '', 0.1, 10, 0.05, 'Wheel-end reduction ratio.'],
      ['BrakeTorque', 'Brake torque', 'N m', 0, 20000, 10, 'Per wheel. Above what the tyre holds, the wheel locks.'],
      ['HandbrakeTorqueFactor', 'Handbrake factor', '', 0, 5, 0.05, 'Handbrake torque scaling.'],
      ['ABS_Slip_Threshold', 'ABS slip limit', '', 0, 1, 0.01, '1 = no ABS. Below 1, ABS steps in before the wheel locks.'],
      ['ABS_Minimum_RPM', 'ABS minimum wheel speed', 'rpm', 0, 1000, 5, 'Below this wheel speed ABS lets the wheel lock.'],
    ],
    Tyre: [
      ['LateralFriction', 'Lateral friction', '', 0, 3, 0.005, 'Extra lateral grip factor outside Pacejka (preview: scales the peak).'],
      ['LongitudinalFriction', 'Longitudinal friction', '', 0, 3, 0.005, 'Extra drive/brake grip factor (preview: scales the peak).'],
      ['Roughness', 'Roughness', 'm', 0, 1, 0.005, 'Wheel bumpiness on top of the surface.'],
      ['RollingResistance', 'Rolling resistance', '', 0, 5, 0.005, 'Rolling loss.'],
      ['RollingDrag', 'Rolling drag', '', 0, 2, 0.01, 'Speed-dependent rolling loss.'],
      ['Tread', 'Tread', '', 0, 1, 0.01, 'Tread / non-tread friction blend (not depth).'],
    ],
    Steering: [
      ['SteeringRatio', 'Steering ratio', '', 1, 40, 0.1, 'Steering-wheel turns per road-wheel turn.'],
      ['PowerSteeringFactor', 'Power steering', '', 0, 1, 0.01, 'Assistance: transmitted torque = (1 - factor) x wheel torque.'],
      ['SteeringDamping', 'Steering damping', '', 0, 20, 0.1, ''],
      ['MechanicalTrail', 'Mechanical trail', 'm', -0.15, 2, 0.001, '0 lets Reforger derive it from the kingpin.'],
      ['ScrubRadius', 'Scrub radius', 'm', -0.15, 2, 0.001, '0 lets Reforger derive it from the kingpin.'],
    ],
    Swaybar: [['Stiffness', 'Stiffness', '', 0, 30000, 50, 'Anti-roll bar: moves roll load transfer to this axle.']],
  };
  const AXLE_TOP = [['TorqueShare', 'Torque share', '', 0, 1, 0.01, 'Share of drive torque this axle gets (sum to 1 over driven axles).']];
  const PAC_KEY = [
    ['NominalLoad', 'Nominal load', 'N', 300, 40000, 10, 'Reference wheel load the curves are centred on. Keep it near the real static wheel load.', null],
    ['NominalRadius', 'Nominal radius', 'm', 0.1, 1.2, 0.001, 'Tyre reference radius. Keep it near the wheel Radius.', null],
    ['PDY1', 'Peak lateral grip (PDY1)', 'mu', 0.3, 2.2, 0.005, 'Height of the cornering curve.', 'Lateral'],
    ['PKY1', 'Cornering stiffness (PKY1)', '', -40, -2, 0.05, 'Initial slope: more negative = sharper turn-in.', 'Lateral'],
    ['PCY1', 'Lateral shape (PCY1)', '', 1, 2.5, 0.01, 'Higher = the force drops more after the peak.', 'Lateral'],
    ['PEY1', 'Lateral curvature (PEY1)', '', -4, 1, 0.01, 'Shapes the knee of the curve near the peak.', 'Lateral'],
    ['PDY2', 'Lateral load sensitivity (PDY2)', '', -0.6, 0.6, 0.005, 'How grip changes with load (affects load transfer balance).', 'Lateral'],
    ['PDX1', 'Peak drive/brake grip (PDX1)', 'mu', 0.3, 2.2, 0.005, 'Height of the drive/brake curve.', 'Longitudinal'],
    ['PKX1', 'Slip stiffness (PKX1)', '', 2, 50, 0.1, 'Initial slope of the drive/brake curve.', 'Longitudinal'],
    ['PCX1', 'Longitudinal shape (PCX1)', '', 1, 2.5, 0.01, '', 'Longitudinal'],
    ['PEX1', 'Longitudinal curvature (PEX1)', '', -3, 1, 0.01, '', 'Longitudinal'],
  ];

  const st = {
    data: null, orig: null, cur: null, geo: null, axleSel: 0, scenario: 'corner', speed: 50, radius: 35,
    preset: '', dir: 1, live: false, liveTimer: 0, tab: 'chassis', view: 'vehicle', stamp: -1, recalcTimer: 0,
  };
  globalThis.TireTuneState = st;       // for the browser console
  const stage = new TireTuneStage.Stage($('stage'));
  const chartLat = new TireTuneChart.Chart($('chart-lat'), { xLabel: 'SLIP ANGLE (deg)', yLabel: 'kN', xUnit: '°', xDigits: 1 });
  const chartLon = new TireTuneChart.Chart($('chart-lon'), { xLabel: 'SLIP RATIO (%)', yLabel: 'kN', xUnit: '%', xDigits: 0 });

  // ---------------------------------------------------------------------------------------------------------------
  // data
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  // pick: 'value' (resolved from the text) or 'wb' (Workbench-resolved, includes engine defaults)
  function valuesFromDesc(v, pick = 'value') {
    const val = f => (f && f[pick] !== undefined ? f[pick] : null);
    const out = {
      rigidBody: { Mass: val(v.rigidBody.Mass), CenterOfMass: val(v.rigidBody.CenterOfMass) },
      sim: { InertiaOverrideEnabled: val(v.sim.InertiaOverrideEnabled), InertiaOverride: val(v.sim.InertiaOverride) },
      aero: { ReferenceArea: val(v.aero.ReferenceArea), DragCoefficient: val(v.aero.DragCoefficient) },
      axles: v.axles.map(a => {
        const ax = { TorqueShare: val(a.props.TorqueShare), HasHandbrake: val(a.props.HasHandbrake) };
        if (pick === 'value') {
          ax.align = { wheels: {}, kingpins: {} };
          for (const w of a.wheels || []) if (Array.isArray(w.angles)) ax.align.wheels[w.name] = w.angles.slice();
          for (const k of a.kingpins || []) if (Array.isArray(k.angles)) ax.align.kingpins[k.id] = k.angles.slice();
        }
        for (const k of Object.keys(AXLE_DEFS)) {
          if (!a[k] || (k === 'Swaybar' && !a[k].present)) continue;
          ax[k] = {};
          for (const [n, f] of Object.entries(a[k].fields)) ax[k][n] = val(f);
        }
        return ax;
      }),
      pacejka: null,
    };
    if (v.pacejka) {
      out.pacejka = { NominalLoad: val(v.pacejka.top.NominalLoad), NominalRadius: val(v.pacejka.top.NominalRadius), groups: {} };
      for (const [g, gv] of Object.entries(v.pacejka.groups)) {
        out.pacejka.groups[g] = {};
        for (const [k, f] of Object.entries(gv.fields)) out.pacejka.groups[g][k] = val(f);
      }
    }
    return out;
  }

  async function load() {
    let d;
    try { d = await api('/api/session'); } catch (e) { toast('Server not reachable: ' + e.message, true); return; }
    st.stamp = d.stamp;
    st.data = d;
    if (d.error || !d.vehicle) {
      $('breadcrumb').textContent = d.error ? d.error + ' (moved or deleted? Select it again in Workbench and use Plugins > TireTune > Open selected vehicle.)'
        : 'No vehicle: in Workbench select a vehicle prefab, then Plugins > TireTune > Open selected vehicle.';
      return;
    }
    st.addTyreModel = null;
    try { st.tyreSizeText = localStorage.getItem('tt-size:' + d.vehicle.prefab) || ''; st.tyreSize = st.tyreSizeText ? P.geometry(P.tireSize(st.tyreSizeText)) : null; } catch (e) { st.tyreSize = null; }
    st.orig = valuesFromDesc(d.vehicle);
    st.cur = clone(st.orig);
    st.wbDef = valuesFromDesc(d.vehicle, 'wb');
    st.geo = clone(d.geometry);
    st.axleSel = Math.min(st.axleSel, d.vehicle.axles.length - 1);
    renderHeader(); renderControls(); renderLint(); renderWb();
    changed();
    fillVehicleList();
  }

  async function fillVehicleList() {
    const sel = $('vehicle-select');
    let list = [];
    try { list = await api('/api/vehicles'); } catch (e) { /* offline */ }
    const cur = st.data.vehicle.prefab;
    sel.innerHTML = '';
    const opts = list.some(x => x.path === cur) ? list : [{ addon: '', path: cur }, ...list];
    for (const x of opts) {
      const o = document.createElement('option');
      o.value = x.path; o.textContent = (x.addon ? x.addon + ' : ' : '') + x.path;
      if (x.path === cur) o.selected = true;
      sel.appendChild(o);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // header, chips
  function renderHeader() {
    const v = st.data.vehicle;
    $('breadcrumb').textContent = v.parents.join('  <  ');
    const chip = $('chip-source');
    chip.textContent = v.writable ? (st.data.source === 'dev' ? 'dev session' : 'Workbench session') : 'read only';
    chip.className = 'chip ' + (v.writable ? 'ok' : 'warn');
    chip.title = v.writable ? 'Edits are written into ' + v.prefab : 'This prefab is not in one of your addons. Create an inherited prefab in your addon and tune that.';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // controls
  function srcLabel(src, conf) {
    if (!src) return conf ? 'via ' + conf.split('/').pop() : 'engine default';
    const prefab = st.data.vehicle.prefab;
    if (src === prefab) return 'set in this prefab';
    return src.split('/').pop();
  }

  function control(path, def, srcInfo, opts = {}) {
    const [key, label, unit, min0, max0, step, help] = def;
    const get = () => getPath(st.cur, path), orig = getPath(st.orig, path), engine = getPath(st.wbDef, path);
    const v0 = get();
    const min = Math.min(min0, typeof orig === 'number' ? orig : min0), max = Math.max(max0, typeof orig === 'number' ? orig : max0);
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const id = 'c_' + path.join('_'), plain = String(label).replace(/<[^>]+>/g, '');
    wrap.innerHTML = `
      <div class="ctl-head"><span class="dot"></span><label for="${id}">${label} <span class="unit">${unit}</span></label>
        <span class="src" title="${srcInfo.title || ''}">${srcInfo.text || ''}</span></div>
      <div class="ctl-row"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}">
        <input type="number" min="${min}" max="${max}" step="${step}" aria-label="${plain} value">
        <button class="reset" type="button" title="Back to ${orig ?? 'engine default'}" aria-label="Reset ${plain}"><svg><use href="#i-reset"/></svg></button></div>
      ${help && opts.help !== false ? `<p class="help">${help}</p>` : ''}`;
    const range = wrap.querySelector('input[type=range]'), numb = wrap.querySelector('input[type=number]');
    const sync = () => {
      const v = get();
      const shown = v == null ? (typeof engine === 'number' ? engine : (min + max) / 2) : v;
      range.value = shown; numb.value = v == null ? '' : +(+v).toFixed(6);
      numb.placeholder = v == null ? (typeof engine === 'number' ? String(+engine.toFixed(4)) : 'default') : '';
      range.style.setProperty('--fill', ((shown - min) / ((max - min) || 1) * 100) + '%');
      wrap.classList.toggle('unset', v == null);
      wrap.classList.toggle('dirty', !same(v, orig));
    };
    const set = v => { setPath(st.cur, path, v); sync(); changed(); };
    range.addEventListener('input', () => set(+range.value));
    numb.addEventListener('change', () => { if (numb.value === '') set(orig); else if (Number.isFinite(+numb.value)) set(+numb.value); });
    numb.addEventListener('keydown', e => { if (e.key === 'Enter') { numb.blur(); } if (e.key === 'Escape') { numb.value = get() == null ? '' : +(+get()).toFixed(6); numb.blur(); } });
    numb.title = 'Click to type a value, Enter to apply, Esc to cancel';
    wrap.querySelector('.reset').addEventListener('click', () => set(clone(orig)));
    wrap._sync = sync;
    sync();
    return wrap;
  }

  function group(title, src, children, extra, charts) {
    const g = document.createElement('section');
    g.className = 'group';
    g.innerHTML = `<div class="group-head"><h3>${title}</h3><span class="src" title="${src || ''}">${src ? '<svg><use href="#i-file"/></svg>' + src.split('/').pop() : ''}</span></div>`;
    (charts || []).forEach(c => g.appendChild(c));
    children.forEach(c => g.appendChild(c));
    if (extra) g.appendChild(extra);
    return g;
  }

  // ---- live graph inside a card: spec() -> {series, x0, x1, extra, opts, note}, refreshed on every recalc ----
  st.cards = [];
  // new cards draw at once (after the DOM settles) instead of waiting for the next recalculation
  let cardsQueued = false;
  function queueCards() { if (cardsQueued) return; cardsQueued = true; setTimeout(() => { cardsQueued = false; updateCards(); }, 0); }
  function cardChart(spec) {
    const wrap = document.createElement('div');
    wrap.className = 'card-chart';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('chart');
    const note = document.createElement('p');
    note.className = 'help chart-note';
    wrap.append(svg, note);
    let chart = null;
    st.cards.push(() => {
      if (!wrap.isConnected) return false;          // dropped when its card is re-rendered
      const g = st.car ? spec() : null;
      wrap.hidden = !g;
      if (!g) return true;
      if (!chart) { chart = new TireTuneChart.Chart(svg, g.opts); chart.onDragEnd = () => changed(); }
      chart.set(g.series, g.x0, g.x1, { ...(g.extra || {}), handles: g.handles || (g.extra || {}).handles || [] });
      note.textContent = g.note || '';
      return true;
    });
    queueCards();
    return wrap;
  }
  function updateCards() { st.cards = st.cards.filter(u => u()); }

  // a value changed by dragging a graph handle: rebuild the car and every graph now (cheap), the scenario on release
  let dragFrame = 0;
  function dragSet(path, value) {
    setPath(st.cur, path, value);
    if (dragFrame) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = 0;
      st.car = S.buildCar(simVals(st.cur), st.geo);
      updateCards();
      const n = countDiffs(st.cur, st.orig);
      $('dirty-count').textContent = n;
      $('btn-review').disabled = n === 0 || !st.data.vehicle.writable;
      $('btn-reset-all').disabled = n === 0;
      document.querySelectorAll('.ctl').forEach(c => c._sync && c._sync());
      clearTimeout(st.recalcTimer);
      st.recalcTimer = setTimeout(() => recalc(false), 220);
    });
  }
  const presetCoeff = () => { const p = (st.data.presets || []).find(x => x.name === st.preset); return p ? { ...P.source, ...p.coeff } : null; };

  function renderControls() {
    renderChassis(); renderAxles(); renderTyre(); renderTemplates();
  }

  function bodyGroup() {
    const rb = st.data.vehicle.rigidBody;
    const massDef = ['Mass', 'Mass', 'kg', 200, Math.max(6000, (rb.Mass.value || 0) * 2), 5, 'Total vehicle mass (RigidBody).'];
    const comDefs = [
      ['CenterOfMass', 'CoM height', 'm', -1, 3, 0.005, 'Higher = more load transfer: more roll, pitch and weight shift.', 1],
      ['CenterOfMass', 'CoM fore / aft', 'm', -4, 4, 0.005, 'Forward moves weight onto the front axle: more understeer, better traction for FWD.', 2],
      ['CenterOfMass', 'CoM lateral', 'm', -1, 1, 0.005, 'Keep at 0 unless the vehicle is asymmetric.', 0],
    ];
    const src = f => ({ text: srcLabel(f.src), title: f.src });
    const ctls = [control(['rigidBody', 'Mass'], massDef, src(rb.Mass))];
    for (const d of comDefs) ctls.push(control(['rigidBody', 'CenterOfMass', d[7]], d, src(rb.CenterOfMass)));
    return group('Body', '', ctls);
  }

  function renderChassis() {
    const box = $('tab-chassis'), v = st.data.vehicle;
    box.innerHTML = '';
    box.appendChild(bodyGroup());
    // geometry
    const geo = document.createElement('section');
    geo.className = 'group';
    const srcTxt = { estimate: 'estimated: capture it from Workbench for real positions', live: 'captured from Workbench', user: 'entered by you' }[st.geo.source] || st.geo.source;
    geo.innerHTML = `<div class="group-head"><h3>Wheel geometry</h3><span class="src">${srcTxt}</span></div>`;
    st.geo.axles.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.innerHTML = `<label>Axle ${i + 1} position fwd (m)<input type="number" step="0.01" value="${a.z}"></label>
        <label>Axle ${i + 1} track (m)<input type="number" step="0.01" value="${a.track}"></label>`;
      const [z, t] = row.querySelectorAll('input');
      z.addEventListener('change', () => { a.z = +z.value; st.geo.source = 'user'; geoChanged(); });
      t.addEventListener('change', () => { a.track = +t.value; st.geo.source = 'user'; geoChanged(); });
      geo.appendChild(row);
    });
    const btns = document.createElement('div');
    btns.className = 'copy-row';
    btns.innerHTML = `<button class="btn ghost" type="button"><svg><use href="#i-capture"/></svg>Capture from Workbench</button>`;
    btns.querySelector('button').addEventListener('click', captureGeometry);
    geo.appendChild(btns);
    const note = document.createElement('p');
    note.className = 'help';
    note.textContent = 'Place the vehicle in the open world (or drive it in Play mode), then capture: the wheel positions come from the simulation itself. Geometry is only used for the preview, never written.';
    geo.appendChild(note);
    box.appendChild(geo);
    const aero = v.aero;
    const n = document.createElement('div');
    n.className = 'note';
    n.innerHTML = `<strong>Aerodynamics</strong> area ${fmt(aero.ReferenceArea.value)} m², Cd ${fmt(aero.DragCoefficient.value)}. ` +
      `<strong>Inertia override</strong> ${v.sim.InertiaOverrideEnabled.value ? (v.sim.InertiaOverride.value || []).join(' / ') : 'off'}.`;
    box.appendChild(n);
  }

  function renderAxles() {
    const box = $('tab-axles'), v = st.data.vehicle;
    box.innerHTML = '';
    const seg = document.createElement('div');
    seg.className = 'axle-seg';
    v.axles.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', i === st.axleSel);
      b.innerHTML = `<i style="background:${AX_COLORS[i % 5]}"></i>Axle ${i + 1}`;
      b.title = a.wheels.map(w => w.pivot || w.name).join(', ');
      b.addEventListener('click', () => { st.axleSel = i; renderAxles(); });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    const i = st.axleSel, a = v.axles[i];
    const wheels = document.createElement('p');
    wheels.className = 'help';
    wheels.textContent = 'Wheels: ' + a.wheels.map(w => `${w.name} (${w.pivot})`).join(', ');
    box.appendChild(wheels);
    box.appendChild(axleGroup(i, 'Drive'));
    box.appendChild(alignGroup(i));
    for (const k of Object.keys(AXLE_DEFS)) {
      if (st.cur.axles[i][k]) box.appendChild(axleGroup(i, k));
    }
  }

  // one axle card (controls + live graphs); used by the Axles tab and the 3D inspector
  function axleGroup(i, k) {
    const v = st.data.vehicle, a = v.axles[i];
    if (k === 'Drive') return group('Drive', '', AXLE_TOP.map(d => control(['axles', i, d[0]], d, { text: srcLabel(a.props[d[0]].src), title: a.props[d[0]].src })));
    const defs = AXLE_DEFS[k];
    {
      const info = a[k];
      const HEAD = { Suspension: ['SpringRate', 'MaxTravelUp', 'MaxTravelDown'], Wheel: ['BrakeTorque', 'Radius'], Tyre: ['LateralFriction', 'LongitudinalFriction'],
                     Steering: ['SteeringRatio'], Swaybar: ['Stiffness'] }[k] || [];
      const mk = d => control(['axles', i, k, d[0]], d, { text: srcLabel((info.fields[d[0]] || {}).src, info.conf), title: (info.fields[d[0]] || {}).src || info.conf });
      const ENGINE = { FixedAxleDistance: ['Ackermann axle distance', 'm', 'Ackermann steering: negative = automatic, 0 = off, else the distance to the fixed axle.'] };
      const known = new Set(defs.map(d => d[0]));
      const extraDefs = Object.entries(info.fields).filter(([n, f]) => f.engine && !known.has(n)).map(([n]) => {
        const v = getPath(st.wbDef, ['axles', i, k, n]);
        const span = Math.max(Math.abs(v || 0) * 2, 1);
        const e = ENGINE[n] || [n.replace(/_/g, ' '), '', 'Field reported by the engine in this build.'];
        return [n, e[0], e[1], +((v || 0) - span).toFixed(3), +((v || 0) + span).toFixed(3), +(span / 200).toPrecision(2), e[2]];
      });
      const usable = defs.concat(extraDefs).filter(d => info.fields[d[0]] !== undefined);
      const ctls = usable.filter(d => HEAD.includes(d[0])).map(mk);
      const rest = usable.filter(d => !HEAD.includes(d[0]));
      if (rest.length) {
        const more = document.createElement('details');
        more.className = 'more-numbers';
        more.innerHTML = `<summary>More numbers (${rest.length})</summary>`;
        rest.forEach(d => more.appendChild(mk(d)));
        ctls.push(more);
      }
      let extra = null;
      if (v.axles.length > 1) {
        extra = document.createElement('div');
        extra.className = 'copy-row';
        extra.innerHTML = `<button class="link-btn" type="button">Copy ${k} to the other axles</button>`;
        extra.querySelector('button').addEventListener('click', () => {
          st.cur.axles.forEach((ax, j) => { if (j !== i && ax[k]) for (const [n, val] of Object.entries(st.cur.axles[i][k])) if (k !== 'Suspension' || n !== 'MaxSteeringAngle') ax[k][n] = val; });
          changed();
          toast(`${k} copied to the other axles (steering angle kept per axle).`);
        });
      }
      return group(k, info.conf, ctls, extra, axleCharts(k, i));
    }
  }

  // ---- alignment: camber / toe from the hub angles, caster / SAI from the kingpin axis (align.js) ----------
  // alignment of one axle: decoded camber / toe / caster / SAI and convention-preserving setters (align.js)
  function alignAccess(i) {
    const AL = TireTuneAlign, a = st.data.vehicle.axles[i];
    const wheel = (a.wheels || []).find(w => Array.isArray(w.angles)) || (a.wheels || [])[0];
    const kp = (a.kingpins || []).find(k => Array.isArray(k.angles));
    const wGet = () => (wheel && st.cur.axles[i].align ? st.cur.axles[i].align.wheels[wheel.name] : null);
    const kGet = () => (kp && st.cur.axles[i].align ? st.cur.axles[i].align.kingpins[kp.id] : null);
    const wd = () => AL.decodeWheel(wGet()), kd = () => AL.decodeKingpin(kGet());
    const wEdit = ['roll', 'yaw'].includes(wd().family), kEdit = ['upright', 'z90', 'x90'].includes(kd().family);
    // magnitudes on screen; the sign stays the convention this model already uses
    const signed = (cur, mag) => (cur < 0 ? -mag : mag);
    const setW = (key, mag) => { if (!wEdit) return; const d = wd(); const c = key === 'camber' ? signed(d.camber, mag) : d.camber, t = key === 'toe' ? signed(d.toe, mag) : d.toe; dragSet(['axles', i, 'align', 'wheels', wheel.name], AL.encodeWheel(d, c, t)); };
    const setK = (key, mag) => { if (!kEdit) return; const d = kd(); const c = key === 'caster' ? signed(d.caster, mag) : d.caster, s = key === 'sai' ? signed(d.sai, mag) : d.sai; dragSet(['axles', i, 'align', 'kingpins', kp.id], AL.encodeKingpin(d, c, s)); };
    return { a, wheel, kp, wd, kd, wEdit, kEdit, setW, setK };
  }

  function alignGroup(i) {
    const AL = TireTuneAlign;
    const g = document.createElement('section');
    g.className = 'group';
    g.innerHTML = '<div class="group-head"><h3>Alignment</h3><span class="src">drag the dots</span></div>';
    const { a, wheel, kp, wd, kd, wEdit, kEdit, setW, setK } = alignAccess(i);
    const grid = document.createElement('div');
    grid.className = 'align-grid';
    const cards = [
      AL.diagram('camber', () => (wEdit ? wd().camber : null), m => setW('camber', m), wEdit),
      AL.diagram('toe', () => (wEdit ? wd().toe : null), m => setW('toe', m), wEdit),
      AL.diagram('caster', () => (kEdit ? kd().caster : null), m => setK('caster', m), kEdit),
      AL.diagram('sai', () => (kEdit ? kd().sai : null), m => setK('sai', m), kEdit),
    ];
    cards.forEach(c => { c.onDragEnd = () => changed(); grid.appendChild(c); });
    g.appendChild(grid);
    const notes = [];
    if (!wheel || !Array.isArray(wheel.angles)) notes.push('No hub angles on this axle yet (true for SampleCar-based and most custom cars). Set the left wheel\'s Angles once in Workbench, check it with "Show diag shapes", then tune it here. Keep the values small: most good setups sit at 0.1-1.5°.');
    else if (!wEdit) notes.push(`Hub angles ${wheel.angles.join(' ')} use a layout TireTune does not recognise; shown read-only.`);
    if (!kp) notes.push(a.index === 0 || (st.cur.axles[i].Suspension || {}).MaxSteeringAngle ? 'No kingpin axis on this axle: steering uses the wheel position (the pre-1.9 behaviour). BI recommends adding one with 3-6° caster.' : '');
    else if (!kEdit) notes.push(`Kingpin angles ${kp.angles.join(' ')} use a layout TireTune does not recognise; shown read-only.`);
    if (a.mirror === 0) notes.push('Mirror Wheel Position is off on this axle: the right side is set separately in Workbench.');
    else if (wEdit || kEdit) notes.push(`Edits ${wheel ? wheel.name : 'the left side'}; Mirror Wheel Position copies it to the right. Values are read in the convention this model already uses (sign as BI set it); confirm with "Show diag shapes" in game.`);
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = notes.filter(Boolean).join(' ');
    g.appendChild(p);
    st.cards.push(() => { if (!g.isConnected) return false; cards.forEach(c => c.draw()); return true; });
    return g;
  }

  function axleCharts(k, i) {
    const C = TireTuneContext;
    const args = () => [st.car.axles[i], st.carO.axles[i], st.car.static[i] / 2, st.carO.static[i] / 2];
    const set = (g, key, v) => { if (st.cur.axles[i][g]) dragSet(['axles', i, g, key], v); };
    if (k === 'Suspension') return [cardChart(() => C.axleGraph('Suspension', ...args(), { set })), cardChart(() => C.axleGraph('Damper', ...args(), { set }))];
    if (k === 'Wheel') return [cardChart(() => C.axleGraph('Wheel', ...args(), { set }))];
    if (k === 'Tyre') return [cardChart(() => C.axleGraph('Tyre', ...args(), { color: AX_HEX[i % 5], set, latF: (st.cur.axles[i].Tyre || {}).LateralFriction ?? (st.wbDef && st.wbDef.axles[i] && st.wbDef.axles[i].Tyre ? st.wbDef.axles[i].Tyre.LateralFriction : 1) }))];
    if (k === 'Steering') {
      const pick = (vals, g, key) => { const v = vals.axles[i][g] && vals.axles[i][g][key]; if (v != null) return v; const d = st.wbDef && st.wbDef.axles[i] && st.wbDef.axles[i][g]; return d ? d[key] : null; };
      return [cardChart(() => C.axleGraph('Steering', ...args(), {
        ratio: pick(st.cur, 'Steering', 'SteeringRatio'), ratioO: pick(st.orig, 'Steering', 'SteeringRatio'),
        max: pick(st.cur, 'Suspension', 'MaxSteeringAngle'), maxO: pick(st.orig, 'Suspension', 'MaxSteeringAngle'),
        maxSigned: pick(st.cur, 'Suspension', 'MaxSteeringAngle'), set }))];
    }
    return [];
  }

  function renderTyre() {
    let box = $('tab-tyre');
    const v = st.data.vehicle, pj = v.pacejka;
    box.innerHTML = '';
    if (!pj) {
      const legacy = v.legacyPacejka;
      const mass = (st.cur.rigidBody.Mass || 0);
      const presets = v.tyrePresets || [];
      const pick = presets.filter(p => mass >= p.fromMass).pop() || presets[0];
      box.innerHTML = `<div class="note"><strong>No 1.9 tyre model on this vehicle.</strong> ` +
        (legacy ? `It only has the pre-1.9 <code>Pacejka</code> slot (<code>${legacy.split('/').pop()}</code>, Pacejka94). ` : '') +
        `Stock 1.9 vehicles carry a <code>TyreModel Pacejka2002</code>; add one from a stock preset and it becomes fully tunable here ` +
        `(the legacy slot is left as it is). Needs Arma Reforger 1.9 (Experimental Tools until release).</div>` +
        `<div class="tpl-grid">${presets.map(p => `<button type="button" class="tpl${p === pick ? ' on' : ''}" data-ref="${p.ref}" style="--tpl:${p === pick ? '#4fb3ff' : '#64768d'}"><i></i><b>Add ${p.name}</b><span>${p.name === 'Car_80s' ? 'Cars and light vehicles' : p.name === 'Truck_80s' ? 'Trucks, from about 6 t' : 'Military 4x4s and APCs, 2.5-6 t'}${p === pick ? ' (suggested for ' + Math.round(mass) + ' kg)' : ''}</span></button>`).join('')}</div>` +
        `<p class="help">Opens Review with the one added line; nothing is written until you press Write files.</p>`;
      box.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => { st.addTyreModel = b.dataset.ref; review(); }));
      return;
    }
    const head = document.createElement('div');
    head.className = 'note';
    head.innerHTML = `<strong>${pj.class}</strong> shared by every wheel.<br>Config: <code>${pj.conf || 'inline in the prefab'}</code>` +
      (pj.conf ? (pj.confWritable ? ' (yours: edited in place)' : ' (read only: Apply writes a new config that inherits it)') : '');
    box.appendChild(head);
    const pr = document.createElement('div');
    pr.className = 'field-row';
    pr.innerHTML = `<label>Compare with stock<select class="input" id="preset-sel"><option value="">None</option>${(st.data.presets || []).map(p => `<option value="${p.name}">${p.name}</option>`).join('')}</select></label>
      <label>&nbsp;<button class="btn ghost" type="button" id="preset-load">Load preset values</button></label>`;
    box.appendChild(pr);
    pr.querySelector('#preset-sel').value = st.preset;
    pr.querySelector('#preset-sel').addEventListener('change', e => { st.preset = e.target.value; drawCharts(); updateCards(); });
    pr.querySelector('#preset-load').addEventListener('click', () => {
      const p = (st.data.presets || []).find(x => x.name === st.preset);
      if (!p) { toast('Pick a stock preset to compare first.'); return; }
      for (const [g, gv] of Object.entries(st.cur.pacejka.groups)) for (const k of Object.keys(gv)) if (p.coeff[k] != null) gv[k] = p.coeff[k];
      for (const k of ['NominalLoad', 'NominalRadius']) if (p.coeff[k] != null) st.cur.pacejka[k] = p.coeff[k];
      renderTyre(); changed();
      toast(`Loaded ${p.name} coefficients. Review shows exactly what changes.`);
    });
    const ctls = PAC_KEY.filter(d => !d[7] || (st.cur.pacejka.groups[d[7]] && d[0] in st.cur.pacejka.groups[d[7]])).map(d => {
      const path = d[7] ? ['pacejka', 'groups', d[7], d[0]] : ['pacejka', d[0]];
      const f = d[7] ? pj.groups[d[7]].fields[d[0]] : pj.top[d[0]];
      return control(path, d, { text: srcLabel(f && f.src), title: f && f.src });
    });
    const C = TireTuneContext, FEEL = TireTuneFeel;
    const flat = () => S.flatPacejka(st.cur.pacejka);
    const pset = (key, v) => {
      if (key === 'NominalLoad' || key === 'NominalRadius') { dragSet(['pacejka', key], v); return; }
      for (const [g, gv] of Object.entries(st.cur.pacejka.groups)) if (key in gv) { dragSet(['pacejka', 'groups', g, key], v); return; }
    };
    // feel tiles: the curve in plain words, live
    const tiles = document.createElement('div');
    tiles.className = 'feel-tiles';
    box.appendChild(tiles);
    st.cards.push(() => {
      if (!tiles.isConnected) return false;
      const F0 = flat().NominalLoad || 4000, s = FEEL.shape('lat', flat(), F0), so = FEEL.shape('lat', S.flatPacejka(st.orig.pacejka), F0);
      const l = FEEL.shape('lon', flat(), F0), lo = FEEL.shape('lon', S.flatPacejka(st.orig.pacejka), F0);
      const w = FEEL.words('lat', s), wl = FEEL.words('lon', l);
      const tile = (title, word, val, now, was, max, tip) => `<div class="feel" title="${tip}"><span>${title}</span><b>${word}</b><em>${val}</em>
        <div class="feel-bar"><i style="width:${Math.min(100, now / max * 100)}%"></i><u style="left:${Math.min(100, was / max * 100)}%"></u></div></div>`;
      tiles.innerHTML =
        tile('Cornering grip', w.grip, `mu ${s.mu.toFixed(2)}`, s.mu, so.mu, 1.8, 'Peak sideways grip at nominal load (the top of the cornering curve)') +
        tile('Turn-in', w.bite, `80 % grip at ${s.bite.toFixed(1)}°`, 12 - Math.min(12, s.bite), 12 - Math.min(12, so.bite), 12, 'How little slip the tyre needs to bite: sharp tyres respond to small steering inputs') +
        tile('Breakaway', w.brk, `${Math.round(s.drop * 100)} % drop after peak`, s.drop, so.drop, 0.5, 'How much grip is lost once the tyre slides: progressive is forgiving, snappy is twitchy') +
        tile('Drive / brake grip', wl.grip, `mu ${l.mu.toFixed(2)}, peak at ${l.peakX.toFixed(0)} % slip`, l.mu, lo.mu, 1.8, 'Peak traction and braking grip at nominal load');
      return true;
    });
    for (const ax of ['lat', 'lon']) {
      const sec = document.createElement('section');
      sec.className = 'group feel-editor';
      sec.innerHTML = `<div class="group-head"><h3>${FEEL.AXES[ax].name} curve</h3><span class="src">drag the dots</span></div>`;
      sec.appendChild(cardChart(() => {
        const r = FEEL.editor(ax, flat, S.flatPacejka(st.orig.pacejka), presetCoeff(), pset);
        r.note = ax === 'lat'
          ? 'Blue: grip (up/down) and where it peaks (left/right). Green: turn-in, how fast grip builds. Amber: what is left after the limit. Thin lines: light and heavy load. Dashed: original.'
          : 'Same handles for traction and braking: peak grip, how quickly it bites with wheel slip, and what is left when the wheel spins or locks.';
        return r;
      }));
      box.appendChild(sec);
    }
    const pacGraph = g => () => {
      const r = C.pacGraph(g, S.flatPacejka(st.cur.pacejka), S.flatPacejka(st.orig.pacejka), presetCoeff());
      if (r) r.note = C.GROUP_INFO[g];
      return r;
    };
    box.appendChild(group('Load sensitivity', '', ctls.filter((_, n) => n < 2), null, [cardChart(pacGraph('Reference'))]));
    const fine = document.createElement('details');
    fine.className = 'more-numbers';
    fine.innerHTML = '<summary>Fine-tune the handles as numbers</summary>';
    ctls.slice(2).forEach(c => fine.appendChild(c));
    box.appendChild(fine);
    const expert = document.createElement('details');
    expert.className = 'expert';
    expert.innerHTML = '<summary>Expert: all Pacejka coefficients, by what they shape</summary>';
    box.appendChild(expert);
    const realBox = box;
    box = expert;
    for (const [g, gv] of Object.entries(pj.groups)) {
      const det = document.createElement('details');
      det.className = 'pac-group';
      det.innerHTML = `<summary><b>${g.replace(/([a-z])([A-Z])/g, '$1 $2')}</b><span>${C.GROUP_INFO[g] || ''}</span></summary>`;
      det.appendChild(cardChart(pacGraph(g)));
      for (const k of Object.keys(gv.fields)) {
        const meta = C.PAC_META[k] || [k, ''];
        const o = getPath(st.orig, ['pacejka', 'groups', g, k]);
        const [lo, hi, step] = C.rangeFor(k, typeof o === 'number' ? o : 0);
        det.appendChild(control(['pacejka', 'groups', g, k], [k, `${meta[0]} <span class="code">${k}</span>`, '', lo, hi, step, meta[1]],
          { text: srcLabel(gv.fields[k].src), title: gv.fields[k].src }));
      }
      det.addEventListener('toggle', () => { if (det.open) updateCards(); });
      box.appendChild(det);
    }
    box = realBox;
  }


  // ---------------------------------------------------------------------------------------------------------------
  // Fun templates: one-click wild setups, computed from the vehicle's ORIGINAL values (so they work on any vehicle
  // and switching templates does not stack). Revert all undoes; Review writes one you like.
  const TEMPLATES = [
    { id: 'drift', name: 'Drift King', color: '#ef6d78', tag: 'Loose rear, sticky front, all power to the back. Throw it sideways.',
      apply: t => { t.axles((a, i, n) => { const rear = i > 0; t.mul(a, 'Tyre', 'LateralFriction', rear ? 0.55 : 1.15); if (n > 1) a.TorqueShare = rear ? +(1 / (n - 1)).toFixed(3) : 0; });
                    t.com(0, -0.05, -0.25); t.pac('Lateral', 'PDY1', 0.92); } },
    { id: 'ice', name: 'Ice Rink', color: '#7fd3ff', tag: 'A quarter of the grip. Every corner is a suggestion.',
      apply: t => { t.axles(a => { t.mul(a, 'Tyre', 'LateralFriction', 0.28); t.mul(a, 'Tyre', 'LongitudinalFriction', 0.28); }); t.pac('Lateral', 'PDY1', 0.6); t.pac('Longitudinal', 'PDX1', 0.6); } },
    { id: 'moon', name: 'Moon Buggy', color: '#b18cff', tag: 'Featherweight, pillow springs, twice the travel. Bounce over everything.',
      apply: t => { t.mass(0.45); t.axles(a => { t.mul(a, 'Suspension', 'SpringRate', 0.35); t.mul(a, 'Suspension', 'CompressionDamper', 0.3); t.mul(a, 'Suspension', 'RelaxationDamper', 0.3); t.mul(a, 'Suspension', 'MaxTravelUp', 2); t.mul(a, 'Suspension', 'MaxTravelDown', 2.2); }); t.com(0, 0.15, 0); } },
    { id: 'glue', name: 'Glue Tyres', color: '#5ed6a0', tag: 'Race slicks made of superglue. Low, stiff, absurd grip.',
      apply: t => { t.axles(a => { t.mul(a, 'Tyre', 'LateralFriction', 2.1); t.mul(a, 'Tyre', 'LongitudinalFriction', 2.1); t.mul(a, 'Suspension', 'SpringRate', 1.8); t.mul(a, 'Suspension', 'CompressionDamper', 1.5); }); t.pac('Lateral', 'PDY1', 1.5); t.pac('Longitudinal', 'PDX1', 1.5); t.com(0, -0.2, 0); } },
    { id: 'monster', name: 'Monster Truck', color: '#f0b35a', tag: 'Heavy, tall, soft and huge travel. Crush the car park.',
      apply: t => { t.mass(1.5); t.axles(a => { t.mul(a, 'Suspension', 'MaxTravelUp', 2.5); t.mul(a, 'Suspension', 'MaxTravelDown', 2.5); t.mul(a, 'Suspension', 'SpringRate', 0.9); t.mul(a, 'Tyre', 'LateralFriction', 1.3); t.mul(a, 'Wheel', 'BrakeTorque', 1.6); }); t.com(0, 0.35, 0); } },
    { id: 'bouncy', name: 'Bouncy Castle', color: '#ff8fb1', tag: 'Dampers removed. It will not stop bouncing. Ever.',
      apply: t => { t.axles(a => { t.mul(a, 'Suspension', 'CompressionDamper', 0.06); t.mul(a, 'Suspension', 'RelaxationDamper', 0.06); t.mul(a, 'Suspension', 'SpringRate', 0.7); }); } },
    { id: 'vault', name: 'Bank Vault', color: '#93a4ba', tag: 'Triple the mass, same brakes. Momentum is a lifestyle.',
      apply: t => { t.mass(3); t.axles(a => { t.mul(a, 'Suspension', 'SpringRate', 2.2); t.mul(a, 'Suspension', 'CompressionDamper', 1.8); }); t.com(0, -0.1, 0); } },
    { id: 'rocket', name: 'Rocket Brakes', color: '#4fb3ff', tag: 'Four times the brake torque. Stoppies and instant lock-ups.',
      apply: t => { t.axles(a => { t.mul(a, 'Wheel', 'BrakeTorque', 4); }); t.com(0, 0.1, 0); } },
  ];

  function applyTemplate(tpl) {
    const c = clone(st.orig), base = st.wbDef || {};
    const val = (obj, grp, key, i) => {
      const v = obj[grp] && obj[grp][key];
      if (v != null) return v;
      const d = base.axles && base.axles[i] && base.axles[i][grp] && base.axles[i][grp][key];
      return d != null ? d : null;
    };
    const t = {
      axles: fn => c.axles.forEach((a, i) => fn(a, i, c.axles.length)),
      mul: (a, grp, key, k) => {
        const i = c.axles.indexOf(a), v = val(a, grp, key, i);
        if (v == null || !a[grp]) return;
        const def = (AXLE_DEFS[grp] || []).find(d => d[0] === key);
        let n = v * k;
        if (def) n = Math.max(def[3], Math.min(def[4] * 2, n));
        a[grp][key] = +n.toFixed(4);
      },
      mass: k => { if (c.rigidBody.Mass != null) c.rigidBody.Mass = Math.round(c.rigidBody.Mass * k); },
      com: (dx, dy, dz) => { const v = c.rigidBody.CenterOfMass; if (Array.isArray(v)) c.rigidBody.CenterOfMass = [+(v[0] + dx).toFixed(3), +(v[1] + dy).toFixed(3), +(v[2] + dz).toFixed(3)]; },
      pac: (g, key, k) => { const gr = c.pacejka && c.pacejka.groups[g]; if (gr && gr[key] != null) gr[key] = +(gr[key] * k).toFixed(4); },
    };
    tpl.apply(t);
    st.cur = c;
    st.template = tpl.id;
    renderControls();
    changed();
    toast(`${tpl.name} applied. Watch the preview; Review & apply writes it, Revert all undoes it.`);
  }

  function renderTemplates() {
    const box = $('tab-fun');
    if (!box) return;
    box.innerHTML = `<p class="help" style="margin-top:12px">One-click wild setups, built from this vehicle's own values. Pick one, watch the preview, then Revert all or Review &amp; apply. Physics only: meshes and wheels look the same.</p><div class="tpl-grid"></div>`;
    const grid = box.querySelector('.tpl-grid');
    for (const tpl of TEMPLATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpl' + (st.template === tpl.id ? ' on' : '');
      b.dataset.tpl = tpl.id;
      b.style.setProperty('--tpl', tpl.color);
      b.innerHTML = `<i></i><b>${tpl.name}</b><span>${tpl.tag}</span>`;
      b.addEventListener('click', () => applyTemplate(tpl));
      grid.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // change tracking
  function getPath(o, p) { return p.reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) { const last = p[p.length - 1]; const parent = getPath(o, p.slice(0, -1)); parent[last] = v; }
  function same(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
    if (a == null || b == null) return a == b;
    return Math.abs(a - b) < 1e-9;
  }
  function countDiffs(a, b) {
    const vector = Array.isArray(a) && a.every(x => typeof x === 'number');   // CenterOfMass: one value
    if (vector || typeof a !== 'object' || a === null) return same(a, b) ? 0 : 1;
    let n = 0;
    for (const k of Object.keys(a)) n += countDiffs(a[k], b ? b[k] : undefined);
    return n;
  }
  function changed() {
    const n = countDiffs(st.cur, st.orig);
    $('dirty-count').textContent = n;
    $('btn-review').disabled = n === 0 || !st.data.vehicle.writable;
    $('btn-reset-all').disabled = n === 0;
    document.querySelectorAll('.ctl').forEach(c => c._sync && c._sync());
    clearTimeout(st.recalcTimer);
    st.recalcTimer = setTimeout(() => recalc(false), 60);
  }
  function geoChanged() {
    clearTimeout(st.geoTimer);
    st.geoTimer = setTimeout(() => api('/api/geometry', st.geo).catch(() => {}), 400);
    recalc(true);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // simulation + views
  function fillDefaults(v, d) {
    if (!d || typeof v !== 'object' || v === null) return;
    for (const k of Object.keys(v)) {
      if (v[k] == null && d[k] != null) v[k] = clone(d[k]);
      else if (typeof v[k] === 'object' && !Array.isArray(v[k])) fillDefaults(v[k], d[k]);
      else if (Array.isArray(v[k]) && v[k].length && typeof v[k][0] === 'object') v[k].forEach((x, i) => fillDefaults(x, d[k] && d[k][i]));
    }
  }

  function simVals(vals) {
    // the simulation needs numbers where the prefab relies on engine defaults (Workbench-resolved when known)
    const v = clone(vals);
    fillDefaults(v, st.wbDef);
    v.axles.forEach((a, i) => {
      a.Suspension = a.Suspension || {};
      a.Wheel = a.Wheel || {};
      if (a.Wheel.Radius == null) a.Wheel.Radius = st.geo.axles[i] ? st.geo.axles[i].y : 0.35;
    });
    return v;
  }

  function recalc(relayout) {
    if (!st.cur) return;
    const car = S.buildCar(simVals(st.cur), st.geo), carO = S.buildCar(simVals(st.orig), st.geo);
    st.car = car; st.carO = carO;
    let frames, ghost = [];
    if (st.scenario === 'corner') { frames = S.corner(car, st.speed, st.radius * st.dir); ghost = S.corner(carO, st.speed, st.radius * st.dir); }
    else if (st.scenario === 'brake') frames = S.brake(car, st.speed);
    else frames = S.launch(car);
    st.frames = frames;
    stage.setScene(car, frames, ghost, st.scenario);
    drawCharts();
    updateCards();
    renderReadouts(car, carO, frames);
  }

  function drawCharts() {
    if (!st.car) return;
    const series = [], seriesL = [];
    const push = (car, ghost) => car.axles.forEach((a, i) => {
      const Fz = car.static[i] / 2, col = AX_HEX[i % 5], name = `A${i + 1}`;
      series.push({ name, color: col, ghost, pts: S.curveLateral(a, Fz) });
      seriesL.push({ name, color: col, ghost, pts: S.curveLongitudinal(a, Fz) });
    });
    push(st.carO, true);
    const preset = (st.data.presets || []).find(p => p.name === st.preset);
    if (preset) {
      const a = { coeff: { ...P.source, ...preset.coeff } }, Fz = st.car.static[0] / 2;
      series.push({ name: preset.name, color: '#7d8ea5', preset: true, pts: S.curveLateral(a, Fz) });
      seriesL.push({ name: preset.name, color: '#7d8ea5', preset: true, pts: S.curveLongitudinal(a, Fz) });
    }
    push(st.car, false);
    chartLat.set(series, 0, 14);
    chartLon.set(seriesL, 0, 40);
  }

  // live operating point on the charts follows the animation
  stage.onFrame = (p, fr) => {
    $('in-scrub').value = Math.round(p * 1000);
    if (!fr || !fr.axles) return;
    if (st.scenario === 'corner') chartLat.mark(fr.axles.map((a, i) => ({ series: `A${i + 1}`, x: Math.abs(a.alpha || 0) * 180 / Math.PI })));
    else chartLat.mark([]);
    if (st.scenario !== 'corner') chartLon.mark(fr.axles.map((a, i) => ({ series: `A${i + 1}`, x: a.locked ? 40 : Math.min(40, (a.use ? Math.max(...a.use) : 0) * 12) })));
    else chartLon.mark([]);
    hud(fr);
  };

  function hud(fr) {
    const items = [['speed', ((fr.U || 0) * 3.6).toFixed(0) + ' km/h']];
    if (st.scenario === 'corner') { items.push(['lateral', ((fr.ay || 0) / 9.81).toFixed(2) + ' g'], ['yaw', ((fr.r || 0) * 57.3).toFixed(0) + ' °/s'], ['body slip', (Math.atan2(fr.v || 0, fr.U || 1) * 57.3).toFixed(1) + ' °']); }
    else items.push(['accel', ((fr.ax || 0) / 9.81).toFixed(2) + ' g'], ['distance', (fr.x || 0).toFixed(1) + ' m'], ['time', (fr.t || 0).toFixed(2) + ' s']);
    $('stage-hud').innerHTML = items.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
  }

  function renderReadouts(car, carO, frames) {
    const sum = S.summary(car, st.speed, st.radius), sumO = S.summary(carO, st.speed, st.radius);
    const b = $('balance');
    b.className = 'balance ' + sum.tone;
    b.innerHTML = `${sum.balance}<small>Steady ${st.speed} km/h on a ${st.radius} m bend: ${sum.ayG.toFixed(2)} g. ${sum.balance !== sumO.balance ? 'Was: ' + sumO.balance + '.' : ''}</small>`;
    const stopNew = st.scenario === 'brake' ? frames[frames.length - 1].x : S.brake(car, st.speed)[S.brake(car, st.speed).length - 1].x;
    const bO = S.brake(carO, st.speed), stopOld = bO[bO.length - 1].x;
    const delta = (a, b2, better) => {
      const d = a - b2;
      if (Math.abs(d) < 0.05 * Math.max(1, Math.abs(b2)) * 0.1) return '';
      const good = better === 'up' ? d > 0 : d < 0;
      return `<em class="${good ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d.toFixed(1)}</em>`;
    };
    $('metrics').innerHTML = [
      ['Grip limit on bend', sum.limitKmh.toFixed(0), 'km/h', delta(sum.limitKmh, sumO.limitKmh, 'up')],
      [`Stop from ${st.speed}`, stopNew.toFixed(1), 'm', delta(stopNew, stopOld, 'down')],
      ['Front weight', (sum.frontShare * 100).toFixed(1), '%', ''],
      ['Mass', (car.mass).toFixed(0), 'kg', ''],
    ].map(([k, v, u, d]) => `<div class="metric"><span>${k}</span><b>${v}</b> <span style="display:inline">${u}</span>${d}</div>`).join('');
    $('axle-metrics').innerHTML = car.axles.map((a, i) => {
      const r = sum.ride[i], use = sum.use[i];
      const sagPct = r.travel ? Math.min(100, r.sag / r.travel * 100) : 0;
      return `<div class="ax-card"><header><i style="background:${AX_COLORS[i % 5]}"></i>Axle ${i + 1}<span class="muted" style="margin-left:auto;font-weight:400">${(car.static[i] / 1000).toFixed(1)} kN static</span></header>
        <div class="ax-row"><span>grip used on bend</span><span>${(use * 100).toFixed(0)}%</span></div>
        <div class="bar"><div style="width:${Math.min(100, use * 100)}%;background:${TireTuneStage.useColor(use)}"></div></div>
        <div class="ax-row"><span>static sag / travel</span><span>${(r.sag * 1000).toFixed(0)} / ${(r.travel * 1000).toFixed(0)} mm</span></div>
        <div class="bar"><div style="width:${sagPct}%;background:${sagPct > 80 ? 'var(--bad)' : 'var(--accent-2)'}"></div></div>
        <div class="ax-row"><span>ride ${r.freq.toFixed(2)} Hz</span><span>damping ${r.zeta.toFixed(2)}</span></div></div>`;
    }).join('');
  }

  function renderLint() {
    const l = st.data.lint || [];
    $('lint-count').textContent = l.length;
    $('lint').innerHTML = l.length ? l.map(x => `<li class="${x.level}"><b>${x.title}</b>${x.detail}</li>`).join('')
      : '<li class="empty">No problems found in the saved setup.</li>';
  }

  function renderWb() {
    const d = st.data, v = d.vehicle;
    $('wb-info').innerHTML = `<div>Prefab <code>${v.prefab}</code></div>
      <div>New configs go to <code>${d.targetAddon || '-'}</code></div>
      <div>Net API port <code>${d.wbPort}</code>. Apply asks Workbench to register and reload; otherwise press Reimport in the plugin.</div>
      <div>Writable addons: <code>${(d.addons || []).join(', ') || 'none'}</code></div>
      ${(d.addons || []).length === 1 && d.addons[0] === 'TireTune_Workbench' ? '<div style="color:var(--warn)">Only TireTune itself is loaded. To tune your mod\'s vehicles, open your mod\'s project in Workbench with TireTune_Workbench as a dependency (or add your mod to TireTune\'s addon.gproj), then Open selected vehicle again.</div>' : ''}
      ${d.vehicle.missing.length ? `<div style="color:var(--warn)">Not readable: <code>${d.vehicle.missing.join(', ')}</code></div>` : ''}
      ${(d.wbMismatch || []).length ? `<div style="color:var(--warn)">Workbench resolves ${d.wbMismatch.length} value(s) differently than the text: ${d.wbMismatch.slice(0, 6).map(m => `<code>${m.key}</code> ${m.text} vs ${m.workbench}`).join(', ')}. Reopen the vehicle from the plugin.</div>` : (d.source === 'dev' ? '' : '<div style="color:var(--ok)">Values match Workbench.</div>')}`;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // review + apply
  async function review() {
    let r;
    try { r = await api('/api/preview', { edits: editsPayload() }); } catch (e) { toast(e.message, true); return; }
    const box = $('review-files');
    box.innerHTML = r.files.length ? '' : '<p class="muted">No file changes: the edited values already match the files.</p>';
    for (const f of r.files) {
      const div = document.createElement('div');
      div.className = 'diff';
      const lines = f.diff.split('\n').filter(l => !l.startsWith('---') && !l.startsWith('+++')).map(l => {
        const esc = l.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return l.startsWith('+') ? `<span class="add">${esc}</span>` : l.startsWith('-') ? `<span class="del">${esc}</span>` : l.startsWith('@@') ? `<span class="hunk">${esc}</span>` : esc + '\n';
      }).join('');
      div.innerHTML = `<h4><svg width="14" height="14"><use href="#i-file"/></svg>${f.path}${f.new ? '<span class="new">new</span>' : ''}</h4><pre>${lines}</pre>`;
      box.appendChild(div);
    }
    $('btn-apply').disabled = !r.files.length;
    if (!$('review').open) $('review').showModal();
  }

  function editsPayload() {
    return { rigidBody: st.cur.rigidBody, axles: st.cur.axles, pacejka: st.cur.pacejka, pacejkaTarget: $('pac-target').value, addTyreModel: st.addTyreModel || null };
  }

  async function applyNow() {
    const btn = $('btn-apply');
    btn.disabled = true;
    try {
      const r = await api('/api/apply', { edits: editsPayload() });
      $('review').close();
      const n = (r.changed || []).length + (r.created || []).length;
      const ri = r.reimport || {};
      toast(n ? `Wrote ${n} file(s). ${ri.ok ? 'Workbench reloaded them.' : (ri.reason || 'Press Reimport in the TireTune plugin.')} Reopen the world to drive it.` : (r.message || 'Nothing changed.'), !ri.ok && n > 0);
      await load();
    } catch (e) {
      toast(e.message, true);
    } finally { btn.disabled = false; }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // geometry capture + live telemetry (Net API handler TT_NetApi, Workbench with the vehicle in the world)
  async function captureGeometry() {
    let r;
    try { r = await api('/api/capture', {}); } catch (e) { toast(e.message, true); return; }
    if (r.status !== 'OK' || !r.wheels || !r.wheels.length) { toast(r.message || r.error || 'Workbench did not return wheel positions (is the vehicle in the open world?).', true); return; }
    const byName = Object.fromEntries(r.wheels.map(w => [w.name, w]));
    const axles = st.data.vehicle.axles.map((a, i) => {
      const ws = a.wheels.map(w => byName[w.name]).filter(Boolean);
      if (!ws.length) return st.geo.axles[i];
      const z = ws.reduce((s, w) => s + w.pos[2], 0) / ws.length, y = ws.reduce((s, w) => s + w.pos[1], 0) / ws.length;
      const xs = ws.map(w => w.pos[0]);
      return { z: +z.toFixed(3), y: +y.toFixed(3), track: +(xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : st.geo.axles[i].track).toFixed(3) };
    });
    // ground from the contact points when the wheels touch something, else under the fully extended wheels
    const touching = r.wheels.filter(w => w.contact && w.contactPos);
    const ground = touching.length ? Math.min(...touching.map(w => w.contactPos[1])) : Math.min(...r.wheels.map(w => w.pos[1] - w.radius));
    st.geo = { axles, groundY: +ground.toFixed(3), source: 'live' };
    api('/api/geometry', st.geo).catch(() => {});
    renderChassis(); recalc(true);
    toast(`Captured ${r.wheels.length} wheels from ${r.entity || 'the vehicle'}.`);
  }

  function toggleLive() {
    st.live = !st.live;
    $('btn-live').setAttribute('aria-pressed', st.live);
    clearInterval(st.liveTimer);
    if (!st.live) { stage.play(st.playing !== false); recalc(false); return; }
    stage.play(false);
    st.liveTimer = setInterval(async () => {
      let r;
      try { r = await api('/api/live'); } catch (e) { return; }
      if (r.status !== 'OK') { $('stage-hud').innerHTML = `<div>live<b>${r.message || 'waiting for Workbench play mode'}</b></div>`; return; }
      const fr = liveFrame(r);
      stage.draw(fr); hud(fr);
    }, 100);
  }

  function liveFrame(r) {
    // compression from the hub at full extension to the contact point, load from the spring (approximate)
    const car = st.car, byName = Object.fromEntries((r.wheels || []).map(w => [w.name, w]));
    const axles = st.data.vehicle.axles.map((a, i) => {
      const ws = a.wheels.map(w => byName[w.name]);
      const ax = car.axles[i];
      const loads = ws.map(w => (w && w.contact ? Math.max(0, w.compression) * ax.spring : 0));
      const use = ws.map(w => (w ? Math.min(1.1, Math.hypot(w.latSlip || 0, w.lonSlip || 0) / 0.2) : 0));
      return { loads, use, steer: i === 0 ? (r.steering || 0) * ax.steerMax * Math.PI / 180 : 0, Fy: -(ws[0] && ws[0].latSlip) || 0 };
    });
    return { t: 0, U: r.speed || 0, v: r.lateral || 0, ay: 0, ax: 0, x: 0, y: 0, psi: 0, axles };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tire Lab bridge (the friend's tool in an iframe, driven through its widget-state hooks)
  const RIG = {
    steeringRatio: ['Steering', 'SteeringRatio'], powerSteering: ['Steering', 'PowerSteeringFactor'], steeringDamping: ['Steering', 'SteeringDamping'],
    mechanicalTrail: ['Steering', 'MechanicalTrail'], scrubRadius: ['Steering', 'ScrubRadius'], maxSteeringAngle: ['Suspension', 'MaxSteeringAngle'],
    springRate: ['Suspension', 'SpringRate'], compressionDamper: ['Suspension', 'CompressionDamper'], relaxationDamper: ['Suspension', 'RelaxationDamper'],
    travelUp: ['Suspension', 'MaxTravelUp'], travelDown: ['Suspension', 'MaxTravelDown'], rayOffset: ['Suspension', 'RayStartOffsetUp'],
    wheelRadius: ['Wheel', 'Radius'], wheelMass: ['Wheel', 'Mass'], wheelRatio: ['Wheel', 'Ratio'], brakeTorque: ['Wheel', 'BrakeTorque'],
    handbrakeFactor: ['Wheel', 'HandbrakeTorqueFactor'], roughness: ['Tyre', 'Roughness'], longitudinalFriction: ['Tyre', 'LongitudinalFriction'],
    lateralFriction: ['Tyre', 'LateralFriction'], rollingResistance: ['Tyre', 'RollingResistance'], rollingDrag: ['Tyre', 'RollingDrag'], tread: ['Tyre', 'Tread'],
  };
  const num1 = (v, d = 2) => (v == null ? '-' : (+v).toFixed(d));
  globalThis.TireTuneUI = {
    // ---- hooks for the 3D corner rig (rig3d.js) ----
    ready: () => !!(st.cur && st.car),
    axleCount: () => (st.cur ? st.cur.axles.length : 0),
    value: path => getPath(st.cur, path),
    engineDefault: path => getPath(st.wbDef, path),
    set: (path, v) => { if (getPath(st.cur, path.slice(0, -1))) dragSet(path, v); },
    done: () => changed(),
    align: i => { const x = alignAccess(i), w = x.wd(), k = x.kd(); return { camber: w.camber || 0, toe: w.toe || 0, caster: k.caster || 0, sai: k.sai || 0, wEdit: x.wEdit, kEdit: x.kEdit, hasKingpin: !!x.kp }; },
    setAlign: (i, key, mag) => { const x = alignAccess(i); if (key === 'camber' || key === 'toe') x.setW(key, mag); else x.setK(key, mag); },
    pacejka: () => (st.cur && st.cur.pacejka ? S.flatPacejka(st.cur.pacejka) : null),
    tyreSize: () => st.tyreSize || null,
    car: () => st.car,
    frame: () => stage.frameAt(stage.t),
    scenario: () => st.scenario,
    refresh: () => { updateCards(); document.querySelectorAll('.ctl').forEach(c => c._sync && c._sync()); },
    // hover card: the part's key numbers, live
    partSummary(p) {
      const car = st.car, cur = st.cur;
      if (!car) return p.label;
      const fr = stage.frameAt(stage.t), i = p.axle, ax = cur.axles[i] || {}, sa = car.axles[i];
      const k = p.side > 0 ? 0 : 1, af = fr && fr.axles && fr.axles[i];
      const live = af && af.loads ? `<br>now: ${(af.loads[k] / 1000).toFixed(1)} kN, grip used ${Math.round((af.use ? af.use[k] : 0) * 100)} %` : '';
      const sum = S.summary(car, st.speed, st.radius);
      if (p.kind === 'body') return `<b>Body</b><br>${Math.round(car.mass)} kg, front weight ${(sum.frontShare * 100).toFixed(1)} %<br><i>click to adjust mass and CoM</i>`;
      if (p.kind === 'com') return `<b>Centre of mass</b><br>${(cur.rigidBody.CenterOfMass || []).map(v => num1(v)).join(' / ')} m (lateral / height / fwd)<br>height above ground ${num1(car.h)} m`;
      if (p.kind === 'tyre') return `<b>${p.label}</b><br>lateral friction ${num1((ax.Tyre || {}).LateralFriction)}, longitudinal ${num1((ax.Tyre || {}).LongitudinalFriction)}${live}<br><i>click to adjust; the shared tyre model is in Tyre model</i>`;
      if (p.kind === 'wheel') return `<b>${p.label}</b><br>radius ${num1(sa.radius, 3)} m, brake ${Math.round(sa.brakeTorque)} N m${live}`;
      if (p.kind === 'spring') { const r = sum.ride[i]; return `<b>${p.label}</b><br>${Math.round(sa.spring / 1000)} N/mm, ride ${num1(r.freq)} Hz, damping ${num1(r.zeta)}<br>sag ${Math.round(r.sag * 1000)} of ${Math.round(r.travel * 1000)} mm travel${live}`; }
      if (p.kind === 'steering') return `<b>${p.label}</b><br>lock ${num1(sa.steerMax, 1)} deg, ratio ${num1((ax.Steering || {}).SteeringRatio, 1)}`;
      if (p.kind === 'drive') return `<b>${p.label}</b><br>torque share ${num1(ax.TorqueShare)}`;
      return p.label;
    },
    // inspector: the same controls and graphs as the side panel, for the clicked part
    partPanel(p) {
      const wrap = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'insp-head';
      head.innerHTML = `<b>${p.label}</b><button class="icon-btn sm" type="button" aria-label="Close">&times;</button>`;
      head.querySelector('button').addEventListener('click', () => { if (wrap.closest('.rig-inspector') && globalThis.TireTuneRig) TireTuneRig.select(null); else if (globalThis.TireTune3D) TireTune3D.select(null); });
      wrap.appendChild(head);
      const kinds = { tyre: 'Tyre', wheel: 'Wheel', spring: 'Suspension', steering: 'Steering', drive: 'Drive' };
      if (p.kind === 'align') wrap.appendChild(alignGroup(p.axle));
      else if (p.kind === 'body' || p.kind === 'com') wrap.appendChild(bodyGroup());
      else if (kinds[p.kind] && (kinds[p.kind] === 'Drive' || st.cur.axles[p.axle][kinds[p.kind]])) wrap.appendChild(axleGroup(p.axle, kinds[p.kind]));
      else wrap.insertAdjacentHTML('beforeend', '<p class="help">This axle has no such object in the prefab.</p>');
      if (p.kind === 'tyre' && st.cur.pacejka) {
        const b = document.createElement('button');
        b.className = 'btn ghost sm';
        b.type = 'button';
        b.textContent = 'Shared tyre model (Pacejka) in the side panel';
        b.addEventListener('click', () => document.querySelector('[data-tab=tyre]').click());
        wrap.appendChild(b);
      }
      return wrap;
    },
  };

  globalThis.TireTuneBridge = {
    initialState() {
      if (!st.cur) return null;
      const d = P.defaults(), car = st.car, sum = S.summary(car, st.speed, st.radius);
      d.mass = Math.min(5000, Math.max(400, car.mass));
      d.frontShare = Math.min(0.8, Math.max(0.2, sum.frontShare));
      d.wheelbase = car.wheelbase; d.track = car.axles[0].track; d.cg = car.h; d.speed = st.speed; d.radius = st.radius;
      d.coeff = { ...S.flatPacejka(st.cur.pacejka) };
      const rig = ax => { const o = {}; for (const [k, [g, n]] of Object.entries(RIG)) { const v = ax[g] && ax[g][n]; if (Number.isFinite(v)) o[k] = v; } return o; };
      d.rig.values.front = { ...d.rig.values.front, ...rig(st.cur.axles[0]) };
      d.rig.values.rear = { ...d.rig.values.rear, ...rig(st.cur.axles[st.cur.axles.length - 1]) };
      d.origin = 'TireTune: ' + st.data.vehicle.prefab;
      return d;
    },
    fromTireLab(data) {
      if (!data || !st.cur || !st.cur.pacejka) return;
      for (const [g, gv] of Object.entries(st.cur.pacejka.groups)) for (const k of Object.keys(gv)) if (Number.isFinite(data.coeff[k])) gv[k] = data.coeff[k];
      for (const k of ['NominalLoad', 'NominalRadius']) if (Number.isFinite(data.coeff[k])) st.cur.pacejka[k] = data.coeff[k];
      const back = (ax, vals) => { for (const [k, [g, n]] of Object.entries(RIG)) if (ax[g] && n in ax[g] && Number.isFinite(vals[k]) && !(ax[g][n] == null && vals[k] === P.defaults().rig.values.front[k])) ax[g][n] = vals[k]; };
      back(st.cur.axles[0], data.rig.values.front);
      if (st.cur.axles.length > 1) back(st.cur.axles[st.cur.axles.length - 1], data.rig.values.rear);
      changed();
    },
  };

  function showView(view) {
    st.view = view;
    document.querySelectorAll('#view-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
    $('view-vehicle').hidden = view !== 'vehicle';
    $('view-3d').hidden = view !== '3d';
    $('view-tirelab').hidden = view !== 'tirelab';
    document.body.classList.toggle('wide', view === 'tirelab');   // the studio has its own controls: use the whole window
    if (view === 'tirelab') renderStudio();
    else renderControls();
  }

  function openOriginalTireLab(on) {
    $('studio').hidden = on;
    $('tirelab-wrap').hidden = !on;
    const f = $('tirelab');
    if (!on) { renderStudio(); return; }
    if (!f.src) f.src = 'tirelab.html';
    else f.contentWindow.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { privateContent: { state: { version: 2, data: TireTuneBridge.initialState() } } } } } }));
  }

  // ---- Tyre Studio: the whole tyre model as pictures you can grab, every number a slider you can also type into --
  function renderStudio() {
    const box = $('studio'), v = st.data && st.data.vehicle, pj = v && v.pacejka;
    if (!box) return;
    box.innerHTML = '';
    const C = TireTuneContext, FEEL = TireTuneFeel;
    const top = document.createElement('div');
    top.className = 'studio-bar';
    top.innerHTML = `<div><b>Tyre Studio</b><span class="muted small">${pj ? `${pj.class}, shared by every wheel &middot; ${pj.conf ? pj.conf.split('/').pop() : 'inline in the prefab'}` : 'no 1.9 tyre model on this vehicle yet'}</span></div>
      <div class="studio-actions"><label class="small muted">Compare with <select class="input" id="studio-preset"><option value="">nothing</option>${(st.data.presets || []).map(p => `<option value="${p.name}">${p.name}</option>`).join('')}</select></label>
      <button class="btn ghost sm" type="button" id="studio-original">Original Tire Lab</button></div>`;
    box.appendChild(top);
    top.querySelector('#studio-original').addEventListener('click', () => openOriginalTireLab(true));
    // the suspension corner rig: drag the parts, click to edit them (rig3d.js)
    const rigRow = document.createElement('div');
    rigRow.className = 'studio-row rig-row';
    rigRow.innerHTML = `<section class="studio-card rig-card"><h3>Suspension corner <span>drag the dots &middot; click a part</span></h3>
        <div class="rig-top"><div class="rig-axles">${st.cur.axles.map((_, i) => `<button type="button" data-rig-axle="${i}">Axle ${i + 1}</button>`).join('')}</div>
          <div class="tyre-size"><label>Tyre size <input type="text" spellcheck="false" placeholder="205/55R16"></label><span class="ts-out"></span>
            <button class="btn ghost sm" type="button" data-ts="nominal">Use as NominalRadius</button>
            <button class="btn ghost sm" type="button" data-ts="wheel">Use as wheel radius</button></div></div>
        <div class="rig-host"><div class="rig-tip" hidden></div><div class="rig-hud"></div>
          <div class="rig-sliders">
            <label class="rig-slip">test slip angle <input type="range" min="0" max="12" step="0.5" value="4"><output>4°</output></label>
            <label class="rig-press" title="Preview only: Reforger has no tyre pressure field">pressure <input type="range" min="0.8" max="4" step="0.1" value="2.3"><output>2.3 bar</output></label>
            <label class="rig-squish" title="Draw the squash bigger so it reads on screen">squash <input type="range" min="1" max="5" step="0.5" value="3"><output>x3</output></label>
          </div>
          <div class="rig-legend"><i style="--c:#e3ebf5"></i>bump / droop <i style="--c:#ef6d78"></i>bump stop <i style="--c:#f0b35a"></i>droop limit, spring
            <i style="--c:#4fb3ff"></i>steer <i style="--c:#7fd3ff"></i>camber, toe <i style="--c:#5ed6a0"></i>caster / SAI &middot; angles drawn x3 &middot; double-click to centre</div></div>
      </section><aside class="studio-card rig-inspector"></aside>`;
    box.appendChild(rigRow);
    const rigHost = rigRow.querySelector('.rig-host'), rigInsp = rigRow.querySelector('.rig-inspector'), rigHud = rigRow.querySelector('.rig-hud');
    // tyre size: the real radius of a 205/55R16-style size (TireLabPhysics.tireSize / geometry from the original tool)
    const ts = rigRow.querySelector('.tyre-size input'), tsOut = rigRow.querySelector('.ts-out');
    const tsRefresh = () => {
      const g = st.tyreSize, rigAxle = globalThis.TireTuneRig ? TireTuneRig.axle() : 0;
      const nr = getPath(st.cur, ['pacejka', 'NominalRadius']), wr = st.car && st.car.axles[rigAxle] ? st.car.axles[rigAxle].radius : null;
      rigRow.querySelectorAll('[data-ts]').forEach(b => { b.disabled = !g || (b.dataset.ts === 'nominal' && !st.cur.pacejka); });
      if (!g) { tsOut.innerHTML = `<span class="muted">wheel ${wr ? wr.toFixed(3) : '-'} m &middot; tyre model ${nr != null ? nr.toFixed(3) : '-'} m</span>`; return; }
      const off = (v) => v == null ? '' : Math.abs(v - g.radius) / g.radius > 0.03 ? ' warn' : ' ok';
      tsOut.innerHTML = `radius <b>${g.radius.toFixed(3)} m</b>, width ${Math.round(g.width * 1000)} mm, sidewall ${Math.round(g.sidewall * 1000)} mm &middot;
        <span class="${off(wr)}">wheel ${wr ? wr.toFixed(3) : '-'}</span> &middot; <span class="${off(nr)}">tyre model ${nr != null ? nr.toFixed(3) : '-'}</span>`;
    };
    ts.value = st.tyreSizeText || '';
    const tsApply = () => {
      st.tyreSizeText = ts.value.trim();
      try { st.tyreSize = st.tyreSizeText ? P.geometry(P.tireSize(st.tyreSizeText)) : null; ts.classList.remove('bad'); }
      catch (e) { st.tyreSize = null; ts.classList.add('bad'); tsOut.textContent = e.message; return; }
      try { localStorage.setItem('tt-size:' + st.data.vehicle.prefab, st.tyreSizeText); } catch (e) { /* storage blocked */ }
      if (globalThis.TireTuneRig) TireTuneRig.rebuild();
      tsRefresh();
    };
    ts.addEventListener('change', tsApply);
    ts.addEventListener('keydown', e => { if (e.key === 'Enter') ts.blur(); });
    rigRow.querySelectorAll('[data-ts]').forEach(b => b.addEventListener('click', () => {
      if (!st.tyreSize) return;
      const r = +st.tyreSize.radius.toFixed(3), ai = globalThis.TireTuneRig ? TireTuneRig.axle() : 0;
      if (b.dataset.ts === 'nominal') { dragSet(['pacejka', 'NominalRadius'], r); toast(`Tyre model NominalRadius set to ${r} m. Review shows the change.`); }
      else if (st.cur.axles[ai].Wheel) { dragSet(['axles', ai, 'Wheel', 'Radius'], r); toast(`Axle ${ai + 1} wheel Radius set to ${r} m: keep it matching your wheel mesh.`); }
      changed(); setTimeout(tsRefresh, 300);
    }));
    st.cards.push(() => { if (!rigRow.isConnected) return false; tsRefresh(); return true; });
    tsRefresh();
    const press = rigRow.querySelector('.rig-press input'), squishIn = rigRow.querySelector('.rig-squish input');
    press.addEventListener('input', () => { rigRow.querySelector('.rig-press output').textContent = (+press.value).toFixed(1) + ' bar'; if (globalThis.TireTuneRig) TireTuneRig.setPressure(+press.value); });
    squishIn.addEventListener('input', () => { rigRow.querySelector('.rig-squish output').textContent = 'x' + squishIn.value; if (globalThis.TireTuneRig) TireTuneRig.setSquish(+squishIn.value); });
    const slip = rigRow.querySelector('.rig-slip input');
    slip.addEventListener('input', () => { rigRow.querySelector('.rig-slip output').textContent = slip.value + '°'; if (globalThis.TireTuneRig) TireTuneRig.setSlip(+slip.value); });
    const markAxle = i => rigRow.querySelectorAll('[data-rig-axle]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.rigAxle === i));
    rigRow.querySelectorAll('[data-rig-axle]').forEach(b => b.addEventListener('click', () => { TireTuneRig.setAxle(+b.dataset.rigAxle); markAxle(+b.dataset.rigAxle); }));
    const mountRig = () => { TireTuneRig.mount(rigHost, rigInsp, rigHud); markAxle(TireTuneRig.axle()); };
    if (globalThis.TireTuneRig) mountRig(); else document.addEventListener('tiretune-rig-ready', mountRig, { once: true });
    const sel = top.querySelector('#studio-preset');
    sel.value = st.preset;
    sel.addEventListener('change', e => { st.preset = e.target.value; const ps = $('preset-sel'); if (ps) ps.value = st.preset; drawCharts(); updateCards(); });
    if (!pj) {
      const n = document.createElement('div');
      n.className = 'note';
      n.innerHTML = 'Add a 1.9 tyre model first: <b>Tyre model</b> tab in the side panel, pick a stock preset.';
      box.appendChild(n);
      return;
    }
    const flat = () => S.flatPacejka(st.cur.pacejka);
    const pset = (key, val) => {
      if (key === 'NominalLoad' || key === 'NominalRadius') { dragSet(['pacejka', key], val); return; }
      for (const [g, gv] of Object.entries(st.cur.pacejka.groups)) if (key in gv) { dragSet(['pacejka', 'groups', g, key], val); return; }
    };
    // feel tiles, wide
    const tiles = document.createElement('div');
    tiles.className = 'feel-tiles studio-tiles';
    box.appendChild(tiles);
    st.cards.push(() => {
      if (!tiles.isConnected) return false;
      const F0 = flat().NominalLoad || 4000, o = S.flatPacejka(st.orig.pacejka);
      const s = FEEL.shape('lat', flat(), F0), so = FEEL.shape('lat', o, F0), l = FEEL.shape('lon', flat(), F0), lo = FEEL.shape('lon', o, F0);
      const w = FEEL.words('lat', s), wl = FEEL.words('lon', l);
      const tile = (title, word, val, now, was, max, tip) => `<div class="feel" title="${tip}"><span>${title}</span><b>${word}</b><em>${val}</em>
        <div class="feel-bar"><i style="width:${Math.min(100, now / max * 100)}%"></i><u style="left:${Math.min(100, was / max * 100)}%"></u></div></div>`;
      tiles.innerHTML =
        tile('Cornering grip', w.grip, `mu ${s.mu.toFixed(2)} (was ${so.mu.toFixed(2)})`, s.mu, so.mu, 1.8, 'Peak sideways grip at nominal load') +
        tile('Turn-in', w.bite, `80 % grip at ${s.bite.toFixed(1)}°`, 12 - Math.min(12, s.bite), 12 - Math.min(12, so.bite), 12, 'How little slip the tyre needs to bite') +
        tile('Corner peak', `${s.peakX.toFixed(1)}°`, 'slip angle at the limit', s.peakX, so.peakX, 20, 'Where the cornering force peaks') +
        tile('Breakaway', w.brk, `${Math.round(s.drop * 100)} % lost after the peak`, s.drop, so.drop, 0.5, 'Progressive is forgiving, snappy is twitchy') +
        tile('Traction / braking', wl.grip, `mu ${l.mu.toFixed(2)} at ${l.peakX.toFixed(0)} % slip`, l.mu, lo.mu, 1.8, 'Peak drive and brake grip') +
        tile('Wheelspin', wl.brk, `${Math.round(l.drop * 100)} % lost when spinning`, l.drop, lo.drop, 0.5, 'Grip left once the wheel spins or locks');
      return true;
    });
    // the two big curves with handles
    const big = document.createElement('div');
    big.className = 'studio-row two';
    for (const ax of ['lat', 'lon']) {
      const sec = document.createElement('section');
      sec.className = 'studio-card';
      sec.innerHTML = `<h3>${ax === 'lat' ? 'Cornering' : 'Traction and braking'} <span>drag the dots</span></h3>`;
      sec.appendChild(cardChart(() => {
        const r = FEEL.editor(ax, flat, S.flatPacejka(st.orig.pacejka), presetCoeff(), pset);
        r.opts = { ...r.opts, small: false, h: 270 };
        r.note = ax === 'lat' ? 'Blue: grip and where it peaks. Green: turn-in. Amber: what is left after the limit. Thin lines: light / heavy wheel load. Dashed: original.'
          : 'Blue: traction / braking grip and the slip where it peaks. Green: how fast it bites. Amber: grip left when the wheel spins or locks.';
        return r;
      }));
      big.appendChild(sec);
    }
    box.appendChild(big);
    // every group: what it means, its graph, its numbers as sliders you can type into
    const groups = [['Reference', 'Load', 'How grip scales as weight moves between wheels. Nominal load is the wheel load the curves are measured at; keep it near the real one.']]
      .concat(Object.keys(pj.groups).map(g => [g, g.replace(/([a-z])([A-Z])/g, '$1 $2'), C.GROUP_INFO[g] || '']));
    const grid = document.createElement('div');
    grid.className = 'studio-row grid';
    for (const [g, title, info] of groups) {
      const sec = document.createElement('section');
      sec.className = 'studio-card';
      sec.innerHTML = `<h3>${title}</h3><p class="studio-info">${info}</p>`;
      sec.appendChild(cardChart(() => { const r = C.pacGraph(g, flat(), S.flatPacejka(st.orig.pacejka), presetCoeff()); if (r) { r.opts = { ...r.opts, h: 200 }; } return r; }));
      const keys = g === 'Reference' ? ['NominalLoad', 'NominalRadius'] : Object.keys(pj.groups[g].fields);
      const main = document.createElement('div');
      main.className = 'studio-ctls';
      const more = document.createElement('details');
      more.className = 'more-numbers';
      const IMPORTANT = new Set(['NominalLoad', 'NominalRadius', 'PCX1', 'PDX1', 'PDX2', 'PEX1', 'PKX1', 'PCY1', 'PDY1', 'PDY2', 'PEY1', 'PKY1', 'PKY2', 'RBX1', 'RCX1', 'RBY1', 'RCY1', 'QBZ1', 'QCZ1', 'QDZ1', 'QEZ1']);
      let hidden = 0;
      for (const k of keys) {
        const path = g === 'Reference' ? ['pacejka', k] : ['pacejka', 'groups', g, k];
        const meta = C.PAC_META[k] || [k, ''];
        const o = getPath(st.orig, path);
        const [lo, hi, step] = C.rangeFor(k, typeof o === 'number' ? o : 0);
        const f = g === 'Reference' ? pj.top[k] : pj.groups[g].fields[k];
        const ctl = control(path, [k, `${meta[0]} <span class="code">${k}</span>`, k === 'NominalLoad' ? 'N' : k === 'NominalRadius' ? 'm' : '', lo, hi, step, meta[1]], { text: srcLabel(f && f.src), title: f && f.src });
        if (IMPORTANT.has(k)) main.appendChild(ctl); else { more.appendChild(ctl); hidden++; }
      }
      sec.appendChild(main);
      if (hidden) { more.insertAdjacentHTML('afterbegin', `<summary>${hidden} finer terms (load, camber and shift effects)</summary>`); sec.appendChild(more); }
      grid.appendChild(sec);
    }
    box.appendChild(grid);
    queueCards();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // misc UI
  function fmt(v) { return v == null ? 'default' : Array.isArray(v) ? v.join(' ') : (+v).toFixed(3).replace(/\.?0+$/, ''); }
  let toastTimer = 0;
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 6000);
  }

  document.querySelectorAll('#control-tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#control-tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    ['chassis', 'axles', 'tyre', 'fun'].forEach(t => $('tab-' + t).hidden = t !== b.dataset.tab);
  }));
  document.querySelectorAll('#view-tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('tirelab-close').addEventListener('click', () => openOriginalTireLab(false));
  document.querySelectorAll('#scenario button').forEach(b => b.addEventListener('click', () => {
    st.scenario = b.dataset.s;
    document.querySelectorAll('#scenario button').forEach(x => x.setAttribute('aria-checked', x === b));
    $('lbl-radius').style.visibility = st.scenario === 'corner' ? 'visible' : 'hidden';
    $('bend-dir').style.visibility = st.scenario === 'corner' ? 'visible' : 'hidden';
    stage.t = 0;
    recalc(false);
  }));
  const slider = (id, out, key, unit) => {
    const i = $(id);
    const upd = () => { st[key] = +i.value; $(out).textContent = i.value + ' ' + unit; i.style.setProperty('--fill', ((i.value - i.min) / (i.max - i.min) * 100) + '%'); };
    i.addEventListener('input', () => { upd(); clearTimeout(st.recalcTimer); st.recalcTimer = setTimeout(() => recalc(false), 60); });
    upd();
  };
  document.querySelectorAll('#bend-dir button').forEach(b => b.addEventListener('click', () => {
    st.dir = +b.dataset.d;
    document.querySelectorAll('#bend-dir button').forEach(x => x.setAttribute('aria-checked', x === b));
    recalc(false);
  }));
  // view camera: follow the car or watch it from a fixed point, zoom and pan
  document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-cam]').forEach(x => x.setAttribute('aria-checked', x === b));
    stage.setFollow(b.dataset.cam === 'follow');
  }));
  $('zoom-in').addEventListener('click', () => stage.zoomBy(1.3));
  $('zoom-out').addEventListener('click', () => stage.zoomBy(1 / 1.3));
  $('zoom-fit').addEventListener('click', () => stage.fit());
  stage.onCamera = s => { $('zoom-read').textContent = Math.round(s.zoom * 100) + '%'; };
  slider('in-speed', 'out-speed', 'speed', 'km/h');
  slider('in-radius', 'out-radius', 'radius', 'm');
  st.playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playBtn = () => { $('btn-play').innerHTML = `<svg><use href="#i-${st.playing ? 'pause' : 'play'}"/></svg>`; $('btn-play').setAttribute('aria-label', st.playing ? 'Pause' : 'Play'); };
  $('btn-play').addEventListener('click', () => { st.playing = !st.playing; stage.play(st.playing); playBtn(); });
  playBtn();
  $('in-scrub').addEventListener('input', e => { st.playing = false; stage.play(false); playBtn(); stage.seek(e.target.value / 1000); });
  $('btn-review').addEventListener('click', review);
  $('pac-target').addEventListener('change', review);
  $('btn-apply').addEventListener('click', applyNow);
  $('btn-reset-all').addEventListener('click', () => { st.cur = clone(st.orig); st.template = ''; renderControls(); changed(); });
  $('btn-live').addEventListener('click', toggleLive);
  $('vehicle-select').addEventListener('change', async e => {
    if (countDiffs(st.cur, st.orig) && !confirm('Discard the unapplied changes?')) { e.target.value = st.data.vehicle.prefab; return; }
    const r = await api('/api/open', { prefab: e.target.value });
    if (!r.ok) toast(r.error, true);
    await load();
  });
  // a new session from Workbench (Open selected vehicle) reloads the page state
  setInterval(async () => {
    try {
      const r = await api('/api/stamp');
      if (r.stamp !== st.stamp && !countDiffs(st.cur || {}, st.orig || {})) load();
    } catch (e) { /* server gone */ }
  }, 2000);
  window.addEventListener('beforeunload', e => { if (st.cur && countDiffs(st.cur, st.orig)) { e.preventDefault(); e.returnValue = ''; } });
  load();
})();
