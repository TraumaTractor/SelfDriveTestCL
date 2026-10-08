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

## Using it

* **Ego rules tab** – an ordered stack of rules. Toggle them, expand to tune parameters, reorder with ▲▼.
  Edits apply *live* to the running car; the card for whichever rule is currently driving lights up, and the
  on-canvas readout says what is controlling acceleration / lane changes and why a lane change was vetoed.
  Presets, JSON export/import and auto-save (localStorage) are included.
* **Traffic tab** – seed, lanes, length, density, on-ramp flow, the driver mix, and every parameter of each
  driver personality (headway, politeness, signalling probability, gap accepted when merging, reaction time,
  attention lapses…). Applies on restart.
* **Results tab** – live scores (safety, comfort, efficiency, courtesy), an event log (near misses, cut-offs,
  unsignalled lane changes…), and a **batch test**: run the current rules over N consecutive seeds headlessly,
  set the result as a baseline, tweak a rule, run again and see the deltas.

Traffic drives on the left (UK style): the slow lane is the top lane on screen, overtaking lanes are below it,
and on-ramps join on the left. Great drivers sit in the slow lane unless they are overtaking.

Keys: `Space` play/pause, `R` restart.

### How rules combine

Rules run in list order. *Acceleration* proposals are resolved most-restrictive-wins (so adding a rule can only
make the car more cautious). *Lane-change* proposals are resolved by order – the first rule to propose wins.
Rules marked **filter** run afterwards and can veto a lane change (safety check), delay it so the indicator is
seen first (signal), or clamp acceleration (comfort limits; emergency braking is exempt).

Built-in rules: emergency brake · keep following distance (IDM) · yield to merging traffic · keep to speed
limit · move over for on-ramp · overtake slow vehicles · return to slow lane · lane-change safety ·
signal before lane change · comfort limits.

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
