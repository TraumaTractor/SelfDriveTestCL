import { describe, expect, it } from 'vitest';
import { EgoDriver } from '../src/ego/egoDriver';
import { RuleSet } from '../src/ego/rules';
import { PRESETS } from '../src/ego/presets';
import { runHeadless, SIM_DT } from '../src/sim/headless';
import { defaultConfig, World } from '../src/sim/world';
import { TrafficDriver } from '../src/drivers/trafficDriver';
import { PERSONALITIES } from '../src/drivers/personality';
import { Rng } from '../src/sim/rng';

function greatOnly() {
  const cfg = defaultConfig();
  cfg.mix = { great: 1, average: 0, cautious: 0, aggressive: 0, reckless: 0 };
  return cfg;
}

describe('simulation', () => {
  it('is deterministic for a given seed', () => {
    const cfg = defaultConfig();
    cfg.seed = 7;
    cfg.length = 2500;
    const a = runHeadless(cfg, new RuleSet());
    const b = runHeadless({ ...cfg }, new RuleSet());
    expect(a).toEqual(b);
  });

  it('different seeds give different scenarios', () => {
    const cfg = defaultConfig();
    cfg.length = 2500;
    const a = runHeadless({ ...cfg, seed: 1 }, new RuleSet());
    const b = runHeadless({ ...cfg, seed: 2 }, new RuleSet());
    expect(a.time).not.toEqual(b.time);
  });

  it('great drivers around a balanced ego do not crash', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const cfg = greatOnly();
      cfg.seed = seed;
      cfg.length = 3000;
      const r = runHeadless(cfg, new RuleSet());
      expect(r.status).toBe('finished');
      expect(r.collisions).toBe(0);
    }
  });

  it('great drivers never crash into each other', () => {
    const cfg = greatOnly();
    cfg.seed = 3;
    cfg.length = 3000;
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    while (w.status === 'running') w.step(SIM_DT);
    expect(w.trafficCollisions).toBe(0);
  });

  it('ego without any rules does not move (sanity) and times out', () => {
    const rules = new RuleSet();
    for (const i of rules.items) i.enabled = false;
    const cfg = defaultConfig();
    cfg.maxTime = 20;
    const r = runHeadless(cfg, rules);
    expect(r.status).not.toBe('finished');
  });

  it('presets all build and run', () => {
    for (const p of PRESETS) {
      const cfg = defaultConfig();
      cfg.length = 1800;
      const r = runHeadless(cfg, p.build());
      expect(['finished', 'crashed', 'timeout']).toContain(r.status);
    }
  });
});

describe('driver personalities', () => {
  it('a reckless-only road is clearly worse for the ego than a great-only road', () => {
    const mean = (id: 'great' | 'reckless') => {
      let total = 0;
      const n = 4;
      for (let seed = 1; seed <= n; seed++) {
        const cfg = defaultConfig();
        cfg.seed = seed;
        cfg.length = 3000;
        cfg.mix = { great: 0, average: 0, cautious: 0, aggressive: 0, reckless: 0, [id]: 1 };
        total += runHeadless(cfg, new RuleSet()).scores.overall;
      }
      return total / n;
    };
    expect(mean('great')).toBeGreaterThan(mean('reckless') + 10);
  });
});

describe('lane discipline', () => {
  function lonely(id: 'great' | 'reckless') {
    const cfg = defaultConfig();
    cfg.density = 0.5;
    cfg.rampRate = 0;
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    const p = PERSONALITIES[id];
    const v = {
      ...w.ego, id: 99, kind: 'traffic' as const, label: id, s: 600, prevS: 600, y: 2, prevY: 2, targetLane: 2, v: 30,
      driver: new TrafficDriver(p, new Rng(5)),
    };
    w.vehicles = [w.ego, v];
    Object.assign(w.ego, { s: 100, prevS: 100 });
    for (let i = 0; i < 20 * 40 && w.status === 'running'; i++) w.step(0.05);
    return v.targetLane;
  }

  it('a great driver on an empty road moves back to the slow (left) lane', () => {
    expect(lonely('great')).toBe(0);
  });
});

describe('rule set', () => {
  it('round-trips through JSON', () => {
    const s = new RuleSet();
    s.get('overtake')!.params.cooldown = 12;
    s.move('overtake', -2);
    const copy = RuleSet.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(copy.toJSON()).toEqual(s.toJSON());
  });

  it('ignores unknown rules and clamps values', () => {
    const s = RuleSet.fromJSON({ rules: [{ id: 'nope' }, { id: 'keep-speed', params: { speedFactor: 99 } }] });
    expect(s.get('keep-speed')!.params.speedFactor).toBeLessThanOrEqual(1.4);
    expect(s.items.length).toBe(new RuleSet().items.length);
  });
});
