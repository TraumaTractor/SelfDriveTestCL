import { describe, expect, it, beforeEach } from 'vitest';
import { EgoDriver } from '../src/ego/egoDriver';
import { RuleSet } from '../src/ego/rules';
import { Recorder, Replayer } from '../src/replay';
import { SIM_DT } from '../src/sim/headless';
import { World, defaultConfig } from '../src/sim/world';
import { DEFAULTS, getSettings, loadSettings, updateSettings } from '../src/settings';

function run(seconds: number, seed = 3) {
  const driver = new EgoDriver(new RuleSet());
  const w = new World({ ...defaultConfig(), seed, endless: false, laps: 1 }, driver);
  const rec = new Recorder(60);
  for (let i = 0; i < seconds / SIM_DT; i++) { w.step(SIM_DT); rec.record(w, driver.report); }
  return { w, rec };
}

describe('replay', () => {
  it('records at 10 Hz and keeps only the configured window', () => {
    const { rec } = run(90);
    expect(rec.end - rec.start).toBeLessThanOrEqual(60.2);
    expect(rec.end).toBeGreaterThan(85);
    expect(rec.contains(rec.end - 1)).toBe(true);
    expect(rec.contains(rec.start - 5)).toBe(false);
  });

  it('round-trips vehicle state through a frame', () => {
    const { w, rec } = run(20);
    const rp = new Replayer(w);
    const s = rec.sample(rec.end)!;
    rp.show(s.a, s.b, s.alpha);
    expect(rp.world.vehicles.length).toBe(w.vehicles.length);
    expect(rp.world.ego.s).toBeCloseTo(w.ego.s, 1);
    expect(rp.world.ego.kind).toBe('ego');
    const orig = new Map(w.vehicles.map((v) => [v.id, v]));
    for (const v of rp.world.vehicles) {
      const o = orig.get(v.id)!;
      expect(v.type).toBe(o.type);
      expect(v.label).toBe(o.label);
      expect(v.v).toBeCloseTo(o.v, 1);
    }
  });

  it('samples between frames and steps by frame', () => {
    const { rec } = run(10);
    const mid = rec.sample(5.05)!;
    expect(mid.a.t).toBeLessThanOrEqual(5.05);
    expect(mid.b.t).toBeGreaterThanOrEqual(5.05);
    expect(rec.stepFrom(5, 1)).toBeCloseTo(5.1, 5);
    expect(rec.stepFrom(5, -10)).toBeCloseTo(4, 5);
    expect(rec.stepFrom(0, -3)).toBe(rec.start);
  });

  it('stamps events with an increasing sequence number', () => {
    const { w } = run(60);
    const seqs = w.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe('settings', () => {
  beforeEach(() => { (globalThis as unknown as { localStorage?: unknown }).localStorage = undefined; });
  it('sanitises bad values back to defaults', () => {
    loadSettings();
    updateSettings({ replaySeconds: 7, sound: { ...DEFAULTS.sound, volume: 9 }, autoPause: { ...DEFAULTS.autoPause, nearmiss: 'yes' as unknown as boolean } });
    const s = getSettings();
    expect(s.replaySeconds).toBe(DEFAULTS.replaySeconds);
    expect(s.sound.volume).toBe(DEFAULTS.sound.volume);
    expect(s.autoPause.nearmiss).toBe(DEFAULTS.autoPause.nearmiss);
    expect(s.sound.on).toBe(false);
  });
});
