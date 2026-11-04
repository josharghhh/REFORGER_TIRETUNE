# TireTune Workbench

Tune the tyres (Reforger 1.9 **Pacejka2002** tyre model) and chassis of a wheeled vehicle prefab, and see what each
change does before you drive it: an animated top / side view of *your* vehicle with per-wheel loads, grip use,
friction circles and suspension travel, force curves against the original setup and stock presets, and readouts
(balance, grip limit, stopping distance, ride frequency, sag). **Apply** edits your `.et` / `.conf` files as plain
text (minimal diffs, backups first) and lets Workbench reimport them.

The tyre physics and the *Tire Lab* tab are the original `tire-tuning-workbench.html` tool (MF5.2-style evaluator),
embedded unmodified.

## Install

Needs **Arma Reforger 1.9**: until 1.9 is released that means **Arma Reforger Experimental Tools** (Steam). The
stable 1.8 Tools have no Pacejka2002 tyre model (vehicles there use the older Pacejka94 `PacejkaTire_*.conf`).

1. Copy `TireTune_Workbench` into your Workbench `addons` folder (next to your own mod).
2. Load it with your project: add it to your mod's dependencies, or open `TireTune_Workbench/addon.gproj` and add
   your mod there. Your vehicle's addon must be loaded and unpacked (not a Workshop download).
3. Python 3.11+ on PATH (python.org installer, tick *Add python.exe to PATH*). No packages needed.
4. Optional, for one-click reimport, geometry capture and live telemetry: Workbench *Options > Net API* on
   (default port 5775), then restart Workbench once.
5. Workbench 1.9 asks once per session to allow the plugin's file access (*Script Authorization Required*): Yes.

## Use

1. In the Resource Browser select your vehicle `.et`, then **Plugins > TireTune > Open selected vehicle**
   (or right-click the `.et` > TireTune). The UI opens in its own window.
   Vanilla vehicles are read only: right-click the stock prefab > *Create Inherited Prefab* into your addon and tune
   that one.
2. **Chassis**: mass, centre of mass, wheel geometry. *Capture from Workbench* reads the real wheel positions from
   the vehicle placed in the open world (or the one you drive in Play mode); until then the geometry is estimated.
3. **Axles**: per-axle Suspension, Wheel, Tyre, Steering (and Swaybar when present), torque share. Each value shows
   where it comes from (this prefab, a config, or the engine default).
4. **Tyre model**: the key Pacejka coefficients with plain-language labels, every coefficient underneath, and stock
   presets (Car_80s, MilitaryVehicle_80s, Truck_80s, M151A2) to compare against or load.
5. Watch the **Vehicle** view: Corner / Brake / Launch scenarios, colour = grip used, dashed line = your original
   setup. **Tire Lab** opens the original tool with your vehicle loaded; its edits flow back.
6. **Review & apply** shows the exact text diff per file. *Write files* backs up, writes, and asks Workbench to
   reimport (Net API) or queues it for **Plugins > TireTune > Reimport changes**. Reopen the world to drive the
   result: prefab changes need a world reopen, Reload Scripts is not enough.

Where tyre-model changes go (*Tyre model goes to* in the review): your own Pacejka config if you own it (edited in
place: every vehicle using it changes), otherwise a new config in your addon that inherits the current one
(`Configs/Vehicles/TireTune/<Vehicle>_Pacejka2002.conf`, with its `.meta`), or inline in the prefab.

## Good to know

- One `TyreModel` is shared by every wheel of a vehicle. Front/rear differences come from each axle's Tyre factors,
  wheel radius, springs and the weight distribution.
- The preview is an approximation (planar model, quasi-static load transfer, SpringRate read as N/mm, Tyre friction
  factors assumed to scale the Pacejka peak). Use it to compare setups; confirm in game.
- Live telemetry (*Live* chip) streams wheel slips and compression from Play mode; it is experimental.

Code walkthrough: open this folder in VS Code with the CodeTour extension (`vsls-contrib.codetour`); the tour in
`.tours/tiretune.tour` starts by itself. Technical notes and the open Workbench checklist: `docs/HANDOFF.md`.

Without Workbench, for a quick look at an unpacked vehicle:
`python ui/serve.py --dev-dump <unpacked game data> --dev-addon <your addon> --prefab Prefabs/.../Car.et`
