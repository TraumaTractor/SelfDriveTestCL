import { PERSONALITIES, type PersonalityId } from '../drivers/personality';
import * as U from '../units';
import { VEHICLE_SPECS, type Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';
import { h } from './dom';

export interface Inspector {
  el: HTMLElement;
  show(id: number): void;
  hide(): void;
  refresh(world: World): void;
  readonly id: number | null;
}

/** Click a vehicle to see who is driving it and how it is behaving. */
export function createInspector(opts: { onFollow(id: number | null): void; onClose(): void; isFollowing(id: number): boolean }): Inspector {
  let current: number | null = null;
  const el = h('div', { class: 'inspector' });
  el.hidden = true;

  function describe(v: Vehicle, world: World): { title: string; rows: [string, string][]; chip: string } {
    const spec = VEHICLE_SPECS[v.type];
    const rows: [string, string][] = [];
    let title = spec.label;
    if (v.kind === 'ego') title = 'Ego car (your rules)';
    else if (v.isStatic) title = v.type === 'barrier' ? 'Road closure barrier' : v.type === 'debris' ? 'Debris' : `Broken-down ${spec.noun}`;
    else {
      const p = PERSONALITIES[v.label as PersonalityId] ? world.cfg.personalities[v.label as PersonalityId] : undefined;
      title = `${p?.name ?? v.label} ${spec.noun}`;
    }
    rows.push(['Speed', U.speed(v.v)], ['Acceleration', U.accel(v.a, true)], ['Lane', `${v.targetLane + 1}${v.changing ? ' (changing)' : ''}${v.onRamp ? ' · on-ramp' : ''}`]);
    if (v.indicator !== 0) rows.push(['Indicator', v.indicator === 1 ? 'right (overtaking side)' : 'left']);
    rows.push(['Size', `${U.dist(v.length, 1)} × ${U.dist(v.width, 1)}`], ['Weight', `${spec.mass.toLocaleString()} kg`]);
    if (v.crashed) rows.push(['State', 'crashed']);
    if (!v.isStatic && v.kind === 'traffic') {
      const p = world.cfg.personalities[v.label as PersonalityId];
      if (p) {
        rows.push(['Headway', `${(p.headway * spec.headwayScale).toFixed(1)} s`], ['Signals', `${Math.round(p.signalProb * 100)}% of lane changes`],
          ['Politeness', p.politeness.toFixed(2)], ['Yields to mergers', `${Math.round(p.courtesy * 100)}%`], ['Adapts to weather', `${Math.round(p.weatherCare * 100)}%`],
          ['Attention lapses', p.lapseRate > 0 ? `${(p.lapseRate * 60).toFixed(1)} per minute` : 'never']);
      }
      if (Number.isFinite(spec.maxSpeed)) rows.push(['Speed limited to', U.speed(spec.maxSpeed)]);
      if (spec.heavy) rows.push(['Lanes', 'keeps out of the fastest lane']);
    }
    return { title, rows, chip: v.color };
  }

  function render(world: World): void {
    const v = current == null ? undefined : world.vehicles.find((x) => x.id === current);
    if (!v) {
      el.replaceChildren(h('div', { class: 'ins-head' }, h('b', {}, 'Vehicle gone'),
        h('button', { class: 'small', on: { click: () => { api.hide(); opts.onClose(); } } }, '✕')),
        h('div', { class: 'note' }, 'It has left the area (or the replay moved on).'));
      return;
    }
    const d = describe(v, world);
    const following = opts.isFollowing(v.id);
    el.replaceChildren(
      h('div', { class: 'ins-head' }, h('i', { class: 'ins-chip', style: `background:${d.chip}` }), h('b', {}, d.title),
        h('button', { class: 'small', title: 'Close', on: { click: () => { api.hide(); opts.onClose(); } } }, '✕')),
      h('table', {}, ...d.rows.map(([k, val]) => h('tr', {}, h('td', {}, k), h('td', {}, val)))),
      h('div', { class: 'row' },
        h('button', { class: 'small', on: { click: () => { opts.onFollow(following ? null : v.id); } } }, following ? 'Follow ego again' : '🎥 Follow this vehicle')));
  }

  const api: Inspector = {
    el,
    get id() { return current; },
    show(id) { current = id; el.hidden = false; },
    hide() { current = null; el.hidden = true; },
    refresh(world) { if (current != null) render(world); },
  };
  return api;
}
