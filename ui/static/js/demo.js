// TireTune auto walkthrough: a filmable demo that drives the real UI.
// A visible cursor glides to each control, a spotlight frames it, clicks ripple, sliders drag smoothly and a
// caption card explains the step. Real edits, so the preview reacts; nothing is written (Review is opened and
// closed, never applied) and everything is reverted at the end.
// Start: the Demo button, or open the page with ?demo=1 (&speed=0.8 slower, 1.3 faster, &from=N start at step N).
// Keys while running: Space pause / resume, Right arrow next step, Esc stop.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  let speed = Math.max(0.3, Math.min(3, +params.get('speed') || 1));

  // ---- overlay (a manual popover: top layer, so it stays above the Review dialog when re-raised) ------------
  const root = document.createElement('div');
  root.id = 'tt-demo';
  root.setAttribute('popover', 'manual');
  root.innerHTML = `
    <div class="d-spot"></div>
    <div class="d-cursor"><svg viewBox="0 0 28 28" width="28" height="28"><path d="M5 3l17 10.5-7.6 1.6 4.6 8.4-3.4 1.8-4.6-8.5L5 22z" fill="#fff" stroke="#0a1018" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="d-ripple"></span></div>
    <div class="d-card" role="status" aria-live="polite">
      <div class="d-bar"><i></i></div>
      <div class="d-head"><span class="d-count"></span><span class="d-title"></span></div>
      <p class="d-text"></p>
      <div class="d-ctrl">
        <button type="button" data-a="pause" title="Pause (Space)">Pause</button>
        <button type="button" data-a="next" title="Next step (Right arrow)">Next</button>
        <button type="button" data-a="stop" title="Stop (Esc)">Stop</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const spot = root.querySelector('.d-spot'), cursor = root.querySelector('.d-cursor'), card = root.querySelector('.d-card');
  const ripple = root.querySelector('.d-ripple');

  let running = false, paused = false, skip = false, stopped = false;
  let cx = innerWidth * 0.5, cy = innerHeight * 0.6;

  function raise() { try { if (root.matches(':popover-open')) root.hidePopover(); root.showPopover(); } catch (e) { /* no popover API */ } }

  // waits that honour pause / skip / stop
  async function wait(ms) {
    const end = performance.now() + ms / speed;
    while (performance.now() < end || paused) {
      if (stopped) throw new Error('stop');
      if (skip) return;
      await sleep(40);
    }
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  async function reveal(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 170) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await wait(550); }
  }

  function spotlight(el, pad = 8) {
    if (!el) { spot.style.opacity = '0'; return; }
    const r = rectOf(el);
    Object.assign(spot.style, { opacity: '1', left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.w + pad * 2 + 'px', height: r.h + pad * 2 + 'px' });
    placeCard(r);
  }

  // caption: bottom centre, or top when the spotlight sits low on the screen
  function placeCard(r) {
    const low = r && r.y + r.h > innerHeight - 230;
    card.classList.toggle('top', !!low);
  }

  async function moveTo(x, y, ms = 750) {
    cursor.style.transitionDuration = Math.round(ms / speed) + 'ms';
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cx = x; cy = y;
    await wait(ms + 60);
  }

  async function press() {
    cursor.classList.remove('click');
    void cursor.offsetWidth;          // restart the click animation
    cursor.classList.add('click');
    await wait(220);
  }

  async function click(sel, opts = {}) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    await reveal(el);
    if (opts.spot !== false) spotlight(el);
    const r = rectOf(el);
    await moveTo(r.cx, r.cy);
    await press();
    el.click();
    await wait(opts.after ?? 450);
  }

  // drag a range input from its value to `to`, the cursor riding the thumb
  async function drag(sel, to, ms = 1600) {
    const el = $(sel);
    if (!el) return;
    await reveal(el);
    spotlight(el.closest('.ctl') || el.closest('label') || el);
    const min = +el.min, max = +el.max, from = +el.value;
    const thumb = v => { const r = rectOf(el); return [r.x + (v - min) / ((max - min) || 1) * r.w, r.cy]; };
    await moveTo(...thumb(from));
    await press();
    const steps = Math.max(12, Math.round(ms / 33));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // ease in-out
      el.value = from + (to - from) * e;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const [x, y] = thumb(+el.value);
      cursor.style.transitionDuration = '0ms';
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cx = x; cy = y;
      await wait(ms / steps);
    }
    await wait(300);
  }

  // drag a graph handle (found by its label) by dx, dy screen pixels, the cursor riding the dot
  async function dragHandle(scope, labelStart, dx, dy, ms = 1500) {
    const box = $(scope);
    if (!box) return;
    const h = [...box.querySelectorAll('.ch-handle')].find(n => n.querySelector('text').textContent.startsWith(labelStart));
    if (!h) return;
    const svg = h.closest('svg');
    await reveal(svg);
    spotlight(svg.closest('.card-chart') || svg);
    const dot = h.querySelector('.dot').getBoundingClientRect();
    const x0 = dot.left + dot.width / 2, y0 = dot.top + dot.height / 2;
    await moveTo(x0, y0);
    await press();
    const ev = (t, x, y, el) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 77, button: 0, buttons: 1, pointerType: 'mouse' }));
    ev('pointerdown', x0, y0, h);
    const steps = Math.max(12, Math.round(ms / 33));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = x0 + dx * e, y = y0 + dy * e;
      ev('pointermove', x, y, svg);
      cursor.style.transitionDuration = '0ms';
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cx = x; cy = y;
      await wait(ms / steps);
    }
    ev('pointerup', x0 + dx, y0 + dy, svg);
    await wait(400);
  }

  // drag a handle on the 3D corner rig (rig3d.js) by dx, dy pixels, the cursor riding it
  async function dragRig(id, dx, dy, ms = 1400) {
    const at = globalThis.TireTuneRig && TireTuneRig.handleAt(id);
    const cv = $('.rig-host canvas');
    if (!at || !cv) return;
    spotlight($('.rig-card'), 2);
    await moveTo(at[0], at[1]);
    await press();
    const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 78, button: 0, buttons: 1, pointerType: 'mouse' }));
    ev('pointerdown', at[0], at[1]);
    const steps = Math.max(12, Math.round(ms / 33));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, x = at[0] + dx * e, y = at[1] + dy * e;
      ev('pointermove', x, y);
      cursor.style.transitionDuration = '0ms'; cursor.style.transform = `translate(${x}px, ${y}px)`; cx = x; cy = y;
      await wait(ms / steps);
    }
    ev('pointerup', at[0] + dx, at[1] + dy);
    await wait(500);
  }

  async function choose(sel, value) {
    const el = $(sel);
    if (!el) return;
    await click(el, { after: 250 });
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
  }

  function say(n, total, title, text) {
    root.querySelector('.d-count').textContent = `${n} / ${total}`;
    root.querySelector('.d-title').textContent = title;
    root.querySelector('.d-text').textContent = text;
    root.querySelector('.d-bar i').style.width = (n / total * 100) + '%';
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  }

  // reading time for the caption, at the chosen speed
  const read = text => 1400 + text.length * 38;

  // ---- the walkthrough ---------------------------------------------------------------------------------------
  // Each step: title, text, run (async, may use click / drag / choose / spotlight). Selectors that are missing on
  // a given vehicle (no Tyre model, one axle...) are skipped quietly.
  function steps() {
    const preset = [...document.querySelectorAll('#preset-sel option')].map(o => o.value).find(v => v && /car/i.test(v))
      || [...document.querySelectorAll('#preset-sel option')].map(o => o.value).find(Boolean);
    const com = $('#c_rigidBody_CenterOfMass_2');
    const comTo = com ? +com.value - 0.55 : 0;
    const axleCount = document.querySelectorAll('#tab-axles .axle-seg button').length;
    return [
      { title: 'TireTune Workbench', text: 'Tune the 1.9 Pacejka2002 tyres and the chassis of any wheeled vehicle prefab, and see what every change does before you drive it.',
        run: async () => { spotlight(null); await moveTo(innerWidth * 0.5, innerHeight * 0.45, 900); } },
      { title: 'Your vehicle', text: 'The prefab picked in Workbench, with its parent chain. Every value knows whether it comes from this prefab, a config, or the engine default.',
        run: async () => { spotlight($('.vehicle-pick')); await moveTo(rectOf($('#breadcrumb')).cx, rectOf($('#breadcrumb')).cy); } },
      { title: 'Live preview', text: 'Top and side view of your vehicle. Colour shows how much grip each tyre is using, rings are the friction circles, arrows the tyre forces, numbers the wheel loads. The dashed line is your original setup.',
        run: async () => { spotlight($('.stage-wrap'), 4); await moveTo(rectOf($('#stage')).cx, rectOf($('#stage')).y + 150); } },
      { title: 'Handling readouts', text: 'Balance, grip limit on the bend, stopping distance and per-axle ride, each compared with the original setup.',
        run: async () => { spotlight($('#balance')); await moveTo(rectOf($('#balance')).cx, rectOf($('#balance')).cy); } },
      { title: 'Move the weight back', text: 'Shift the centre of mass rearward and watch the weight move: rear tyres load up, the balance changes and the grip limit follows.',
        run: async () => { await click('[data-tab=chassis]'); if (com) await drag('#c_rigidBody_CenterOfMass_2', comTo, 2200); } },
      { title: 'See the effect', text: 'Readouts show the change against the original in green or red, and the axle cards show the new static loads, sag and ride frequency.',
        run: async () => { spotlight($('#axle-metrics')); await moveTo(rectOf($('#axle-metrics')).cx, rectOf($('#axle-metrics')).y + 40); } },
      { title: 'Per-axle setup', text: 'Every part has a graph you can grab. Drag the spring dot to stiffen the rear springs and watch sag, ride frequency and roll split follow.',
        run: async () => {
          await click('[data-tab=axles]');
          if (axleCount > 1) await click('#tab-axles .axle-seg button:nth-child(2)');
          await dragHandle('#tab-axles', '' + Math.round(+($('#tab-axles input[id$="_Suspension_SpringRate"]') || { value: 0 }).value), 0, -40, 1800);
        } },
      { title: 'Tyre feel', text: 'The shared Pacejka tyre in plain words: grip, turn-in and breakaway. Compare against a stock BI tyre; its curve shows dotted.',
        run: async () => { await click('[data-tab=tyre]'); if (preset) await choose('#preset-sel', preset); spotlight($('#tab-tyre .feel-tiles')); await moveTo(rectOf($('#tab-tyre .feel-tiles')).cx, rectOf($('#tab-tyre .feel-tiles')).cy); } },
      { title: 'Shape the tyre by hand', text: 'Grab the dots on the curve: blue lifts the grip, green sharpens turn-in, amber sets how hard it lets go. The words above update as you drag.',
        run: async () => {
          await dragHandle('#tab-tyre .feel-editor', 'grip', 0, -26, 1600);
          await dragHandle('#tab-tyre .feel-editor', 'turn-in', 0, -22, 1300);
          spotlight($('#tab-tyre .feel-tiles')); await moveTo(rectOf($('#tab-tyre .feel-tiles')).cx, rectOf($('#tab-tyre .feel-tiles')).cy);
        } },
      { title: 'Braking', text: 'Full brakes from speed: wheels that brake harder than the tyre can hold turn red and lock, and the nose dives in the side view.',
        run: async () => { await click('[data-s=brake]'); await drag('#in-speed', 90, 1300); spotlight($('.stage-wrap'), 4); } },
      { title: 'Launch and corner', text: 'Launch shows traction on the driven axles; Corner holds a speed on a bend and shows understeer or oversteer as it builds.',
        run: async () => { await click('[data-s=launch]', { after: 1600 }); await click('[data-s=corner]'); await drag('#in-speed', 60, 900); } },
      { title: 'Tyre Studio', text: 'A live suspension corner: drag the wheel through its travel, steer it, tilt it. Then the tyre itself in plain words, with curves to grab and every number a slider you can type into.',
        run: async () => {
          await click('[data-view="tirelab"]', { after: 1800 });
          await dragRig('travel', 0, -30, 1300);
          await dragRig('steer', -45, 0, 1300);
          await dragRig('camber', -8, 0, 1100);
          const tiles = $('#studio .studio-tiles');
          if (tiles) { tiles.scrollIntoView({ block: 'center' }); await wait(500); spotlight(tiles, 4); await moveTo(rectOf(tiles).cx, rectOf(tiles).cy, 900); }
          await dragHandle('#studio', 'breakaway', 0, 18, 1300);
          await wait(800);
          await click('[data-view="vehicle"]', { spot: false });
        } },
      { title: '3D car', text: 'Your vehicle in 3D, built from its real wheel, spring and centre-of-mass values. Orbit, zoom, hover any part for its numbers and click it to adjust it right there.',
        run: async () => {
          await click('[data-view="3d"]', { after: 1200 });
          const rot = $('#c3-rotate'); if (rot && rot.getAttribute('aria-pressed') !== 'true') await click('#c3-rotate', { after: 1600 });
          spotlight($('#car3d'), 2); await moveTo(rectOf($('#car3d')).cx, rectOf($('#car3d')).cy + 60, 900);
          await press();
          if (globalThis.TireTune3D) TireTune3D.select({ kind: 'spring', label: 'Axle 1 suspension', axle: 0, side: 1 });
          await wait(600); raise();
          const ins = $('#inspector'); if (ins && !ins.hidden) { spotlight(ins, 2); await moveTo(rectOf(ins).cx, rectOf(ins).y + 140); }
          const sp = $('#inspector input[id$="_Suspension_SpringRate"]');
          if (sp) { sp.id = sp.id + '_3d'; await drag('#' + sp.id, Math.min(+sp.max, +sp.value * 1.5), 1600); }
          await wait(1200);
          if (rot && rot.getAttribute('aria-pressed') === 'true') rot.click();
          if (globalThis.TireTune3D) TireTune3D.select(null);
          await click('[data-view="vehicle"]', { spot: false });
        } },
      { title: 'Review before writing', text: 'Review shows the exact text change for every file. Nothing is written until you press Write files (this demo never does).',
        run: async () => { await click('#btn-review', { after: 900 }); raise(); const d = $('#review'); if (d && d.open) { spotlight($('#review-files'), 4); await moveTo(rectOf($('#review-files')).cx, rectOf($('#review-files')).y + 60); } } },
      { title: 'Into Workbench', text: 'Write files backs up, edits your .et and configs as plain text, and Workbench reimports them. Reopen the world and drive.',
        run: async () => { const d = $('#review'); if (d && d.open) { await click('#review button[value=cancel]'); } spotlight($('#wb-info')); await moveTo(rectOf($('#wb-info')).cx, rectOf($('#wb-info')).cy); } },
      { title: 'Checks', text: 'Setup checks flag things like springs too soft for their travel, torque shares that do not add up, or an axle running on engine-default tyres.',
        run: async () => { spotlight($('#lint')); await moveTo(rectOf($('#lint')).cx, rectOf($('#lint')).cy); } },
      { title: 'And for fun: templates', text: 'One-click wild setups built from this vehicle\'s own values. Drift King loosens the rear and sends all the power back: watch the line swing away from the dashed original.',
        run: async () => {
          await click('[data-tab=fun]');
          if (!$('[data-s=corner]').matches('[aria-checked=true]')) await click('[data-s=corner]', { spot: false });
          await click('.tpl[data-tpl=drift]', { after: 2200 });
          spotlight($('.stage-wrap'), 4); await moveTo(rectOf($('#stage')).cx, rectOf($('#stage')).y + 120);
        } },
      { title: 'Moon Buggy, Ice Rink, Monster Truck...', text: 'Featherweight with pillow springs, a quarter of the grip, or heavy with huge travel. Each one switches cleanly, and Review writes the one you love.',
        run: async () => {
          await click('.tpl[data-tpl=moon]', { after: 2000 });
          await click('.tpl[data-tpl=ice]', { after: 2000 });
          await click('.tpl[data-tpl=monster]', { after: 1600 });
          spotlight($('#balance')); await moveTo(rectOf($('#balance')).cx, rectOf($('#balance')).cy);
        } },
      { title: 'Back to the original', text: 'Revert all returns every value to what is in the files. Tune, review, write, drive.',
        run: async () => { await click('#btn-reset-all'); spotlight($('.stage-wrap'), 4); await moveTo(rectOf($('#stage')).cx, rectOf($('#stage')).cy); } },
    ];
  }

  async function start() {
    if (running) return;
    if (!document.querySelector('#tab-chassis .ctl')) { alert('Load a vehicle first.'); return; }
    running = true; paused = false; stopped = false;
    document.body.classList.add('demo-on');
    const play = $('#btn-play');                 // the demo always animates, even under reduced motion
    if (play && play.getAttribute('aria-label') === 'Play') play.click();
    if (!$('#review').open) raise();
    cursor.style.transitionDuration = '0ms';
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;
    const list = steps();
    const from = Math.max(1, Math.min(list.length, +params.get('from') || 1));   // ?from=N: re-film one segment
    try {
      for (let i = from - 1; i < list.length; i++) {
        skip = false;
        const s = list[i];
        say(i + 1, list.length, s.title, s.text);
        const t0 = performance.now();
        try { await s.run(); } catch (e) { if (e.message === 'stop') throw e; console.warn('[demo]', s.title, e); }
        skip = false;
        const left = read(s.text) - (performance.now() - t0) * speed;
        if (left > 0) await wait(left);
      }
      await wait(800);
    } catch (e) { /* stopped */ }
    finish();
  }

  function finish() {
    running = false;
    document.body.classList.remove('demo-on');
    const d = $('#review');
    if (d && d.open) d.close();
    const revert = $('#btn-reset-all');
    if (revert && !revert.disabled) revert.click();
    try { root.hidePopover(); } catch (e) { /* ignore */ }
  }

  root.querySelector('.d-ctrl').addEventListener('click', e => {
    const a = e.target.dataset.a;
    if (a === 'pause') { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; }
    if (a === 'next') skip = true;
    if (a === 'stop') stopped = true;
  });
  addEventListener('keydown', e => {
    if (!running) return;
    if (e.key === 'Escape') { stopped = true; e.preventDefault(); }
    else if (e.key === ' ') { paused = !paused; root.querySelector('[data-a=pause]').textContent = paused ? 'Resume' : 'Pause'; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { skip = true; e.preventDefault(); }
  }, true);

  globalThis.TireTuneDemo = { start, setSpeed: v => { speed = v; } };
  const btn = $('#btn-demo');
  if (btn) btn.addEventListener('click', start);
  if (params.get('demo') === '1') {
    // wait for the vehicle to load, then go
    const t = setInterval(() => { if (document.querySelector('#tab-chassis .ctl')) { clearInterval(t); setTimeout(start, 1200); } }, 300);
  }
})();
