import { VEHICLE_SPECS, VEHICLE_TYPES } from '../sim/vehicle';
import { PERSONALITIES, PERSONALITY_IDS, PERSONALITY_PARAMS, clonePersonalities } from '../drivers/personality';
import { WEATHER_KINDS, type WeatherKind } from '../sim/weather';
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
        hint: 'On: the posted limit changes along the road (120 / 100 / 80 km/h, or 75 / 62 / 50 mph, zones). Off: a constant 120 km/h (75 mph).',
        onChange: (v) => { cfg.variableLimits = v; app.trafficDirty(); },
      }),
      toggle({
        label: 'Endless road (loops forever)', value: cfg.endless,
        hint: 'On: the road is a loop and the run never finishes - the same layout repeats lap after lap. Off: the run ends after the chosen number of laps.',
        onChange: (v) => { cfg.endless = v; app.trafficDirty(); build(); },
      }),
      ...(cfg.endless ? [] : [slider({ label: 'Laps before finishing', min: 1, max: 10, step: 1, value: cfg.laps, onInput: (v) => { cfg.laps = v; app.trafficDirty(); } })]),
      slider({ label: 'Lanes', min: 2, max: 5, step: 1, value: cfg.lanes, onInput: (v) => { cfg.lanes = v; app.trafficDirty(); } }),
      slider({ label: 'Loop length', min: 2000, max: 15000, step: 500, unit: 'long-m', value: cfg.length, onInput: (v) => { cfg.length = v; app.trafficDirty(); } }),
      slider({ label: 'Traffic density', min: 3, max: 35, step: 1, unit: 'veh/km/lane', value: cfg.density, onInput: (v) => { cfg.density = v; app.trafficDirty(); } }),
      slider({ label: 'On-ramp flow', min: 0, max: 20, step: 1, unit: 'veh/min', value: cfg.rampRate, onInput: (v) => { cfg.rampRate = v; app.trafficDirty(); } }),
      h('h4', {}, 'Weather'),
      h('div', { class: 'set-row' }, h('span', {}, 'Conditions', h('small', {}, 'Rain, fog and snow cut grip and visibility')),
        (() => {
          const sel = h('select', { on: { change: () => { cfg.weather.kind = sel.value as WeatherKind | 'variable'; app.trafficDirty(); build(); } } },
            ...WEATHER_KINDS.map((k) => h('option', { value: k, selected: cfg.weather.kind === k }, { clear: 'Clear', rain: 'Rain', fog: 'Fog', snow: 'Snow & ice' }[k])),
            h('option', { value: 'variable', selected: cfg.weather.kind === 'variable' }, 'Variable (changes during the run)'));
          return sel;
        })()),
      ...(cfg.weather.kind === 'clear' || cfg.weather.kind === 'variable' ? [] : [slider({
        label: 'Intensity', min: 0.1, max: 1, step: 0.05, value: cfg.weather.intensity,
        onInput: (v) => { cfg.weather.intensity = v; app.trafficDirty(); },
      })]),
      h('h4', {}, 'Road hazards'),
      h('div', { class: 'set-row' }, h('span', {}, 'How many', h('small', {}, 'Breakdowns, debris and roadworks that close a lane')),
        (() => {
          const levels: [string, number][] = [['Off', 0], ['Few', 0.3], ['Some', 0.7], ['Many', 1.5]];
          const sel = h('select', { on: { change: () => { cfg.hazards.rate = Number(sel.value); app.trafficDirty(); build(); } } },
            ...levels.map(([label, rate]) => h('option', { value: String(rate), selected: Math.abs(cfg.hazards.rate - rate) < 0.01 }, label)));
          return sel;
        })()),
      ...(cfg.hazards.rate > 0 ? ([['breakdowns', 'Broken-down vehicles'], ['debris', 'Debris in the road'], ['roadworks', 'Roadworks (lane closed)']] as const).map(([key, label]) =>
        toggle({ label, value: cfg.hazards[key], onChange: (v) => { cfg.hazards[key] = v; app.trafficDirty(); } })) : []),
      h('h4', {}, 'Vehicle mix'),
      ...VEHICLE_TYPES.map((t) => slider({
        label: VEHICLE_SPECS[t].label, min: 0, max: 100, step: 1, value: cfg.vehicleMix[t],
        hint: VEHICLE_SPECS[t].heavy ? 'Heavy vehicles keep out of the fastest lane (3+ lane roads) and are speed limited.' : undefined,
        onInput: (v) => { cfg.vehicleMix[t] = v; app.trafficDirty(); },
      })),
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
