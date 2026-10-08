import { PERSONALITIES, PERSONALITY_IDS, PERSONALITY_PARAMS, clonePersonalities } from '../drivers/personality';
import { h, slider, toggle } from './dom';
import type { App, Panel } from './state';

export function trafficPanel(app: App): Panel {
  const el = h('div');

  function build(): void {
    el.replaceChildren();
    const { cfg } = app;

    const seed = h('input', { type: 'number', value: String(cfg.seed), style: 'width:90px' });
    seed.addEventListener('change', () => { cfg.seed = Math.max(0, Math.floor(Number(seed.value) || 0)); app.restart(); });

    el.append(
      h('div', { class: 'row' }, h('span', {}, 'Seed'), seed,
        h('button', { on: { click: () => { cfg.seed = Math.floor(Math.random() * 100000); seed.value = String(cfg.seed); app.restart(); } } }, '🎲 Random'),
        h('button', { class: 'primary', on: { click: () => app.restart() } }, '↻ Restart')),
      h('p', { class: 'note' }, 'Same seed + same settings = identical road and traffic every time, so you can compare rule changes fairly. Changes below apply on restart.'),
      h('h4', {}, 'Road'),
      toggle({
        label: 'Variable speed limits', value: cfg.variableLimits,
        hint: 'On: the posted limit changes along the road (120 / 100 / 80 km/h zones). Off: a constant 120 km/h.',
        onChange: (v) => { cfg.variableLimits = v; app.trafficDirty(); },
      }),
      toggle({
        label: 'Endless road (loops forever)', value: cfg.endless,
        hint: 'On: the road is a loop and the run never finishes - the same layout repeats lap after lap. Off: the run ends after the chosen number of laps.',
        onChange: (v) => { cfg.endless = v; app.trafficDirty(); build(); },
      }),
      ...(cfg.endless ? [] : [slider({ label: 'Laps before finishing', min: 1, max: 10, step: 1, value: cfg.laps, onInput: (v) => { cfg.laps = v; app.trafficDirty(); } })]),
      slider({ label: 'Lanes', min: 2, max: 5, step: 1, value: cfg.lanes, onInput: (v) => { cfg.lanes = v; app.trafficDirty(); } }),
      slider({ label: 'Loop length', min: 2000, max: 15000, step: 500, unit: 'm', value: cfg.length, onInput: (v) => { cfg.length = v; app.trafficDirty(); } }),
      slider({ label: 'Traffic density', min: 3, max: 35, step: 1, unit: 'veh/km/lane', value: cfg.density, onInput: (v) => { cfg.density = v; app.trafficDirty(); } }),
      slider({ label: 'On-ramp flow', min: 0, max: 20, step: 1, unit: 'veh/min', value: cfg.rampRate, onInput: (v) => { cfg.rampRate = v; app.trafficDirty(); } }),
      h('h4', {}, 'Driver mix'),
    );

    for (const id of PERSONALITY_IDS) {
      const p = cfg.personalities[id];
      const wrap = h('div', { class: 'mix' }, h('i', { style: `background:${p.color}` }));
      const inner = h('div', {},
        slider({ label: p.name, min: 0, max: 10, step: 1, value: cfg.mix[id], onInput: (v) => { cfg.mix[id] = v; app.trafficDirty(); } }),
        h('details', {},
          h('summary', {}, 'Tune behaviour'),
          ...PERSONALITY_PARAMS.map((prm) => slider({
            label: prm.label, min: prm.min, max: prm.max, step: prm.step, unit: prm.unit,
            value: p[prm.key] as number,
            onInput: (v) => { (p as unknown as Record<string, number>)[prm.key] = v; app.trafficDirty(); },
          }))));
      wrap.append(inner);
      el.append(wrap);
    }

    el.append(h('button', { class: 'small', on: { click: () => {
      cfg.personalities = clonePersonalities(PERSONALITIES);
      app.trafficDirty();
      build();
    } } }, 'Reset driver behaviours'));
  }

  build();
  return { el, rebuild: build, refresh() { /* static */ } };
}
