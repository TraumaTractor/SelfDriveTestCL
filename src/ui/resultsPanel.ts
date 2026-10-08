import { runHeadless, type RunSummary } from '../sim/headless';
import type { Scores } from '../sim/metrics';
import { h } from './dom';
import type { App, Panel } from './state';
import * as U from '../units';

interface Batch {
  runs: RunSummary[];
  mean: Scores;
  finished: number;
  crashed: number;
  nearMisses: number;
  hardBrakes: number;
  unsignalled: number;
  cutOffs: number;
  avgSpeed: number;
}

function aggregate(runs: RunSummary[]): Batch {
  const n = runs.length;
  const avg = (f: (r: RunSummary) => number) => runs.reduce((a, r) => a + f(r), 0) / n;
  return {
    runs,
    mean: {
      safety: avg((r) => r.scores.safety), comfort: avg((r) => r.scores.comfort),
      efficiency: avg((r) => r.scores.efficiency), courtesy: avg((r) => r.scores.courtesy), overall: avg((r) => r.scores.overall),
    },
    finished: runs.filter((r) => r.status === 'finished').length,
    crashed: runs.filter((r) => r.status === 'crashed').length,
    nearMisses: avg((r) => r.nearMisses), hardBrakes: avg((r) => r.hardBrakes),
    unsignalled: avg((r) => r.unsignalled), cutOffs: avg((r) => r.cutOffs), avgSpeed: avg((r) => r.avgSpeed),
  };
}

export function resultsPanel(app: App): Panel {
  const el = h('div');
  const bars = h('div', { class: 'bars' });
  const staleBanner = h('div', { class: 'banner' }, 'Rules changed since this run started. ',
    h('button', { class: 'small', on: { click: () => app.restart() } }, 'Restart to compare'));
  staleBanner.hidden = true;
  const log = h('div', { class: 'log' });
  const batchOut = h('div');
  const count = h('input', { type: 'number', value: '12', min: '2', max: '60', style: 'width:64px' });
  const runBtn = h('button', { class: 'primary' }, '▶ Run batch');
  let baseline: Batch | null = null;
  let last: Batch | null = null;
  let logCount = -1;
  let running = false;

  function bar(label: string, v: number): HTMLElement {
    return h('div', { class: 'bar' }, h('span', {}, label),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${v}%;background:${v > 75 ? 'var(--good)' : v > 45 ? 'var(--warn)' : 'var(--bad)'}` })),
      h('span', {}, v.toFixed(0)));
  }

  function delta(now: number, base: number | undefined, higherBetter: boolean, digits = 1): HTMLElement | string {
    if (base === undefined) return '';
    const d = now - base;
    if (Math.abs(d) < 0.05) return h('span', { class: 'delta' }, ' ±0');
    const good = higherBetter ? d > 0 : d < 0;
    return h('span', { class: `delta ${good ? 'up' : 'down'}` }, ` ${d > 0 ? '+' : ''}${d.toFixed(digits)}`);
  }

  function renderBatch(): void {
    batchOut.replaceChildren();
    if (!last) return;
    const b = last, base = baseline && baseline !== last ? baseline : null;
    const row = (label: string, now: number, bv: number | undefined, hb: boolean, digits = 1) =>
      h('tr', {}, h('td', {}, label), h('td', {}, now.toFixed(digits), delta(now, bv, hb, digits)));
    batchOut.append(
      h('table', {},
        h('tr', {}, h('th', {}, `Mean over ${b.runs.length} seeds (${app.cfg.endless ? 'one lap each' : app.cfg.laps + ' lap(s) each'})`), h('th', {}, base ? 'vs baseline' : '')),
        row('Overall score', b.mean.overall, base?.mean.overall, true),
        row('Safety', b.mean.safety, base?.mean.safety, true),
        row('Comfort', b.mean.comfort, base?.mean.comfort, true),
        row('Efficiency', b.mean.efficiency, base?.mean.efficiency, true),
        row('Courtesy', b.mean.courtesy, base?.mean.courtesy, true),
        row('Crashed runs', b.crashed, base?.crashed, false, 0),
        row('Finished runs', b.finished, base?.finished, true, 0),
        row('Near misses / run', b.nearMisses, base?.nearMisses, false),
        row('Hard brakes / run', b.hardBrakes, base?.hardBrakes, false),
        row('Unsignalled changes / run', b.unsignalled, base?.unsignalled, false),
        row('Cut-offs / run', b.cutOffs, base?.cutOffs, false),
        row(`Average speed (${U.speedUnit()})`, U.speedValue(b.avgSpeed), base ? U.speedValue(base.avgSpeed) : undefined, true)),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'small', on: { click: () => { baseline = b; renderBatch(); } } }, 'Set as baseline'),
        baseline ? h('button', { class: 'small', on: { click: () => { baseline = null; renderBatch(); } } }, 'Clear baseline') : null),
      h('details', {}, h('summary', {}, 'Per seed'),
        h('table', {},
          h('tr', {}, h('th', {}, 'seed'), h('th', {}, 'result'), h('th', {}, 'score'), h('th', {}, 'NM'), h('th', {}, U.speedUnit())),
          ...b.runs.map((r) => h('tr', {}, h('td', {}, String(r.seed)), h('td', {}, r.status), h('td', {}, r.scores.overall.toFixed(0)),
            h('td', {}, String(r.nearMisses)), h('td', {}, U.speedValue(r.avgSpeed).toFixed(0)))))),
    );
  }

  U.onUnitsChange(() => renderBatch());

  runBtn.addEventListener('click', async () => {
    if (running) return;
    running = true;
    const n = Math.max(2, Math.min(60, Math.floor(Number(count.value) || 12)));
    const runs: RunSummary[] = [];
    const rules = app.rules.clone();
    for (let i = 0; i < n; i++) {
      runBtn.textContent = `Running ${i + 1}/${n}…`;
      await new Promise((r) => setTimeout(r, 0));
      runs.push(runHeadless({ ...app.cfg, seed: app.cfg.seed + i, personalities: app.cfg.personalities, mix: app.cfg.mix }, rules));
    }
    last = aggregate(runs);
    if (!baseline) baseline = null;
    running = false;
    runBtn.textContent = '▶ Run batch';
    renderBatch();
  });

  el.append(
    staleBanner,
    h('h4', {}, 'This run'), bars,
    h('h4', {}, 'Events'), log,
    h('h4', {}, 'Batch test'),
    h('p', { class: 'note' }, 'Runs your current rules headlessly on consecutive seeds (starting at the current seed) and averages the scores. Set a baseline, tweak a rule, run again to see the change.'),
    h('div', { class: 'row' }, count, h('span', {}, 'seeds'), runBtn),
    batchOut,
  );

  return {
    el,
    rebuild() { staleBanner.hidden = true; },
    refresh(a) {
      const w = a.world;
      const s = w.metrics.scores(w.status === 'crashed');
      bars.replaceChildren(bar('Overall', s.overall), bar('Safety', s.safety), bar('Comfort', s.comfort), bar('Efficiency', s.efficiency), bar('Courtesy', s.courtesy));
      const n = w.events.length;
      if (n !== logCount) {
        logCount = n;
        log.replaceChildren(...w.events.slice(-80).reverse().map((e) => h('div', { class: e.severity }, `${e.t.toFixed(1).padStart(6)}s  ${e.text}`)));
      }
    },
  };
}

export function setStale(panel: Panel, stale: boolean): void {
  const banner = panel.el.firstElementChild as HTMLElement | null;
  if (banner) banner.hidden = !stale;
}
