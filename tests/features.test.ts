import { afterEach, describe, expect, it } from 'vitest';
import { EgoDriver } from '../src/ego/egoDriver';
import { RuleSet } from '../src/ego/rules';
import { resolveTheme } from '../src/theme';
import * as U from '../src/units';
import { VEHICLE_SPECS, VEHICLE_TYPES } from '../src/sim/vehicle';
import { defaultConfig, World } from '../src/sim/world';

afterEach(() => U.setUnits('metric'));

describe('units', () => {
  it('shows metric by default and imperial on request', () => {
    expect(U.speed(27.78)).toBe('100 km/h');
    expect(U.dist(59.4)).toBe('59 m');
    expect(U.longDist(6000)).toBe('6.0 km');
    U.setUnits('imperial');
    expect(U.speed(26.8224)).toBe('60 mph');
    expect(U.dist(100)).toBe('328 ft');
    expect(U.longDist(1609.344, 2)).toBe('1.00 mi');
    expect(U.accel(-1.5, true)).toMatch(/^−4\.9 ft\/s²$/);
    expect(U.force(-3)).toBe('−674 lbf');
    expect(U.speedDelta(5)).toBe('+11 mph');
  });

  it('converts slider read-outs but never the stored SI values', () => {
    expect(U.convertForDisplay(10, 'm/s').unit).toBe('km/h');
    U.setUnits('imperial');
    const c = U.convertForDisplay(10, 'm/s');
    expect(c.unit).toBe('mph');
    expect(c.value).toBeCloseTo(22.37, 1);
    expect(U.convertForDisplay(100, 'm').unit).toBe('ft');
    expect(U.convertForDisplay(6000, 'long-m')).toMatchObject({ unit: 'mi' });
    expect(U.convertForDisplay(5, 's').unit).toBe('s'); // unchanged
  });

  it('notifies listeners when the system changes', () => {
    let n = 0;
    const off = U.onUnitsChange(() => n++);
    U.setUnits('imperial');
    U.setUnits('imperial'); // no change, no event
    U.setUnits('metric');
    off();
    U.setUnits('imperial');
    expect(n).toBe(2);
  });

  it('explanations from the car follow the chosen units', () => {
    U.setUnits('imperial');
    const cfg = defaultConfig();
    cfg.endless = false;
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    for (let i = 0; i < 40; i++) w.step(0.05);
    const text = JSON.stringify(w.ego.driver && (w.ego.driver as EgoDriver).report.accelProposals);
    expect(text).toMatch(/mph/);
    expect(text).not.toMatch(/km\/h/);
  });
});

describe('theme', () => {
  it('resolves auto from the system preference', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('vehicle types', () => {
  it('has sensible specs', () => {
    expect(VEHICLE_SPECS.lorry.length).toBeGreaterThan(VEHICLE_SPECS.van.length);
    expect(VEHICLE_SPECS.motorcycle.width).toBeLessThan(1);
    expect(VEHICLE_SPECS.lorry.maxSpeed).toBeLessThan(VEHICLE_SPECS.car.maxSpeed);
    expect(VEHICLE_TYPES).toHaveLength(5);
  });

  it('spawns every kind, and keeps lorries and coaches out of the fastest lane', () => {
    const cfg = defaultConfig();
    cfg.endless = false;
    cfg.seed = 4;
    cfg.vehicleMix = { car: 1, van: 1, lorry: 3, motorcycle: 1, coach: 2 };
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    const seen = new Set<string>();
    let heavyInTopLane = 0;
    let heavyTopSamples = 0;
    for (let i = 0; i < 20 * 150; i++) {
      w.step(0.05);
      for (const v of w.vehicles) {
        seen.add(v.type);
        if (v.kind === 'traffic' && VEHICLE_SPECS[v.type].heavy && !v.crashed) {
          heavyTopSamples++;
          if (v.targetLane > cfg.lanes - 2) heavyInTopLane++;
          expect(v.v).toBeLessThan(VEHICLE_SPECS[v.type].maxSpeed + 1);
        }
      }
    }
    for (const t of VEHICLE_TYPES) expect(seen.has(t)).toBe(true);
    expect(heavyTopSamples).toBeGreaterThan(50);
    expect(heavyInTopLane).toBe(0);
  });

  it('a lorry takes far longer to speed up than a motorcycle', () => {
    expect(VEHICLE_SPECS.motorcycle.accelScale / VEHICLE_SPECS.lorry.accelScale).toBeGreaterThan(3);
  });
});

describe('weather', () => {
  it('rain, fog and snow reduce grip and visibility monotonically', async () => {
    const { conditionsFor, stoppingSightSpeed } = await import('../src/sim/weather');
    for (const k of ['rain', 'fog', 'snow'] as const) {
      const a = conditionsFor(k, 0.3), b = conditionsFor(k, 1);
      expect(b.grip).toBeLessThan(a.grip);
      expect(b.visibility).toBeLessThan(a.visibility);
      expect(b.speedFactor).toBeLessThan(a.speedFactor);
    }
    expect(conditionsFor('snow', 1).grip).toBeLessThan(conditionsFor('rain', 1).grip);
    expect(conditionsFor('fog', 1).visibility).toBeLessThan(conditionsFor('rain', 1).visibility);
    expect(stoppingSightSpeed(40, 3)).toBeLessThan(stoppingSightSpeed(200, 3));
  });

  it('tyre grip limits how hard anything can brake', () => {
    const decelIn = (kind: 'clear' | 'snow') => {
      const cfg = defaultConfig();
      cfg.endless = false;
      cfg.density = 0.5;
      cfg.weather = { kind, intensity: 1 };
      const stamp = { decide: () => ({ accel: -9, wantLane: null, indicator: 0 as const }) };
      const w = new World(cfg, stamp);
      w.vehicles = [w.ego];
      w.ego.v = 30;
      w.step(0.05);
      return -w.ego.a;
    };
    expect(decelIn('clear')).toBeCloseTo(9, 0);
    expect(decelIn('snow')).toBeLessThan(4);
  });

  it('careful drivers slow down in fog, so traffic is slower than on a clear road', () => {
    const meanSpeed = (weather: { kind: 'clear' | 'fog'; intensity: number }) => {
      const cfg = defaultConfig();
      cfg.endless = false;
      cfg.seed = 6;
      cfg.mix = { great: 1, average: 0, cautious: 0, aggressive: 0, reckless: 0 };
      cfg.weather = weather;
      const w = new World(cfg, new EgoDriver(new RuleSet()));
      let sum = 0, n = 0;
      for (let i = 0; i < 20 * 80; i++) {
        w.step(0.05);
        if (i > 20 * 30) for (const v of w.vehicles) if (v.kind === 'traffic' && !v.crashed) { sum += v.v; n++; }
      }
      return sum / n;
    };
    expect(meanSpeed({ kind: 'fog', intensity: 1 })).toBeLessThan(meanSpeed({ kind: 'clear', intensity: 0 }) * 0.8);
  });

  it('variable weather drifts through different kinds without changing the road', () => {
    const base = defaultConfig();
    base.endless = false;
    base.seed = 9;
    const still = new World({ ...base }, new EgoDriver(new RuleSet()));
    const cfg = { ...base, weather: { kind: 'variable' as const, intensity: 0.5 } };
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    expect(w.road.ramps).toEqual(still.road.ramps);
    expect(w.vehicles.length).toBe(still.vehicles.length);
    const kinds = new Set<string>();
    for (let i = 0; i < 20 * 900; i++) {
      w.step(0.05);
      kinds.add(w.conditions.kind);
      if (w.status !== 'running') break;
    }
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('the ego car in fog: ignoring the weather is worse than adapting to it', () => {
    const run = (adapt: boolean) => {
      let bad = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const cfg = defaultConfig();
        cfg.endless = false;
        cfg.seed = seed;
        cfg.length = 3500;
        cfg.weather = { kind: 'snow', intensity: 1 };
        const rules = new RuleSet();
        rules.get('weather-adapt')!.enabled = adapt;
        const w = new World(cfg, new EgoDriver(rules));
        while (w.status === 'running') w.step(0.05);
        bad += w.metrics.collisions * 10 + w.metrics.nearMisses + w.metrics.hardBrakes * 0.2;
      }
      return bad;
    };
    expect(run(false)).toBeGreaterThanOrEqual(run(true));
  });
});

const still = { decide: () => ({ accel: 0, wantLane: null, indicator: 0 as const }) };

describe('road hazards', () => {
  function hazardWorld(rules: RuleSet, kinds: { breakdowns?: boolean; debris?: boolean; roadworks?: boolean }, seed = 3) {
    const cfg = defaultConfig();
    cfg.endless = false;
    cfg.seed = seed;
    cfg.hazards = { rate: 2, breakdowns: false, debris: false, roadworks: false, ...kinds };
    return new World(cfg, new EgoDriver(rules));
  }

  it('places hazards ahead of the ego and announces them', () => {
    const w = hazardWorld(new RuleSet(), { breakdowns: true, debris: true, roadworks: true });
    for (let i = 0; i < 20 * 120; i++) w.step(0.05);
    expect(w.hazards.length).toBeGreaterThan(0);
    expect(w.vehicles.some((v) => v.isStatic)).toBe(true);
    expect(w.events.some((e) => e.kind === 'hazard')).toBe(true);
  });

  it('roadworks close a lane: a barrier, a reduced limit, and nobody changes into it', () => {
    const w = hazardWorld(new RuleSet(), { roadworks: true }, 5);
    let closedSeen = 0;
    for (let i = 0; i < 20 * 200 && w.status === 'running'; i++) {
      w.step(0.05);
      for (const wk of w.works) {
        closedSeen++;
        expect(w.limitAt(wk.start + 50)).toBeLessThan(25);
        if (w.ego.s < wk.start + 400) expect(w.vehicles.some((v) => v.type === 'barrier' && Math.abs(v.s - wk.start) < 1)).toBe(true);
        // no ordinary vehicle drives inside the closed section
        for (const v of w.vehicles) {
          if (!v.isStatic && v.s > wk.start + 5 && v.s < wk.end && Math.abs(v.y - wk.lane) < 0.3) throw new Error('vehicle inside a closed lane');
        }
      }
    }
    expect(closedSeen).toBeGreaterThan(0);
  });

  it('a static obstacle is not removed by a collision: only the vehicle that hit it crashes', () => {
    const cfg = defaultConfig();
    cfg.endless = false;
    cfg.density = 0.5;
    cfg.hazards = { rate: 0, breakdowns: false, debris: false, roadworks: false };
    const rules = new RuleSet();
    for (const i of rules.items) i.enabled = i.id === 'keep-speed'; // a car that simply drives on
    const w = new World(cfg, new EgoDriver(rules));
    const debris = { ...w.ego, id: 77, kind: 'traffic' as const, type: 'debris' as const, label: 'hazard', length: 0.9, width: 0.9, isStatic: true, s: 400, prevS: 400, y: 1, prevY: 1, targetLane: 1, v: 0, a: 0, driver: still };
    w.vehicles = [w.ego, debris];
    w.ego.v = 28;
    for (let i = 0; i < 20 * 10 && w.status === 'running'; i++) w.step(0.05);
    expect(w.status).toBe('crashed');
    expect(w.ego.crashed).toBe(true);
    expect(debris.crashed).toBe(false);
    expect(w.events.some((e) => /Ego hit debris/.test(e.text))).toBe(true);
  });

  it('with the avoid-obstacle rule the car moves over early instead of braking hard', () => {
    const run = (avoid: boolean) => {
      const cfg = defaultConfig();
      cfg.endless = false;
      cfg.density = 0.5;
      cfg.hazards = { rate: 0, breakdowns: false, debris: false, roadworks: false };
      const rules = new RuleSet();
      rules.get('avoid-obstacle')!.enabled = avoid;
      rules.get('overtake')!.enabled = false;
      rules.get('return-slow-lane')!.enabled = false;
      const w = new World(cfg, new EgoDriver(rules));
      const stopped = { ...w.ego, id: 78, kind: 'traffic' as const, type: 'car' as const, label: 'hazard', isStatic: true, hazard: true, s: 900, prevS: 900, y: 1, prevY: 1, targetLane: 1, v: 0, a: 0, driver: still };
      w.vehicles = [w.ego, stopped];
      w.ego.v = 30;
      let minSpeed = 99, minA = 0;
      for (let i = 0; i < 20 * 40 && w.status === 'running'; i++) {
        w.step(0.05);
        if (w.ego.s < 900) { minSpeed = Math.min(minSpeed, w.ego.v); minA = Math.min(minA, w.ego.a); }
        if (w.ego.s > 960) break;
      }
      return { status: w.status, minSpeed, minA, lane: w.ego.targetLane };
    };
    const withRule = run(true);
    expect(withRule.status).toBe('running');
    expect(withRule.lane).not.toBe(1);
    expect(withRule.minSpeed).toBeGreaterThan(20); // never had to slow much
    const without = run(false);
    expect(without.minSpeed).toBeLessThan(withRule.minSpeed);
  });
});
