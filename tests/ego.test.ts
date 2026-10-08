import { describe, expect, it } from 'vitest';
import { EgoDriver } from '../src/ego/egoDriver';
import { RuleSet } from '../src/ego/rules';
import { defaultConfig, World } from '../src/sim/world';
import type { Driver, Vehicle } from '../src/sim/vehicle';

const still: Driver = { decide: () => ({ accel: 0, wantLane: null, indicator: 0 }) };

function car(id: number, s: number, lane: number, v: number): Vehicle {
  return {
    id, kind: 'traffic', label: 'test', color: '#fff', s, y: lane, prevS: s, prevY: lane, v, a: 0,
    length: 4.5, width: 1.9, targetLane: lane, changing: false, indicator: 0, indicatorSince: 0, changeStart: 0,
    onRamp: false, crashed: false, crashTime: 0, idm: { a: 1.5, b: 2, T: 1.5, s0: 2 }, v0: v, driver: still,
  };
}

/** An empty 3-lane road with the ego at s=300, lane 1, 30 m/s plus the given extra cars. */
function scenario(rules: RuleSet, others: Vehicle[]) {
  const cfg = defaultConfig();
  cfg.density = 0.5;
  cfg.rampRate = 0;
  const driver = new EgoDriver(rules);
  const world = new World(cfg, driver);
  world.vehicles = [world.ego, ...others];
  Object.assign(world.ego, { s: 300, prevS: 300, y: 1, prevY: 1, targetLane: 1, v: 30 });
  return { world, driver };
}

describe('ego rule stack', () => {
  it('brakes for a stopped car ahead', () => {
    const { world, driver } = scenario(new RuleSet(), [car(50, 345, 1, 0)]);
    world.step(0.05);
    expect(driver.report.accel).toBeLessThan(-2);
    expect(['emergency-brake', 'keep-distance']).toContain(driver.report.accelBy);
  });

  it('without any braking rule the ego ploughs into the car', () => {
    const rules = new RuleSet();
    for (const id of ['emergency-brake', 'keep-distance', 'yield-to-merging']) rules.get(id)!.enabled = false;
    const { world } = scenario(rules, [car(50, 345, 1, 0)]);
    for (let i = 0; i < 100 && world.status === 'running'; i++) world.step(0.05);
    expect(world.status).toBe('crashed');
    expect(world.metrics.collisions).toBe(1);
  });

  it('overtakes a slow car, signalling first', () => {
    const { world } = scenario(new RuleSet(), [car(50, 360, 1, 15)]);
    for (let i = 0; i < 400; i++) world.step(0.05);
    expect(world.metrics.laneChanges).toBeGreaterThanOrEqual(1);
    expect(world.metrics.unsignalledChanges).toBe(0);
  });

  it('turning the signal rule off makes the ego change lane without signalling', () => {
    const rules = new RuleSet();
    rules.get('signal')!.enabled = false;
    const { world } = scenario(rules, [car(50, 360, 1, 15)]);
    for (let i = 0; i < 400; i++) world.step(0.05);
    expect(world.metrics.unsignalledChanges).toBeGreaterThanOrEqual(1);
  });

  it('safety filter vetoes an overtake into an occupied lane; disabling it does not', () => {
    const blockers = () => [car(50, 360, 1, 15), car(51, 296, 2, 30)]; // car alongside in the overtaking lane
    const safe = scenario(new RuleSet(), blockers());
    safe.world.step(0.05);
    expect(safe.driver.report.vetoBy).toBe('lane-change-safety');

    const rules = new RuleSet();
    rules.get('lane-change-safety')!.enabled = false;
    const unsafe = scenario(rules, blockers());
    unsafe.world.step(0.05);
    expect(unsafe.driver.report.vetoBy).toBeNull();
    expect(unsafe.driver.report.laneBy).toBe('overtake');
  });

  it('yields to a car signalling into the ego lane', () => {
    const merger = car(60, 330, 0, 25);
    merger.indicator = 1;
    const withRule = scenario(new RuleSet(), [merger]);
    withRule.world.ego.targetLane = 1;
    withRule.world.step(0.05);
    expect(withRule.driver.report.accelBy).toBe('yield-to-merging');

    const rules = new RuleSet();
    rules.get('yield-to-merging')!.enabled = false;
    const without = scenario(rules, [{ ...merger }]);
    without.world.step(0.05);
    expect(without.driver.report.accelBy).not.toBe('yield-to-merging');
  });

  it('moves over for a car on the on-ramp beside it', () => {
    const ramp = car(70, 310, -1, 25);
    ramp.onRamp = true;
    const { world, driver } = scenario(new RuleSet(), [ramp]);
    Object.assign(world.ego, { y: 0, prevY: 0, targetLane: 0 });
    world.step(0.05);
    expect(driver.report.laneBy).toBe('make-room');
  });

  it('reordering rules changes their evaluation order', () => {
    const rules = new RuleSet();
    const before = rules.items.findIndex((i) => i.id === 'overtake');
    rules.move('overtake', -1);
    expect(rules.items.findIndex((i) => i.id === 'overtake')).toBe(before - 1);
  });
});
