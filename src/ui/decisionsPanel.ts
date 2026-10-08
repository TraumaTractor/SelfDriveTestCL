import { RULE_BY_ID } from '../ego/rules';
import type { DecisionKind, DecisionRecord } from '../ego/decisions';
import { h } from './dom';
import type { App, Panel } from './state';
import * as U from '../units';

const ruleName = (id: string): string => RULE_BY_ID[id]?.def.name ?? id;
const FILTERS: [string, DecisionKind[] | null][] = [
  ['All', null], ['Speed', ['speed', 'emergency']], ['Lane changes', ['lane']], ['Blocked', ['blocked']],
];

export function decisionsPanel(app: App): Panel {
  const el = h('div');
  const summary = h('div', { class: 'bars' });
  const stats = h('div', { class: 'note' });
  const list = h('div', { class: 'decisions' });
  const chips = h('div', { class: 'row' });
  const open = new Set<number>();
  let filter = 0;
  let lastVersion = -1;
  let lastDriver: unknown = null;

  FILTERS.forEach(([label], i) => {
    chips.append(h('button', { class: `small chip${i === 0 ? ' on' : ''}`, on: { click: () => {
      filter = i;
      [...chips.children].forEach((c, j) => c.classList.toggle('on', i === j));
      lastVersion = -1;
    } } }, label));
  });

  el.append(
    h('p', { class: 'note' }, 'Every decision the car makes, in plain words: what it chose, which rules were involved, why, and how it turned out. Newest first. Click an entry for the full picture.'),
    h('h4', {}, 'What was driving the speed'), summary, stats,
    h('h4', {}, 'Decision log'), chips, list,
  );

  function card(r: DecisionRecord): HTMLElement {
    const s = r.snapshot;
    const detail = h('div', { class: 'dec-detail' },
      h('div', {}, `Situation: lane ${s.lane}, ${U.speed(s.speed)} (target ${U.speed(s.target)}, limit ${U.speed(s.limit)})`),
      h('div', {}, s.leader
        ? `Ahead: ${s.leader.name} at ${U.speed(s.leader.v)}, ${U.dist(s.leader.gap)}${s.leader.ttc ? `, TTC ${s.leader.ttc.toFixed(1)} s` : ''}`
        : 'Ahead: nothing in range'),
      ...(r.proposals.length ? [h('div', { class: 'dec-props' }, 'Acceleration proposals at that moment:'),
        ...[...r.proposals].sort((a, b) => a.a - b.a).map((p, i) =>
          h('div', {}, `${i === 0 ? '▶' : '  '} ${ruleName(p.by)}: ${U.accel(p.a, true)}`))] : []));
    detail.hidden = !open.has(r.id);
    const c = h('div', { class: `dec ${r.kind} ${r.tone ?? ''}`, on: { click: () => {
      if (open.has(r.id)) open.delete(r.id); else open.add(r.id);
      detail.hidden = !open.has(r.id);
    } } },
      h('div', { class: 'dec-head' }, h('span', { class: 'dec-t' }, `${r.t.toFixed(1)}s`), h('span', { class: 'dec-title' }, r.title),
        h('button', { class: 'small replay-link', title: 'Replay this moment', on: { click: (e) => { e.stopPropagation(); app.replayTo(r.t); } } }, '▶ Replay')),
      h('div', { class: 'dec-rules' }, ...r.rules.map((id) => h('span', { class: 'tag' }, ruleName(id)))),
      h('ul', {}, ...r.why.map((w) => h('li', {}, w))),
      r.outcome ? h('div', { class: `dec-out ${r.tone ?? ''}` }, `→ ${r.outcome}`) : null,
      detail);
    return c;
  }

  return {
    el,
    rebuild() { lastVersion = -1; open.clear(); },
    refresh(a) {
      const log = a.driver.log;
      if (log !== lastDriver) { lastDriver = log; lastVersion = -1; open.clear(); }
      const total = Math.max(log.totalTime, 1e-6);
      const rows = Object.entries(log.ruleTime).sort((x, y) => y[1] - x[1]).slice(0, 6);
      summary.replaceChildren(...rows.map(([id, t]) => {
        const pct = (100 * t) / total;
        return h('div', { class: 'bar' }, h('span', {}, id === 'none' ? 'nothing' : ruleName(id)),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${pct}%` })), h('span', {}, `${pct.toFixed(0)}%`));
      }));
      const c = log.counts;
      stats.textContent = `Lane changes: ${c.planned} planned · ${c.completed} completed · ${c.abandoned} abandoned · ${c.blocked} blocked by a rule · ${c.emergencies} emergency brakes`;

      if (log.version === lastVersion) return;
      lastVersion = log.version;

      const kinds = FILTERS[filter][1];
      const recs = log.records.filter((r) => !kinds || kinds.includes(r.kind)).slice(-120).reverse();
      list.replaceChildren(...(recs.length ? recs.map(card) : [h('div', { class: 'note' }, 'No decisions yet - press play.')]));
    },
  };
}
