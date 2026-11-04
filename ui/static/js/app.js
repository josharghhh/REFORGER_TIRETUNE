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
    preset: '', live: false, liveTimer: 0, tab: 'chassis', view: 'vehicle', stamp: -1, recalcTimer: 0,
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
      $('breadcrumb').textContent = d.error || 'No vehicle: in Workbench select a vehicle prefab, then Plugins > TireTune > Open selected vehicle.';
      return;
    }
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
    const id = 'c_' + path.join('_');
    wrap.innerHTML = `
      <div class="ctl-head"><span class="dot"></span><label for="${id}">${label} <span class="unit">${unit}</span></label>
        <span class="src" title="${srcInfo.title || ''}">${srcInfo.text || ''}</span></div>
      <div class="ctl-row"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}">
        <input type="number" min="${min}" max="${max}" step="${step}" aria-label="${label} value">
        <button class="reset" type="button" title="Back to ${orig ?? 'engine default'}" aria-label="Reset ${label}"><svg><use href="#i-reset"/></svg></button></div>
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
    wrap.querySelector('.reset').addEventListener('click', () => set(clone(orig)));
    wrap._sync = sync;
    sync();
    return wrap;
  }

  function group(title, src, children, extra) {
    const g = document.createElement('section');
    g.className = 'group';
    g.innerHTML = `<div class="group-head"><h3>${title}</h3><span class="src" title="${src || ''}">${src ? '<svg><use href="#i-file"/></svg>' + src.split('/').pop() : ''}</span></div>`;
    children.forEach(c => g.appendChild(c));
    if (extra) g.appendChild(extra);
    return g;
  }

  function renderControls() {
    renderChassis(); renderAxles(); renderTyre(); renderTemplates();
  }

  function renderChassis() {
    const box = $('tab-chassis'), v = st.data.vehicle;
    box.innerHTML = '';
    const rb = v.rigidBody;
    const massDef = ['Mass', 'Mass', 'kg', 200, Math.max(6000, (rb.Mass.value || 0) * 2), 5, 'Total vehicle mass (RigidBody).'];
    const comDefs = [
      ['CenterOfMass', 'CoM height', 'm', -1, 3, 0.005, 'Higher = more load transfer: more roll, pitch and weight shift.', 1],
      ['CenterOfMass', 'CoM fore / aft', 'm', -4, 4, 0.005, 'Forward moves weight onto the front axle: more understeer, better traction for FWD.', 2],
      ['CenterOfMass', 'CoM lateral', 'm', -1, 1, 0.005, 'Keep at 0 unless the vehicle is asymmetric.', 0],
    ];
    const src = f => ({ text: srcLabel(f.src), title: f.src });
    const ctls = [control(['rigidBody', 'Mass'], massDef, src(rb.Mass))];
    for (const d of comDefs) ctls.push(control(['rigidBody', 'CenterOfMass', d[7]], d, src(rb.CenterOfMass)));
    box.appendChild(group('Body', '', ctls));
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
    box.appendChild(group('Drive', '', AXLE_TOP.map(d => control(['axles', i, d[0]], d, { text: srcLabel(a.props[d[0]].src), title: a.props[d[0]].src }))));
    for (const [k, defs] of Object.entries(AXLE_DEFS)) {
      if (!st.cur.axles[i][k]) continue;
      const info = a[k];
      const ctls = defs.map(d => control(['axles', i, k, d[0]], d, { text: srcLabel(info.fields[d[0]].src, info.conf), title: info.fields[d[0]].src || info.conf }));
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
      box.appendChild(group(k, info.conf, ctls, extra));
    }
  }

  function renderTyre() {
    const box = $('tab-tyre'), v = st.data.vehicle, pj = v.pacejka;
    box.innerHTML = '';
    if (!pj) {
      box.innerHTML = '<div class="note"><strong>No Pacejka2002 TyreModel.</strong> The 1.9 tyre model needs Arma Reforger 1.9 ' +
        '(Arma Reforger <strong>Experimental Tools</strong> until 1.9 is released). In 1.8 / stable Tools vehicles use the older ' +
        'Pacejka94 <code>PacejkaTire_*.conf</code>, which TireTune does not edit. The per-axle Tyre, Wheel, Suspension and Steering values still work.</div>';
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
    pr.querySelector('#preset-sel').addEventListener('change', e => { st.preset = e.target.value; drawCharts(); });
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
    box.appendChild(group('Key coefficients', '', ctls));
    const det = document.createElement('details');
    det.className = 'all-coeff';
    det.innerHTML = '<summary>Every coefficient</summary>';
    for (const [g, gv] of Object.entries(pj.groups)) {
      const cs = Object.keys(gv.fields).map(k => control(['pacejka', 'groups', g, k], [k, k, '', -50, 50, 0.001, ''], { text: srcLabel(gv.fields[k].src), title: gv.fields[k].src }, { help: false }));
      det.appendChild(group(g, '', cs));
    }
    box.appendChild(det);
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
    if (st.scenario === 'corner') { frames = S.corner(car, st.speed, st.radius); ghost = S.corner(carO, st.speed, st.radius); }
    else if (st.scenario === 'brake') frames = S.brake(car, st.speed);
    else frames = S.launch(car);
    st.frames = frames;
    stage.setScene(car, frames, ghost, st.scenario);
    drawCharts();
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
    return { rigidBody: st.cur.rigidBody, axles: st.cur.axles, pacejka: st.cur.pacejka, pacejkaTarget: $('pac-target').value };
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
    $('view-tirelab').hidden = view !== 'tirelab';
    const f = $('tirelab');
    if (view === 'tirelab') {
      if (!f.src) f.src = 'tirelab.html';
      else f.contentWindow.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { privateContent: { state: { version: 2, data: TireTuneBridge.initialState() } } } } } }));
    } else renderControls();
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
  document.querySelectorAll('#scenario button').forEach(b => b.addEventListener('click', () => {
    st.scenario = b.dataset.s;
    document.querySelectorAll('#scenario button').forEach(x => x.setAttribute('aria-checked', x === b));
    $('lbl-radius').style.visibility = st.scenario === 'corner' ? 'visible' : 'hidden';
    stage.t = 0;
    recalc(false);
  }));
  const slider = (id, out, key, unit) => {
    const i = $(id);
    const upd = () => { st[key] = +i.value; $(out).textContent = i.value + ' ' + unit; i.style.setProperty('--fill', ((i.value - i.min) / (i.max - i.min) * 100) + '%'); };
    i.addEventListener('input', () => { upd(); clearTimeout(st.recalcTimer); st.recalcTimer = setTimeout(() => recalc(false), 60); });
    upd();
  };
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
