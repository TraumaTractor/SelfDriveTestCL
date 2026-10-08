import { describe, expect, it } from 'vitest';
import { EgoDriver } from '../src/ego/egoDriver';
import { RuleSet } from '../src/ego/rules';
import { defaultConfig, World } from '../src/sim/world';
import type { Driver, Vehicle } from '../src/sim/vehicle';

const still: Driver = { decide: () => ({ accel: 0, wantLane: null, indicator: 0 }) };

function car(id: number, s: number, lane: number, v: number): Vehicle {
  return {
    id, kind: 'traffic', type: 'car', label: 'test', color: '#fff', s, y: lane, prevS: s, prevY: lane, v, a: 0,
    length: 4.5, width: 1.9, targetLane: lane, changing: false, indicator: 0, indicatorSince: 0, changeStart: 0,
    onRamp: false, crashed: false, crashTime: 0, isStatic: false, hazard: false, idm: { a: 1.5, b: 2, T: 1.5, s0: 2 }, v0: v, driver: still,
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

  it('judges a lane change by impact on the driver behind, not just distance', () => {
    const setup = (follower: Vehicle) => {
      const sc = scenario(new RuleSet(), [car(50, 345, 1, 12), follower]);
      sc.world.ego.v = 25;
      sc.world.step(0.05);
      return sc.driver.report;
    };
    // fast car 30 m back in the target lane: a "safe" distance, but it would have to brake hard
    const fast = setup(car(51, 269, 2, 35));
    expect(fast.vetoBy).toBe('lane-change-safety');
    expect(fast.check?.impact?.imposedDecel).toBeGreaterThan(1);

    // crawling car only ~3 m back: much closer, but it is barely affected
    const crawling = setup(car(52, 292, 2, 3));
    expect(crawling.vetoBy).toBeNull();
    expect(crawling.laneBy).toBe('overtake');
    expect(crawling.check?.impact?.imposedDecel).toBeLessThan(0.5);
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

  it('does not overtake a car that is not slowing it down, but moves over early for one that is', () => {
    const same = scenario(new RuleSet(), [car(50, 345, 1, 32)]);
    same.world.step(0.05);
    expect(same.driver.report.laneProposals.some((p) => p.by === 'overtake')).toBe(false);

    // 15 m/s car still 140 m ahead: it will affect us, so the ego already plans to move over (before
    // it has to slow down) once inside its reach; a car further back just gets a note.
    const far = scenario(new RuleSet(), [car(50, 540, 1, 15)]);
    far.world.step(0.05);
    expect(far.driver.report.laneProposals.some((p) => p.by === 'overtake')).toBe(false);
    expect(far.driver.report.notes.some((n) => n.by === 'overtake')).toBe(true);

    const near = scenario(new RuleSet(), [car(51, 490, 1, 15)]);
    near.world.step(0.05);
    expect(near.driver.report.laneBy).toBe('overtake');
    expect(near.driver.report.accel).toBeGreaterThan(-0.5); // moving over, not braking
  });

  it('does not undertake: holds back past slower traffic on its right', () => {
    const slowRight = () => [car(60, 340, 2, 20)];
    const on = scenario(new RuleSet(), slowRight());
    on.world.step(0.05);
    expect(on.driver.report.accelBy).toBe('no-undertake');

    const rules = new RuleSet();
    rules.get('no-undertake')!.enabled = false;
    const off = scenario(rules, slowRight());
    off.world.step(0.05);
    expect(off.driver.report.accelBy).not.toBe('no-undertake');

    // slow-moving queue: undertaking tolerated
    const queue = scenario(new RuleSet(), [car(61, 340, 2, 5)]);
    queue.world.step(0.05);
    expect(queue.driver.report.accelBy).not.toBe('no-undertake');
  });

  it('does not pull left past a slower car in its own lane', () => {
    const setup = (rules: RuleSet) => {
      const sc = scenario(rules, [car(70, 360, 2, 15)]);
      Object.assign(sc.world.ego, { y: 2, prevY: 2, targetLane: 2 }); // top lane, slow car ahead
      sc.world.step(0.05);
      return sc.driver.report;
    };
    const blocked = setup(new RuleSet());
    expect(blocked.vetoBy).toBe('no-undertake');

    const rules = new RuleSet();
    rules.get('no-undertake')!.enabled = false;
    const allowed = setup(rules);
    expect(allowed.laneBy).toBe('return-slow-lane');
  });

  it('writes down what it decided and why', () => {
    const { world, driver } = scenario(new RuleSet(), [car(50, 490, 1, 15)]);
    for (let i = 0; i < 20 * 14; i++) world.step(0.05);
    const log = driver.log;
    const plan = log.records.find((r) => r.kind === 'lane' && r.title.startsWith('Plan'));
    expect(plan).toBeDefined();
    expect(plan!.rules).toContain('overtake');
    expect(plan!.why.join(' ')).toMatch(/slower than my/);
    expect(plan!.why.join(' ')).toMatch(/signalling/);
    expect(plan!.outcome).toMatch(/completed|signalled/);
    expect(log.counts.planned).toBeGreaterThanOrEqual(1);
    expect(log.records.some((r) => r.kind === 'speed')).toBe(true);
    expect(log.totalTime).toBeGreaterThan(10);
  });

  it('logs a blocked lane change with the rule that vetoed it', () => {
    const { world, driver } = scenario(new RuleSet(), [car(50, 360, 1, 15), car(51, 296, 2, 30)]);
    for (let i = 0; i < 10; i++) world.step(0.05);
    const blocked = driver.log.records.find((r) => r.kind === 'blocked');
    expect(blocked).toBeDefined();
    expect(blocked!.rules).toContain('lane-change-safety');
    expect(blocked!.why.join(' ')).toMatch(/vetoed/);
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
