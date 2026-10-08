# Self-Drive Test Bench

A browser tool for visualising and tweaking self-driving rules. A motorway is generated from a seed,
you control the *rules* of the ego car (cyan, white outline), and the surrounding traffic is made up of
drivers ranging from **Great** (signals, merges politely, keeps its distance) to **Reckless**
(tailgates, no signals, squeezes into tiny gaps, zones out). Change the rules, re-run the same seed and
see how the car copes.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation + rule-engine tests
npm run build      # typecheck + production build
```

## Desktop app (Mac and Windows)

The app can run on its own as a normal desktop application - no browser, server or internet needed (Electron).
You need [Node.js](https://nodejs.org) (v18 or newer) once, then, in the project folder:

```bash
npm install
npm run app          # build and open it in its own window right now (Mac, Windows or Linux)
npm run dist         # Mac: build a .dmg into ./release   (run on a Mac)
npm run dist:win     # Windows: build an installer + a portable .exe into ./release   (run on Windows)
```

You can also let GitHub build the installers: *Actions → Build desktop apps → Run workflow* (pick the branch),
then download `Self-Drive-Test-Bench-mac` or `Self-Drive-Test-Bench-windows` from the run's artifacts. Pushing a
tag such as `v0.7.0` publishes them on a GitHub Release.

**Mac:** drag the app into Applications. The build is unsigned, so the first time use **right-click → Open**
(then *Open* again). If macOS says it is "damaged", run `xattr -cr "/Applications/Self-Drive Test Bench.app"` once.

**Windows:** run `Self-Drive-Test-Bench-Setup-<version>.exe` to install, or use the `-portable.exe` which needs no
install at all (just double-click). The builds are unsigned, so Windows SmartScreen may say "Windows protected your
PC": click **More info → Run anyway**.

**Updating:** there is no auto-update (that needs paid code-signing certificates). To update, install or
download the new version over the old one. Your rule sets and settings are kept - they live in the app's own data
folder, not in the app itself. Use *Export* on the rules tab if you want a backup. (The portable .exe keeps its
data per Windows user, so it is shared between versions too.)

## Using it

* **Ego rules tab** – an ordered stack of rules. Toggle them, expand to tune parameters, reorder with ▲▼.
  Edits apply *live* to the running car; the card for whichever rule is currently driving lights up, and the
  on-canvas readout says what is controlling acceleration / lane changes and why a lane change was vetoed.
  Presets, JSON export/import and auto-save (localStorage) are included.
* **Decisions tab** – a plain-English log of what the car decided and why: speed control changes (which rule took
  over, what every other rule proposed and why it was overruled), planned / completed / abandoned lane changes
  (with the impact check and signalling), lane changes blocked by a rule, and emergency brakes. Click an entry for
  the full situation. Above it, a breakdown of which rule was driving the speed.
* **Traffic tab** – seed, lanes, length, density, on-ramp flow, the driver mix, and every parameter of each
  driver personality (headway, politeness, signalling probability, gap accepted when merging, reaction time,
  attention lapses…). Applies on restart.
* **Results tab** – live scores (safety, comfort, efficiency, courtesy), an event log (near misses, cut-offs,
  unsignalled lane changes…), and a **batch test**: run the current rules over N consecutive seeds headlessly,
  set the result as a baseline, tweak a rule, run again and see the deltas.

Traffic drives on the left (UK style): the slow lane is the top lane on screen, overtaking lanes are below it,
and on-ramps join on the left. Great drivers sit in the slow lane unless they are overtaking.

**Views**: top-down, top-down with a *driver dashcam* inset (click it to enlarge), or full dashcam - a
perspective view from the driver's seat with a rear-view mirror, the tracked vehicle, speed signs and the
indicator.

**Endless loop**: the road is a loop - the same layout (speed zones, on-ramps) repeats lap after lap and the run
never finishes (switch off *Endless road* in the Traffic tab to finish after N laps). The ring in the corner
shows where you are on the loop. Batch tests score one lap per seed.

Keys: `Space` play/pause, `R` restart.

### How rules combine

Rules run in list order. *Acceleration* proposals are resolved most-restrictive-wins (so adding a rule can only
make the car more cautious). *Lane-change* proposals are resolved by order – the first rule to propose wins.
Rules marked **filter** run afterwards and can veto a lane change (safety check), delay it so the indicator is
seen first (signal), or clamp acceleration (comfort limits; emergency braking is exempt).

Built-in rules: emergency brake · keep following distance (IDM) · yield to merging traffic · keep to speed
limit · move over for on-ramp · overtake slow vehicles · return to slow lane · no undertaking ·
lane-change impact check · signal before lane change · comfort limits.

**Overtaking** is triggered by whether the vehicle ahead will *affect* you: it must be slower than your target
speed and close enough that you would have to follow it. The car moves over early - allowing for the signal
delay and the move itself - so it never has to slow down for the vehicle first. A car going about the same
speed is simply followed. **No undertaking** holds the car back rather than passing on the inside, and vetoes
a move left that would pass a slower car in its own lane (slow-moving queues are exempt).

### Lane-change safety is about impact, not distance

Before pulling out, the car (and every traffic driver) asks *how much harder will the driver behind have to
brake?* A car closing fast is affected even from a long way back, while one crawling behind barely notices a
short gap. The ego's **Lane-change impact check** rule has three knobs: the braking it will impose on them,
the braking it will accept itself, and an absolute minimum gap. Each driver personality has its own
"impact on others tolerated".

### What the car sees

The canvas shows the car's view ahead: the forward sensor field, the tracked vehicle (its speed, acceleration
and momentum change in kN, closing speed and time-to-collision), and, while a lane change is being
considered, the driver it would pull in front of with the braking it would cause (green = acceptable, red =
vetoed).

## Layout

```
src/sim/       deterministic simulation (no DOM): road generator, IDM, world, metrics, headless runner
src/drivers/   traffic personalities + the IDM/MOBIL-style traffic driver
src/ego/       rule engine: context/draft, rule implementations, rule set (JSON), presets, ego driver
src/render/    canvas renderer
src/ui/        plain-DOM panels (rules, traffic, results)
tests/         vitest
```

To add a rule, write a `RuleImpl` in `src/ego/rules.ts` (`def` with its parameters + a `run(ctx, params, draft)`)
and add it to `RULE_IMPLS`; the UI builds its card from the definition.

## Modelling notes / limits

2D top-down, kinematic (no tyre/steering dynamics). The road is straight, with speed-limit zones and on-ramps;
the canvas stretches the lateral axis for legibility. Only vehicles within a window around the ego are
simulated (traffic is seeded ahead and drips in from behind), which keeps runs fast. Everything is driven by a
seeded PRNG, so a seed plus settings reproduces a run exactly.
