import { EgoDriver } from '../ego/egoDriver';
import { RuleSet } from '../ego/rules';
import { Dashcam } from '../render/dashcam';
import { Renderer } from '../render/renderer';
import { SIM_DT } from '../sim/headless';
import { World, defaultConfig, type WorldConfig } from '../sim/world';
import { h } from './dom';
import { decisionsPanel } from './decisionsPanel';
import { loadSettings, getSettings, onSettingsChange, updateSettings } from '../settings';
import { Recorder, Replayer, snapshotMetrics, type MetricSnap } from '../replay';
import { Sound } from '../audio';
import { replayBar } from './replayBar';
import { createInspector } from './inspector';
import { createLegend } from './legend';
import { showSettings } from './settingsPanel';
import { maybeShowWhatsNew, showWhatsNewNow } from './whatsNew';
import { resultsPanel, setStale } from './resultsPanel';
import { rulesPanel } from './rulesPanel';
import type { App, Panel } from './state';
import { trafficPanel } from './trafficPanel';
import './style.css';
import * as U from '../units';

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
  loadSettings(); // theme + units, before anything is drawn
  const saved = load();
  const cfg: WorldConfig = { ...defaultConfig(), ...(saved.cfg ?? {}) };
  cfg.mix = { ...defaultConfig().mix, ...(saved.cfg?.mix ?? {}) };
  cfg.vehicleMix = { ...defaultConfig().vehicleMix, ...(saved.cfg?.vehicleMix ?? {}) };
  cfg.weather = { ...defaultConfig().weather, ...(saved.cfg?.weather ?? {}) };
  cfg.hazards = { ...defaultConfig().hazards, ...(saved.cfg?.hazards ?? {}) };
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
      resetReplay();
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
    replayTo(t) {
      if (!recorder.length) return false;
      if (t < recorder.start) {
        if (t < recorder.start - 5) { showToast('That moment is older than the replay buffer (see Settings → Replay buffer).'); return false; }
        t = recorder.start;
      }
      enterReplay(Math.max(recorder.start, t - 3));
      return true;
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
  const dashCanvas = h('canvas', { class: 'dash', title: 'Driver dashcam - click to enlarge / shrink' });
  const dashcam = new Dashcam(dashCanvas);
  type View = 'top' | 'pip' | 'dash';
  let view: View = 'pip';
  const toastEl = h('div', { class: 'toast' });
  toastEl.hidden = true;
  const inspector = createInspector({
    onFollow: (id) => { focusId = id; },
    onClose: () => { /* selection cleared by hide() */ },
    isFollowing: (id) => focusId === id,
  });
  const legend = createLegend();
  const stage = h('div', { class: 'stage', 'data-view': view }, canvas, dashCanvas, legend.el, inspector.el, toastEl);
  const setView = (v: View) => {
    view = v;
    stage.setAttribute('data-view', v);
    viewSel.value = v;
    requestAnimationFrame(() => { renderer.resize(); dashcam.resize(); });
  };
  dashCanvas.addEventListener('click', () => setView(view === 'pip' ? 'dash' : 'pip'));
  const rulesTab = rulesPanel(app);
  const trafficTab = trafficPanel(app);
  const decisionsTab = decisionsPanel(app);
  const results = resultsPanel(app);
  let playing = true;
  let speed = 1;
  let zoom = 9;
  let sensors = true;
  let labels = false;
  let acc = 0;
  let focusId: number | null = null;
  const sound = new Sound();
  sound.configure(getSettings().sound);

  // ----- recording, replay, events
  const recorder = new Recorder(getSettings().replaySeconds);
  let replayer = new Replayer(app.world);
  let mode: 'live' | 'replay' = 'live';
  let replayT = 0;
  let replayPlaying = false;
  let replaySpeed = 1;
  let lastSeq = app.world.eventSeq;
  let lastEmergencies = 0;
  let toastTimer = 0;

  function showToast(text: string, ...actions: [string, () => void][]): void {
    toastEl.replaceChildren(h('span', {}, text), ...actions.map(([label, fn]) => h('button', { class: 'small', on: { click: () => { hideToast(); fn(); } } }, label)));
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    if (!actions.length) toastTimer = window.setTimeout(hideToast, 4000);
  }
  function hideToast(): void { toastEl.hidden = true; clearTimeout(toastTimer); }

  function resetReplay(): void {
    recorder.seconds = getSettings().replaySeconds;
    recorder.clear();
    replayer = new Replayer(app.world);
    mode = 'live';
    replayPlaying = false;
    lastSeq = app.world.eventSeq;
    lastEmergencies = 0;
    focusId = null;
    inspector.hide();
    hideToast();
    recorder.record(app.world, app.driver.report, true);
  }
  function enterReplay(t: number): void {
    if (!recorder.length) return;
    hideToast();
    mode = 'replay';
    replayT = Math.max(recorder.start, Math.min(recorder.end, t));
    replayPlaying = false;
    status();
    refreshUi();
  }
  function goLive(): void {
    mode = 'live';
    replayPlaying = false;
    status();
    refreshUi();
  }
  const AUTO_LABEL: Record<string, string> = { nearmiss: 'Near miss', collision: 'Collision', hardbrake: 'Hard brake', cutoff: 'Cut-off' };
  const CUES: Record<string, Parameters<Sound['play']>[0]> = { nearmiss: 'nearmiss', hardbrake: 'hardbrake', cutoff: 'horn', collision: 'collision', hazard: 'hazard', lanechange: 'lane' };

  /** Advance the live sim one tick, record it, and react to anything that just happened. Returns true if it auto-paused. */
  function stepLive(): boolean {
    const w = app.world;
    w.step(SIM_DT);
    recorder.record(w, app.driver.report, w.status !== 'running');
    sound.update(w.time, w.ego.indicator !== 0);
    let pauseFor: string | null = null;
    for (const e of w.events) {
      if (e.seq < lastSeq) continue;
      lastSeq = e.seq + 1;
      const cue = CUES[e.kind];
      if (cue) sound.play(cue);
      const ap = getSettings().autoPause as unknown as Record<string, boolean>;
      if (!pauseFor && ap[e.kind] && AUTO_LABEL[e.kind]) pauseFor = `${AUTO_LABEL[e.kind]}: ${e.text}`;
    }
    const em = app.driver.log.counts.emergencies;
    if (em > lastEmergencies) {
      lastEmergencies = em;
      sound.play('emergency');
      if (!pauseFor && getSettings().autoPause.emergency) pauseFor = 'Emergency brake';
    }
    if (pauseFor) {
      playing = false;
      status();
      sound.play('pause');
      const t = w.time;
      showToast(`⏸ ${pauseFor}`, ['Replay last 5 s', () => app.replayTo(Math.max(recorder.start, t - 2))], ['Continue', () => { playing = true; status(); }]);
      return true;
    }
    return false;
  }

  const bar = replayBar({
    onSeek: (t) => { if (t >= recorder.end - 0.05) goLive(); else enterReplay(t); },
    onPlayToggle: () => togglePlayback(),
    onLive: () => goLive(),
    onStep: (n) => { if (mode === 'live') enterReplay(recorder.stepFrom(recorder.end, n)); else enterReplay(recorder.stepFrom(replayT, n)); },
    onBack: (s) => enterReplay((mode === 'live' ? recorder.end : replayT) - s),
    onSpeed: (x) => { replaySpeed = x; },
  });

  const playBtn = h('button', { class: 'primary', on: { click: () => toggle() } }, '⏸ Pause');
  const toggle = () => {
    if (mode === 'replay') { togglePlayback(); return; }
    playing = !playing;
    status();
  };
  function togglePlayback(): void {
    if (mode === 'live') { enterReplay(recorder.end - 5); replayPlaying = true; status(); return; }
    if (!replayPlaying && replayT >= recorder.end - 0.05) replayT = recorder.start;
    replayPlaying = !replayPlaying;
    status();
  }
  const status = () => { playBtn.textContent = mode === 'replay' ? (replayPlaying ? '⏸ Pause replay' : '▶ Play replay') : playing ? '⏸ Pause' : '▶ Play'; };
  const banner = h('div', { class: 'banner' }, 'Traffic/road settings changed. ',
    h('button', { class: 'small', on: { click: () => { banner.hidden = true; app.restart(); } } }, 'Restart to apply'));
  banner.hidden = true;

  const speedSel = h('select', { on: { change: () => { speed = Number(speedSel.value); } } },
    ...[0.25, 0.5, 1, 2, 4, 8].map((s) => h('option', { value: String(s), selected: s === 1 }, `${s}×`)));
  const viewSel = h('select', { on: { change: () => setView(viewSel.value as View) } },
    h('option', { value: 'top' }, 'Top-down'), h('option', { value: 'pip', selected: true }, 'Top-down + dashcam'), h('option', { value: 'dash' }, 'Dashcam'));
  const zoomIn = h('input', { type: 'range', min: '3', max: '16', step: '0.5', value: String(zoom), style: 'width:90px',
    on: { input: () => { zoom = Number(zoomIn.value); } } });
  const chk = (label: string, init: boolean, fn: (v: boolean) => void) => {
    const i = h('input', { type: 'checkbox', checked: init, on: { change: () => fn(i.checked) } });
    return h('label', { class: 'chk' }, i, label);
  };

  const soundBtn = h('button', { title: 'Sound cues on / off', on: { click: () => updateSettings({ sound: { ...getSettings().sound, on: !getSettings().sound.on } }) } });
  const applySettings = () => {
    const s = getSettings();
    soundBtn.textContent = s.sound.on ? '🔊' : '🔇';
    sound.configure(s.sound);
    legend.el.hidden = !s.legend;
    recorder.seconds = s.replaySeconds;
    if (!s.sound.on) sound.weather(null);
  };
  onSettingsChange(applySettings);
  applySettings();

  const header = h('header', { class: 'bar' },
    h('h1', {}, 'SELF-DRIVE ', h('span', {}, 'TEST BENCH')),
    playBtn,
    h('button', { title: 'Advance one tick', on: { click: () => { playing = false; status(); if (mode === 'replay') goLive(); stepLive(); } } }, '⏭ Step'),
    h('button', { on: { click: () => app.restart() } }, '↻ Restart'),
    h('label', { class: 'chk' }, 'View', viewSel),
    h('label', { class: 'chk' }, 'Speed', speedSel),
    h('label', { class: 'chk' }, 'Zoom', zoomIn),
    chk('Sensors', sensors, (v) => (sensors = v)),
    chk('Driver labels', labels, (v) => (labels = v)),
    h('span', { class: 'spacer' }),
    soundBtn,
    h('button', { title: 'Settings: theme, units, sound, auto-pause, updates', on: { click: () => showSettings(__APP_VERSION__) } }, '⚙ Settings'),
    h('span', { id: 'seedlabel', class: 'chk' }, ''));

  const tiles = h('div', { class: 'tiles' });
  const tileDefs: [string, (m: MetricSnap) => string, (m: MetricSnap) => string][] = [
    ['Lap', (m) => `${m.lap + 1}${app.world.cfg.endless ? '' : '/' + Math.max(1, app.world.cfg.laps)}`, () => ''],
    ['Time', (m) => `${m.time.toFixed(0)} s`, () => ''],
    ['Distance', (m) => U.longDist(m.distance, 2), () => ''],
    ['Avg speed', (m) => U.speed(m.avgSpeed), () => ''],
    ['Near misses', (m) => String(m.nearMisses), (m) => (m.nearMisses ? 'bad' : 'good')],
    ['Hard brakes', (m) => String(m.hardBrakes), (m) => (m.hardBrakes ? 'warn' : 'good')],
    ['Lane changes', (m) => String(m.laneChanges), () => ''],
    ['No signal', (m) => String(m.unsignalled), (m) => (m.unsignalled ? 'warn' : 'good')],
    ['Cut-offs', (m) => String(m.cutOffs), (m) => (m.cutOffs ? 'bad' : 'good')],
    ['Collisions', (m) => String(m.collisions), (m) => (m.collisions ? 'bad' : 'good')],
    ['Score', (m) => m.score.toFixed(0), () => ''],
  ];
  const tileEls = tileDefs.map(([label]) => {
    const b = h('b', {});
    const t = h('div', { class: 'tile' }, b, h('span', {}, label));
    tiles.append(t);
    return { t, b };
  });

  const tabs = [
    ['Ego rules', rulesTab], ['Decisions', decisionsTab], ['Traffic', trafficTab], ['Results', results],
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
    h('div', { class: 'left' }, stage, bar.el, tiles),
    h('aside', {}, tabBar, pane)),
    h('div', { class: 'version', title: "What's new", on: { click: () => showWhatsNewNow(__APP_VERSION__) } }, `v${__APP_VERSION__}`));

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const v = renderer.pick(e.clientX - r.left, e.clientY - r.top);
    if (v) { inspector.show(v.id); inspector.refresh(shownWorld()); } else { inspector.hide(); }
  });
  new ResizeObserver(() => renderer.resize()).observe(canvas);
  new ResizeObserver(() => dashcam.resize()).observe(dashCanvas);
  renderer.resize();
  dashcam.resize();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.key === 'r') app.restart();
    if (e.key === 'l' || e.key === 'L') goLive();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const n = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
      if (mode === 'live') { if (n < 0) enterReplay(recorder.stepFrom(recorder.end, n)); } else enterReplay(recorder.stepFrom(replayT, n));
    }
    if (e.key === 'Escape') { inspector.hide(); focusId = null; }
  });

  // -------------------------------------------------------------- loop
  const shownWorld = () => (mode === 'replay' ? replayer.world : app.world);
  let last = performance.now();
  let uiTimer = 0;
  const frame = (now: number) => {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    let alpha = 0;
    let report = app.driver.report;
    if (mode === 'replay') {
      if (replayPlaying) {
        replayT += dtReal * replaySpeed;
        if (replayT >= recorder.end) { replayT = recorder.end; replayPlaying = false; status(); }
      }
      const smp = recorder.sample(replayT);
      if (smp) {
        alpha = replayer.show(smp.a, smp.b, smp.alpha);
        report = smp.b.report ?? report;
      }
    } else if (playing) {
      acc += dtReal * speed;
      let steps = 0;
      while (acc >= SIM_DT && steps < 40) {
        const paused = stepLive();
        acc -= SIM_DT;
        steps++;
        if (paused || app.world.status !== 'running') break;
      }
      if (steps >= 40) acc = 0;
      if (app.world.status !== 'running') { playing = false; status(); }
      alpha = Math.min(1, acc / SIM_DT);
    }
    const w = shownWorld();
    const selectedId = inspector.id;
    if (view !== 'dash') renderer.draw(w, { zoom, showSensors: sensors && mode === 'live', showLabels: labels, alpha, report, sensorRange: app.rules.get('keep-distance')?.params.range ?? 150, focusId, selectedId });
    if (view !== 'top') dashcam.draw(w, { alpha, report });
    if (mode === 'live') sound.weather(playing ? w.conditions : null); else sound.weather(null);

    uiTimer += dtReal;
    if (uiTimer > 0.2 || mode === 'replay') {
      uiTimer = mode === 'replay' ? uiTimer : 0;
      if (mode === 'replay' && uiTimer > 0.2) uiTimer = 0;
      refreshUi();
    }
    requestAnimationFrame(frame);
  };

  function refreshUi(): void {
    const w = app.world;
    const snap = mode === 'replay' ? (recorder.sample(replayT)?.b.m ?? snapshotMetrics(w)) : snapshotMetrics(w);
    tileDefs.forEach(([, val, cls], i) => {
      tileEls[i].b.textContent = val(snap);
      tileEls[i].t.className = `tile ${cls(snap)}`;
    });
    (document.getElementById('seedlabel') as HTMLElement).textContent = `seed ${w.cfg.seed} · ${w.vehicles.length} vehicles · ${w.road.lanes} lanes`;
    bar.update({ live: mode === 'live', playing: replayPlaying, t: replayT, start: recorder.start, end: recorder.end, events: w.events });
    legend.refresh(shownWorld());
    inspector.refresh(shownWorld());
    rulesTab.refresh(app);
    decisionsTab.refresh(app);
    results.refresh(app);
  }

  // Expose for debugging / automated checks.
  (window as unknown as { __app: App }).__app = app;
  resetReplay();
  refreshUi();
  requestAnimationFrame(frame);
  maybeShowWhatsNew(__APP_VERSION__);
}

export type { Panel };
