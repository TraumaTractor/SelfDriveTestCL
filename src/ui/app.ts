import { EgoDriver } from '../ego/egoDriver';
import { RuleSet } from '../ego/rules';
import { Renderer } from '../render/renderer';
import { SIM_DT } from '../sim/headless';
import { World, defaultConfig, type WorldConfig } from '../sim/world';
import { MS_TO_KMH } from '../common';
import { h } from './dom';
import { resultsPanel, setStale } from './resultsPanel';
import { rulesPanel } from './rulesPanel';
import type { App, Panel } from './state';
import { trafficPanel } from './trafficPanel';
import './style.css';

const STORAGE_KEY = 'selfdrive-testbench-v1';

function load(): { cfg?: Partial<WorldConfig>; rules?: unknown } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function save(app: App): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cfg: app.cfg, rules: app.rules.toJSON() }));
  } catch {
    /* storage unavailable - fine */
  }
}

export function startApp(root: HTMLElement): void {
  const saved = load();
  const cfg: WorldConfig = { ...defaultConfig(), ...(saved.cfg ?? {}) };
  cfg.mix = { ...defaultConfig().mix, ...(saved.cfg?.mix ?? {}) };
  cfg.personalities = { ...defaultConfig().personalities, ...(saved.cfg?.personalities ?? {}) };
  let rules = new RuleSet();
  try { if (saved.rules) rules = RuleSet.fromJSON(saved.rules); } catch { /* ignore corrupt data */ }

  const driver = new EgoDriver(rules);
  const app: App = {
    cfg, rules, driver, world: new World(cfg, driver),
    restart() {
      this.driver = new EgoDriver(this.rules);
      this.world = new World(this.cfg, this.driver);
      acc = 0;
      setStale(results, false);
      save(this);
      status();
    },
    trafficDirty() {
      save(this);
      banner.hidden = false;
    },
    rulesChanged() {
      save(this);
      if (this.world.time > 1 || this.world.status !== 'running') setStale(results, true);
    },
    setRules(r) {
      this.rules = r;
      this.driver.rules = r; // live: current run picks the new rules up immediately
      rulesTab.rebuild(this);
      this.rulesChanged();
    },
  };

  // ----------------------------------------------------------- layout
  const canvas = h('canvas');
  const renderer = new Renderer(canvas);
  const rulesTab = rulesPanel(app);
  const trafficTab = trafficPanel(app);
  const results = resultsPanel(app);
  let playing = true;
  let speed = 1;
  let zoom = 9;
  let sensors = true;
  let labels = false;
  let acc = 0;

  const playBtn = h('button', { class: 'primary', on: { click: () => toggle() } }, '⏸ Pause');
  const toggle = () => { playing = !playing; status(); };
  const status = () => { playBtn.textContent = playing ? '⏸ Pause' : '▶ Play'; };
  const banner = h('div', { class: 'banner' }, 'Traffic/road settings changed. ',
    h('button', { class: 'small', on: { click: () => { banner.hidden = true; app.restart(); } } }, 'Restart to apply'));
  banner.hidden = true;

  const speedSel = h('select', { on: { change: () => { speed = Number(speedSel.value); } } },
    ...[0.25, 0.5, 1, 2, 4, 8].map((s) => h('option', { value: String(s), selected: s === 1 }, `${s}×`)));
  const zoomIn = h('input', { type: 'range', min: '3', max: '16', step: '0.5', value: String(zoom), style: 'width:90px',
    on: { input: () => { zoom = Number(zoomIn.value); } } });
  const chk = (label: string, init: boolean, fn: (v: boolean) => void) => {
    const i = h('input', { type: 'checkbox', checked: init, on: { change: () => fn(i.checked) } });
    return h('label', { class: 'chk' }, i, label);
  };

  const header = h('header', { class: 'bar' },
    h('h1', {}, 'SELF-DRIVE ', h('span', {}, 'TEST BENCH')),
    playBtn,
    h('button', { title: 'Advance one tick', on: { click: () => { playing = false; status(); app.world.step(SIM_DT); } } }, '⏭ Step'),
    h('button', { on: { click: () => app.restart() } }, '↻ Restart'),
    h('label', { class: 'chk' }, 'Speed', speedSel),
    h('label', { class: 'chk' }, 'Zoom', zoomIn),
    chk('Sensors', sensors, (v) => (sensors = v)),
    chk('Driver labels', labels, (v) => (labels = v)),
    h('span', { class: 'spacer' }),
    h('span', { id: 'seedlabel', class: 'chk' }, ''));

  const tiles = h('div', { class: 'tiles' });
  const tileDefs: [string, (w: World) => string, (w: World) => string][] = [
    ['Time', (w) => `${w.time.toFixed(0)} s`, () => ''],
    ['Distance', (w) => `${(w.metrics.distance / 1000).toFixed(2)} km`, () => ''],
    ['Avg speed', (w) => `${(w.metrics.avgSpeed * MS_TO_KMH).toFixed(0)} km/h`, () => ''],
    ['Near misses', (w) => String(w.metrics.nearMisses), (w) => (w.metrics.nearMisses ? 'bad' : 'good')],
    ['Hard brakes', (w) => String(w.metrics.hardBrakes), (w) => (w.metrics.hardBrakes ? 'warn' : 'good')],
    ['Lane changes', (w) => String(w.metrics.laneChanges), () => ''],
    ['No signal', (w) => String(w.metrics.unsignalledChanges), (w) => (w.metrics.unsignalledChanges ? 'warn' : 'good')],
    ['Cut-offs', (w) => String(w.metrics.cutOffs), (w) => (w.metrics.cutOffs ? 'bad' : 'good')],
    ['Collisions', (w) => String(w.metrics.collisions), (w) => (w.metrics.collisions ? 'bad' : 'good')],
    ['Score', (w) => w.metrics.scores(w.status === 'crashed').overall.toFixed(0), () => ''],
  ];
  const tileEls = tileDefs.map(([label]) => {
    const b = h('b', {});
    const t = h('div', { class: 'tile' }, b, h('span', {}, label));
    tiles.append(t);
    return { t, b };
  });

  const tabs = [
    ['Ego rules', rulesTab], ['Traffic', trafficTab], ['Results', results],
  ] as const;
  const pane = h('div', { class: 'pane' });
  const tabBar = h('div', { class: 'tabs' });
  const showTab = (i: number) => {
    pane.replaceChildren(banner, tabs[i][1].el);
    [...tabBar.children].forEach((c, j) => c.classList.toggle('on', i === j));
  };
  tabs.forEach(([name], i) => tabBar.append(h('button', { on: { click: () => showTab(i) } }, name)));
  showTab(0);

  root.replaceChildren(header, h('main', {},
    h('div', { class: 'left' }, canvas, tiles),
    h('aside', {}, tabBar, pane)));

  new ResizeObserver(() => renderer.resize()).observe(canvas);
  renderer.resize();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.key === 'r') app.restart();
  });

  // -------------------------------------------------------------- loop
  let last = performance.now();
  let uiTimer = 0;
  const frame = (now: number) => {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      acc += dtReal * speed;
      let steps = 0;
      while (acc >= SIM_DT && steps < 40) {
        app.world.step(SIM_DT);
        acc -= SIM_DT;
        steps++;
      }
      if (steps >= 40) acc = 0;
      if (app.world.status !== 'running') { playing = false; status(); }
    }
    renderer.draw(app.world, { zoom, showSensors: sensors, showLabels: labels, alpha: Math.min(1, acc / SIM_DT), report: app.driver.report });

    uiTimer += dtReal;
    if (uiTimer > 0.2) {
      uiTimer = 0;
      refreshUi();
    }
    requestAnimationFrame(frame);
  };

  function refreshUi(): void {
    const w = app.world;
    tileDefs.forEach(([, val, cls], i) => {
      tileEls[i].b.textContent = val(w);
      tileEls[i].t.className = `tile ${cls(w)}`;
    });
    (document.getElementById('seedlabel') as HTMLElement).textContent = `seed ${w.cfg.seed} · ${w.vehicles.length} vehicles · ${w.road.lanes} lanes`;
    rulesTab.refresh(app);
    results.refresh(app);
  }

  // Expose for debugging / automated checks.
  (window as unknown as { __app: App }).__app = app;
  refreshUi();
  requestAnimationFrame(frame);
}

export type { Panel };
