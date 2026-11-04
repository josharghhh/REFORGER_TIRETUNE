# TireTune Workbench: handoff

Built 2026-11-04 for a friend's request: bring `tire-tuning-workbench.html` (MF5.2 Pacejka tuning prototype) into
Workbench as a plugin that configures 1.9 vehicles, with a visual of the vehicle and the effect of changes.
Scope locked with the user: plugin + HTML window (Enfusion-Actions pattern), full chassis setup, validate on a stock
M151A2 copy, local build (zip to share).

## Layout

| Part | Where | What |
|---|---|---|
| Plugin | `Scripts/WorkbenchGame/TireTune/TT_Plugin.c` | Resource Manager plugin `TT_Plugin`: Open selected vehicle, Open UI, Reimport changes; `.et` context menu; headless `-plugin=TT_Plugin -ttPrefab=...` writes the session only. `TT_Reimport` (register new / rebuild changed, only inside writable addons). |
| Session | `.../TT_Session.c` | Writes `ui/state/session.json`: prefab, writable addons, `files` (prefab + parent chain + every referenced `.conf` + stock presets; packed ones embedded as text), `wb` (BaseContainer-resolved values incl. engine defaults, keys `rigidBody.Mass`, `axle0.Tyre.LateralFriction`, `tyre.Lateral.PCY1`, `axle0.id`). |
| Net API | `.../TT_NetApi.c` | `TT_NetApi` ops: `reimport`, `geometry` (WheelGetPosition / contact of player vehicle, selected entity or placed instance), `telemetry` (Play mode). |
| Text engine | `ui/tt/enftext.py` | Tokenizer/parser for `.et`/`.conf` (one-liners, CRLF, comments, value rows), splice patcher. |
| Model | `ui/tt/model.py` | Inheritance resolver (prefab chain + config ancestors, array items by id, object slots by key+id), `describe`, `plan_apply` (only changed values; creates override blocks with ids from the parents), `commit` (backups outside addons, new conf + `.meta` with a generated GUID). |
| Server | `ui/serve.py` | stdlib HTTP on 127.0.0.1:8790 (exclusive bind, reuses only a port that answers as TireTune). `/api/session`, `/preview`, `/apply`, `/geometry`, `/capture`, `/live`, `/open`, `/vehicles`. |
| Lint | `ui/tt/lint.py` | torque share sum, Tyre without config (engine defaults), sag vs travel, ride frequency, damping ratio, NominalRadius vs wheel radius, NominalLoad vs wheel load, brake vs grip (info), SSF only with captured geometry. |
| UI | `ui/static/` | `index.html`, `app.css`, `js/app.js` (state, controls, review/apply, Tire Lab bridge, live), `js/sim.js` (N-axle model on TireLabPhysics.forces), `js/vehicle.js` (SVG stage), `js/charts.js`. |
| Friend's tool | `ui/static/vendor/tire-tuning-workbench.source.html` | Unmodified source. `ui/tools/build_tirelab.py` regenerates `static/tirelab.html` (window.openai widget-state shim) and `static/js/tirelab-core.js`. |

## Validation status

Done here (no Workbench):
- `python -I ui/tests/test_model.py --dump E:/DUMP-FORAI/1.9exp/data --apoc <ARGH_APOC_CARS>`: 34 checks, 0 failures.
  Parses all 1472 vehicle `.et`/`.conf` in the 1.9exp dump; inherited M151A2 round trip (Mass, CoM, per-axle
  overrides, TorqueShare, new Pacejka conf + re-point, owned conf edited in place, vanilla refused); session.json
  contract (embedded texts only, wb defaults, mismatch report, presets, preview diff, reimport queue); APOC Car06
  copy edits exactly 2 lines.
- UI driven in a browser in dev mode on an inherited M151A2: corner / brake / launch, CoM and tyre edits move
  balance, loads, sag and curves; review diff; write + queue fallback; Tire Lab loads the vehicle.
- Simulation sanity (Node): M151A2-like corner settles at the analytic yaw rate (0.394 vs 0.397 rad/s), front ride
  1.84 Hz / damping 0.23, rear lockup under full brakes.

Not yet run in Workbench (next session, after the user has the project open):
1. Reload Scripts: compile `TT_Plugin.c`, `TT_Session.c`, `TT_NetApi.c` (Enforce keywords `out`/`ref` already
   avoided; check the console).
2. Create Inherited Prefab of `M151A2.et` into a test addon, Open selected vehicle: check the console line
   `[TireTune] session ... N file(s), 0 unreadable`. If packed files are unreadable, `FileIO.OpenFile(relative)`
   does not reach PAKs: try `$ArmaReforger:` (already a fallback) or read through `Resource`/BaseContainer.
3. UI Workbench panel should say "Values match Workbench" (wb vs text resolver). A mismatch list points at a
   resolver rule (re-pointed object inheritance is the least certain one).
4. Apply a change, Reimport (button or Net API), reopen the world, drive; confirm the TyreModel re-point and a
   generated `.conf.meta` GUID are accepted.
5. Net API: `geometry` in edit mode (does WheelGetPosition work on the edit-world entity?) and `telemetry` in Play.

## Known limits / ideas

- The preview's Tyre friction factors scale the Pacejka peak (assumption, labelled). Stock BI coefficients have
  positive PDY2 (grip rises with load), so load transfer changes balance less than textbook tyres would.
- Engine, gearbox, diff ratios and aero are shown read-only; launch is grip-limited (no engine torque).
- Swaybar is edited only when the axle already has one (creating it needs a new object id).
- Live push of floats through `VehicleWheeledSimulation.Update*Configuration` (1.9, local only, not replicated) is a
  possible next step for in-game A/B; Pacejka coefficients still need save + reload.
