import { PERSONALITY_IDS } from '../drivers/personality';
import { drawTopDown } from '../render/sprites';
import { VEHICLE_SPECS, VEHICLE_TYPES, type Vehicle, type VehicleType } from '../sim/vehicle';
import type { World } from '../sim/world';
import { h } from './dom';

function swatch(type: VehicleType, color: string): HTMLCanvasElement {
  const c = h('canvas', { width: 64, height: 26, class: 'lg-sprite' });
  const ctx = c.getContext('2d')!;
  const spec = VEHICLE_SPECS[type];
  const scale = Math.min(54 / spec.length, 11);
  const len = spec.length * scale, wid = Math.max(Math.min(spec.width * scale * 1.15, 20), 6);
  const v = { type, color, crashed: false, a: 0, indicator: 0, length: spec.length, width: spec.width, hazard: false } as unknown as Vehicle;
  ctx.translate(32, 13);
  drawTopDown(ctx, v, len, wid);
  return c;
}

/** What the colours and shapes mean, with a live count of what is around the ego. */
export function createLegend(): { el: HTMLElement; refresh(world: World): void } {
  const counts = new Map<string, HTMLElement>();
  const countEl = (key: string) => { const s = h('span', { class: 'lg-n' }); counts.set(key, s); return s; };
  const section = (title: string, ...rows: HTMLElement[]) => h('div', { class: 'lg-sec' }, h('b', {}, title), ...rows);

  const body = h('div', { class: 'lg-body', hidden: true },
    section('Driver style (colour)', ...PERSONALITY_IDS.map((id) =>
      h('div', { class: 'lg-row', 'data-id': id }, h('i', { class: 'lg-dot' }), h('span', { class: 'lg-name' }), countEl(`p:${id}`)))),
    section('Vehicle (shape)', ...VEHICLE_TYPES.map((t) =>
      h('div', { class: 'lg-row' }, swatch(t, '#8da2c0'), h('span', {}, VEHICLE_SPECS[t].label), countEl(`t:${t}`)))),
    section('Hazards',
      h('div', { class: 'lg-row' }, swatch('debris', '#8b7355'), h('span', {}, 'Debris')),
      h('div', { class: 'lg-row' }, swatch('barrier', '#e8452c'), h('span', {}, 'Closed lane barrier')),
      h('div', { class: 'lg-row' }, h('i', { class: 'lg-hatch' }), h('span', {}, 'Roadworks (lane closed)')),
      h('div', { class: 'lg-row' }, h('i', { class: 'lg-flash' }), h('span', {}, 'Flashing lights = broken down'))),
    section('You', h('div', { class: 'lg-row' }, h('i', { class: 'lg-ego' }), h('span', {}, 'Ego car (white outline)'))));
  const toggle = h('button', { class: 'small lg-toggle', on: { click: () => { body.hidden = !body.hidden; toggle.textContent = body.hidden ? 'Legend ▸' : 'Legend ▾'; } } }, 'Legend ▸');
  const el = h('div', { class: 'legend' }, toggle, body);

  return {
    el,
    refresh(world) {
      const near = world.vehicles.filter((v) => v.kind === 'traffic' && !v.isStatic && Math.abs(v.s - world.ego.s) < 500);
      for (const row of body.querySelectorAll<HTMLElement>('.lg-row[data-id]')) {
        const id = row.dataset.id as (typeof PERSONALITY_IDS)[number];
        const p = world.cfg.personalities[id];
        (row.querySelector('.lg-dot') as HTMLElement).style.background = p.color;
        (row.querySelector('.lg-name') as HTMLElement).textContent = p.name;
      }
      for (const id of PERSONALITY_IDS) counts.get(`p:${id}`)!.textContent = String(near.filter((v) => v.label === id).length);
      for (const t of VEHICLE_TYPES) counts.get(`t:${t}`)!.textContent = String(near.filter((v) => v.type === t).length);
    },
  };
}
