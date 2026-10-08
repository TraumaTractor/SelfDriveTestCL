import { clamp } from '../common';
import { idm } from '../sim/idm';
import { distanceToNextRamp } from '../sim/road';
import { stoppingSightSpeed } from '../sim/weather';
import { LANE_CHANGE_TIME } from '../sim/world';
import { bumperGap, type Indicator, type Vehicle } from '../sim/vehicle';
import type { Ctx, Draft, Params, RuleDef, RuleImpl, RuleItem } from './context';
import * as U from '../units';

const emergencyBrake: RuleImpl = {
  def: {
    id: 'emergency-brake', name: 'Emergency brake', phase: 'main',
    description: 'Slams the brakes when the time-to-collision with anything in our path drops below the threshold.',
    params: [
      { key: 'ttc', label: 'TTC trigger', min: 0.5, max: 4, step: 0.1, unit: 's', default: 1.8 },
      { key: 'brake', label: 'Brake force', min: 3, max: 10, step: 0.5, unit: 'm/s²', default: 8 },
    ],
  },
  run(ctx, p, d) {
    const lead = ctx.world.corridorLeader(ctx.me);
    if (!lead || lead.gap > ctx.visibility) return;
    const closing = ctx.me.v - lead.veh.v;
    if (closing <= 0.3) return;
    const ttc = Math.max(lead.gap, 0) / closing;
    if (ttc < p.ttc || lead.gap < 1) {
      d.proposeAccel('emergency-brake', -p.brake, true,
        `time-to-collision ${ttc.toFixed(1)} s (trigger ${p.ttc} s): ${ctx.name(lead.veh)} at ${U.speed(lead.veh.v)}, ${U.dist(lead.gap, 0)} ahead, closing ${U.speed(closing)}`);
    }
  },
};

const keepDistance: RuleImpl = {
  def: {
    id: 'keep-distance', name: 'Keep following distance', phase: 'main',
    description: 'Smooth car-following (IDM): holds a time headway behind the vehicle in front and eases off as the gap closes.',
    params: [
      { key: 'headway', label: 'Time headway', min: 0.3, max: 4, step: 0.1, unit: 's', default: 1.7 },
      { key: 'minGap', label: 'Standstill gap', min: 0.5, max: 8, step: 0.5, unit: 'm', default: 3 },
      { key: 'comfortDecel', label: 'Comfort braking', min: 0.5, max: 6, step: 0.1, unit: 'm/s²', default: 2.2 },
      { key: 'maxAccel', label: 'Max acceleration', min: 0.5, max: 4, step: 0.1, unit: 'm/s²', default: 1.8 },
      { key: 'range', label: 'Sensor range', min: 20, max: 300, step: 10, unit: 'm', default: 150 },
    ],
  },
  run(ctx, p, d) {
    const lead = ctx.leader();
    if (!lead || lead.gap > p.range) return;
    const a = idm({ a: p.maxAccel, b: p.comfortDecel, T: p.headway * ctx.headwayScale, s0: p.minGap }, ctx.me.v, ctx.cruise, lead.gap, ctx.me.v - lead.veh.v);
    d.proposeAccel('keep-distance', a,
      false, `following a ${ctx.name(lead.veh)} at ${U.speed(lead.veh.v)}, ${U.dist(lead.gap, 0)} ahead (${(lead.gap / Math.max(ctx.me.v, 0.1)).toFixed(1)} s; I want ${p.headway} s)`);
  },
};

const yieldToMerging: RuleImpl = {
  def: {
    id: 'yield-to-merging', name: 'Yield to merging traffic', phase: 'main',
    description: 'Treats cars that are signalling into our lane (and cars on the on-ramp beside us) as if they were already in front, opening a gap.',
    params: [
      { key: 'lookahead', label: 'Look-ahead', min: 10, max: 120, step: 5, unit: 'm', default: 45 },
      { key: 'extraHeadway', label: 'Extra headway', min: 0, max: 2, step: 0.1, unit: 's', default: 0.6 },
      { key: 'rampCars', label: 'Yield to ramp cars', min: 0, max: 1, step: 1, hint: '0 = only when they signal' , default: 1 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    for (const dir of [-1, 1]) {
      const lane = me.targetLane + dir;
      if (lane < -1 || lane >= world.cfg.lanes) continue;
      for (const o of world.vehiclesInLane(lane)) {
        if (o === me || o.crashed || o.targetLane === me.targetLane) continue;
        const signalling = o.indicator === -dir;
        const ramp = p.rampCars >= 0.5 && lane === -1 && o.onRamp;
        if (!signalling && !ramp) continue;
        const gap = bumperGap(me, o);
        if (gap < -o.length || gap > p.lookahead) continue;
        const a = idm(
          { a: 1.8, b: 2.2, T: 1.6 + p.extraHeadway, s0: 3 },
          me.v, ctx.cruise, Math.max(gap, 0.5), me.v - o.v,
        );
        d.proposeAccel('yield-to-merging', a, false,
          `${ctx.name(o)} ${signalling ? 'is signalling into my lane' : 'is on the ramp beside me'}, ${U.dist(Math.max(gap, 0), 0)} ahead: treating it as my leader to open a gap`);
      }
    }
  },
};

const keepSpeed: RuleImpl = {
  def: {
    id: 'keep-speed', name: 'Keep to speed limit', phase: 'main',
    description: 'Cruise control: accelerate or slow towards limit × factor.',
    params: [
      { key: 'speedFactor', label: 'Target speed vs limit', min: 0.5, max: 1.4, step: 0.01, unit: '×', default: 1.0 },
      { key: 'maxAccel', label: 'Max acceleration', min: 0.5, max: 4, step: 0.1, unit: 'm/s²', default: 1.8 },
      { key: 'gain', label: 'Gain', min: 0.1, max: 2, step: 0.05, default: 0.5 },
    ],
  },
  run(ctx, p, d) {
    d.proposeAccel('keep-speed', clamp(p.gain * (ctx.cruise - ctx.me.v), -3, p.maxAccel), false,
      `holding ${U.speed(ctx.cruise)} (limit ${U.speed(ctx.limit)}); now ${U.speed(ctx.me.v)}`);
  },
};

const weatherAdapt: RuleImpl = {
  def: {
    id: 'weather-adapt', name: 'Adapt to the weather', phase: 'main',
    description: 'In rain, fog or snow: slows down, and leaves a longer gap, in proportion to how much grip and visibility are lost. Switch it off to see what a car that ignores the weather does.',
    params: [
      { key: 'speed', label: 'Slow down by', min: 0, max: 1, step: 0.05, unit: '× of the recommended cut', default: 1 },
      { key: 'headway', label: 'Extra following gap', min: 0, max: 1, step: 0.05, unit: '× of what grip needs', default: 1 },
      { key: 'sight', label: 'Never outdrive my sight', min: 0, max: 1, step: 1, hint: '1 = keep speed low enough to stop within the visible distance', default: 1 },
    ],
  },
  run(ctx, p, d) {
    const c = ctx.conditions;
    if (c.kind === 'clear') return;
    let target = ctx.cruise * (1 - (1 - c.speedFactor) * p.speed);
    if (p.sight >= 0.5) target = Math.min(target, stoppingSightSpeed(c.visibility * 0.8, 5 * c.grip));
    if (ctx.me.v > target) {
      d.proposeAccel('weather-adapt', clamp(0.6 * (target - ctx.me.v), -2.5, 0), false,
        `${c.kind} (grip ${Math.round(c.grip * 100)}%, visibility ${U.dist(c.visibility)}): holding ${U.speed(target)} instead of ${U.speed(ctx.cruise)}`);
    }
  },
};

const makeRoom: RuleImpl = {
  def: {
    id: 'make-room', name: 'Move over for on-ramp', phase: 'main',
    description: 'In the slow lane beside an on-ramp, moves one lane over to let merging cars in.',
    params: [
      { key: 'lookahead', label: 'Look-ahead', min: 20, max: 150, step: 5, unit: 'm', default: 70 },
      { key: 'cooldown', label: 'Cooldown', min: 0, max: 20, step: 1, unit: 's', default: 4 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    if (!ctx.canChangeLane || me.targetLane !== 0 || ctx.timeSinceLaneChange < p.cooldown) return;
    for (const o of world.vehiclesInLane(-1)) {
      if (o.onRamp && o.s > me.s - 30 && o.s < me.s + p.lookahead) {
        d.proposeLane('make-room', 1,
          `a ${ctx.noun(o)} on the on-ramp is ${U.dist(Math.abs(o.s - me.s), 0)} ${o.s > me.s ? 'ahead' : 'behind'} and about to merge: moving over to make room`);
        return;
      }
    }
  },
};

const avoidObstacle: RuleImpl = {
  def: {
    id: 'avoid-obstacle', name: 'Avoid obstacles in the lane', phase: 'main',
    description: 'Debris, a broken-down vehicle or a closed lane ahead: moves over early - before it has to brake - into a lane that is clear, choosing whichever side is safe.',
    params: [
      { key: 'foresight', label: 'Plan ahead by (on top of signal + move)', min: 1, max: 12, step: 0.5, unit: 's', default: 5 },
      { key: 'lookahead', label: 'Max look-ahead', min: 100, max: 600, step: 25, unit: 'm', default: 400 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    if (!ctx.canChangeLane) return;
    const lead = world.leaderIn(me, ctx.lane);
    if (!lead || !lead.veh.isStatic || lead.gap > ctx.visibility || lead.gap > p.lookahead) return;

    const manoeuvre = ctx.param('signal', 'leadTime', 0) + LANE_CHANGE_TIME + p.foresight;
    const reach = me.v * manoeuvre + 30;
    const what = ctx.name(lead.veh);
    if (lead.gap > reach) {
      d.note('avoid-obstacle', `${what} ${U.dist(lead.gap)} ahead in my lane: will move over inside ${U.dist(reach)}`);
      return;
    }
    const maxImpact = ctx.param('lane-change-safety', 'maxImpact', 1);
    const maxSelf = ctx.param('lane-change-safety', 'maxSelfDecel', 2.5);
    const minGap = ctx.param('lane-change-safety', 'minGap', 2);
    let best: { lane: number; gap: number } | null = null;
    const why: string[] = [];
    for (const t of [ctx.lane - 1, ctx.lane + 1]) {
      if (t < 0 || t >= world.cfg.lanes) continue;
      const ahead = world.leaderIn(me, t);
      if (ahead && ahead.veh.isStatic && ahead.gap < reach) { why.push(`lane ${t + 1} has ${ctx.name(ahead.veh)} too`); continue; }
      const chk = ctx.mergeCheck(t, maxImpact, maxSelf, minGap);
      if (!chk.ok) { why.push(`lane ${t + 1}: ${chk.reason}`); continue; }
      const gap = ahead ? ahead.gap : Infinity;
      if (!best || gap > best.gap) best = { lane: t, gap };
    }
    if (!best) {
      d.note('avoid-obstacle', `${what} ${U.dist(lead.gap)} ahead and no safe way round (${why.join('; ') || 'no other lane'}): braking`);
      return;
    }
    d.proposeLane('avoid-obstacle', best.lane,
      `${what} ${U.dist(lead.gap)} ahead in my lane: moving to lane ${best.lane + 1} now so I never have to brake hard for it`);
  },
};

const overtake: RuleImpl = {
  def: {
    id: 'overtake', name: 'Overtake slow vehicles', phase: 'main',
    description: 'Moves over when the vehicle ahead is going to affect us - i.e. it is slower than our target speed and close enough that we would have to follow it. It moves early, before encroaching, so we never have to slow down for it.',
    params: [
      { key: 'margin', label: 'Counts as slower if below target by', min: 0, max: 8, step: 0.1, unit: 'm/s', default: 2.0 },
      { key: 'reach', label: 'Reach (× following distance)', min: 0.5, max: 4, step: 0.1, unit: '×', default: 2.0 },
      { key: 'foresight', label: 'Extra margin (on top of signal + move time)', min: 0, max: 8, step: 0.5, unit: 's', default: 2 },
      { key: 'lookahead', label: 'Max look-ahead', min: 30, max: 400, step: 10, unit: 'm', default: 250 },
      { key: 'cooldown', label: 'Cooldown', min: 0, max: 30, step: 1, unit: 's', default: 6 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    if (!ctx.canChangeLane) return;
    const lead = world.leaderIn(me, ctx.lane);
    if (!lead || lead.gap > p.lookahead) return;
    // does it affect us at all? only if it is slower than we want to go
    if (ctx.cruise - lead.veh.v <= p.margin) return;

    const kmh = U.speed(lead.veh.v);
    const closing = Math.max(0, me.v - lead.veh.v);
    // Start early enough that the whole manoeuvre (signal, then the move itself) is done before we
    // would need to brake for it.
    const manoeuvre = ctx.param('signal', 'leadTime', 0) + LANE_CHANGE_TIME + p.foresight;
    const reach = (ctx.param('keep-distance', 'minGap', 3) + ctx.param('keep-distance', 'headway', 1.7) * me.v) * p.reach + closing * manoeuvre;
    if (lead.gap > reach) {
      d.note('overtake', `${kmh} ${ctx.noun(lead.veh)} ahead is slower than my ${U.speed(ctx.cruise)}; will move over inside ${U.dist(reach, 0)} (now ${U.dist(lead.gap, 0)})`);
      return;
    }
    if (ctx.timeSinceLaneChange < p.cooldown) {
      d.note('overtake', `held up by a ${kmh} ${ctx.noun(lead.veh)}, but only ${ctx.timeSinceLaneChange.toFixed(0)}s since last lane change (cooldown ${p.cooldown}s)`);
      return;
    }
    const up = ctx.lane + 1;
    if (up >= world.cfg.lanes) {
      d.note('overtake', `held up by a ${kmh} ${ctx.noun(lead.veh)} but already in the fastest lane`);
      return;
    }
    const next = world.leaderIn(me, up);
    if (next && next.gap < lead.gap && next.veh.v < lead.veh.v + 1) {
      d.note('overtake', `held up by a ${kmh} ${ctx.noun(lead.veh)}, but lane ${up + 1} is no faster`);
      return;
    }
    d.proposeLane('overtake', up,
      `${ctx.name(lead.veh)} ahead at ${kmh} is slower than my ${U.speed(ctx.cruise)} target and within ${U.dist(reach, 0)} (now ${U.dist(lead.gap, 0)}): it would hold me up, so I move over before having to slow down`);
  },
};

const returnSlowLane: RuleImpl = {
  def: {
    id: 'return-slow-lane', name: 'Return to slow lane', phase: 'main',
    description: 'Drifts back towards the slow lane once the road ahead there is clear. Avoids doing so just before an on-ramp.',
    params: [
      { key: 'freeGap', label: 'Clear road needed', min: 30, max: 300, step: 10, unit: 'm', default: 120 },
      { key: 'dwell', label: 'Min time in lane', min: 0, max: 30, step: 1, unit: 's', default: 8 },
      { key: 'avoidRamp', label: 'Avoid before ramp', min: 0, max: 600, step: 25, unit: 'm', default: 300 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    if (!ctx.canChangeLane || ctx.lane <= 0) return;
    if (ctx.timeSinceLaneChange < p.dwell) {
      d.note('return-slow-lane', `would drift back left, settling in lane for ${(p.dwell - ctx.timeSinceLaneChange).toFixed(0)}s more`);
      return;
    }
    if (ctx.lane === 1 && distanceToNextRamp(world.road, me.s) < p.avoidRamp) {
      d.note('return-slow-lane', 'on-ramp ahead, staying out of the slow lane');
      return;
    }
    const down = ctx.lane - 1;
    const lead = world.leaderIn(me, down);
    if (lead && lead.gap < p.freeGap && lead.veh.v < ctx.cruise - 1) {
      d.note('return-slow-lane', `slow lane busy: ${U.speed(lead.veh.v)} ${ctx.noun(lead.veh)} ${U.dist(lead.gap, 0)} ahead`);
      return;
    }
    d.proposeLane('return-slow-lane', down,
      !lead ? `lane ${down + 1} is empty ahead: keeping left unless overtaking`
        : lead.gap >= p.freeGap ? `lane ${down + 1} is clear for ${U.dist(lead.gap, 0)}: keeping left unless overtaking`
        : `the ${ctx.name(lead.veh)} ahead in lane ${down + 1} (${U.dist(lead.gap, 0)}) is going ${U.speed(lead.veh.v)}, no slower than my target: keeping left unless overtaking`);
  },
};

const noUndertake: RuleImpl = {
  def: {
    id: 'no-undertake', name: 'No undertaking', phase: 'post',
    description: 'Never pass on the inside. Holds back rather than drawing past slower traffic in the lane to our right, and vetoes a move left that would pass a slower car in our own lane. Slow-moving queues are exempt.',
    params: [
      { key: 'queueSpeed', label: 'Queue speed (undertaking allowed below)', min: 0, max: 20, step: 1, unit: 'm/s', default: 8 },
      { key: 'margin', label: 'Tolerance', min: 0, max: 5, step: 0.5, unit: 'm/s', default: 1.5 },
      { key: 'lookahead', label: 'Look-ahead', min: 20, max: 200, step: 10, unit: 'm', default: 80 },
      { key: 'maxDecel', label: 'Max braking to hold back', min: 0.5, max: 4, step: 0.1, unit: 'm/s²', default: 1.5 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    if (me.v < p.queueSpeed) return;

    // 1. don't draw past slower traffic in the lane on our right (overtaking side)
    const right = ctx.lane + 1;
    if (right < world.cfg.lanes) {
      let worst: { v: number; gap: number; veh: Vehicle } | null = null;
      for (const o of world.vehiclesInLane(right)) {
        if (o === me || o.crashed || o.v < p.queueSpeed) continue;
        const gap = bumperGap(me, o);
        if (gap < -o.length * 1.5 || gap > p.lookahead || o.v > me.v - p.margin) continue;
        if (!worst || o.v < worst.v) worst = { v: o.v, gap, veh: o };
      }
      if (worst) {
        const a = clamp(0.8 * (worst.v + p.margin - me.v), -p.maxDecel, 0);
        d.proposeAccel('no-undertake', a, false,
          `a ${U.speed(worst.v)} ${ctx.noun(worst.veh)} in lane ${right + 1} ${worst.gap > 0 ? U.dist(worst.gap) + ' ahead' : 'beside me'} is slower than me: I won't pass it on the inside`);
        d.note('no-undertake', `not undertaking the ${U.speed(worst.v)} ${ctx.noun(worst.veh)} in lane ${right + 1}: holding back`);
      }
    }

    // 2. don't pull left past a slower car that is in our own lane
    if (d.lane !== null && d.lane < ctx.lane) {
      const lead = world.leaderIn(me, ctx.lane);
      if (lead && lead.gap < p.lookahead && lead.veh.v >= p.queueSpeed && lead.veh.v < me.v - p.margin) {
        d.veto('no-undertake', `moving left would undertake the ${U.speed(lead.veh.v)} ${ctx.noun(lead.veh)} ahead`);
      }
    }
  },
};

const laneSafety: RuleImpl = {
  def: {
    id: 'lane-change-safety', name: 'Lane-change impact check', phase: 'post',
    description: 'Vetoes a lane change if it would force the driver behind to brake hard. Judged by closing speed, not just distance: a fast car behind is affected even from far back, while one crawling behind barely notices a tight gap. Disable it to see what happens.',
    params: [
      { key: 'maxImpact', label: 'Max braking imposed on them', min: 0, max: 6, step: 0.1, unit: 'm/s²', default: 1.0 },
      { key: 'maxSelfDecel', label: 'Max braking I accept', min: 0.5, max: 8, step: 0.1, unit: 'm/s²', default: 2.5 },
      { key: 'minGap', label: 'Absolute min gap', min: 0.5, max: 10, step: 0.5, unit: 'm', default: 2 },
    ],
  },
  run(ctx, p, d) {
    if (d.lane === null) return;
    const r = ctx.mergeCheck(d.lane, p.maxImpact, p.maxSelfDecel, p.minGap);
    d.check = r;
    if (!r.ok) d.veto('lane-change-safety', r.reason);
  },
};

const signal: RuleImpl = {
  def: {
    id: 'signal', name: 'Signal before lane change', phase: 'post',
    description: 'Switches the indicator on before moving, and waits so other drivers can react.',
    params: [{ key: 'leadTime', label: 'Signal lead time', min: 0, max: 5, step: 0.1, unit: 's', default: 2.0 }],
  },
  run(ctx, p, d) {
    d.signalLead = p.leadTime;
    if (d.lane !== null) {
      d.indicator = Math.sign(d.lane - ctx.lane) as Indicator;
      d.indicatorBy = 'signal';
    }
  },
};

const comfort: RuleImpl = {
  def: {
    id: 'comfort-limit', name: 'Comfort limits', phase: 'post',
    description: 'Clamps acceleration and braking for a smooth ride (emergency braking is exempt).',
    params: [
      { key: 'maxAccel', label: 'Max acceleration', min: 0.5, max: 5, step: 0.1, unit: 'm/s²', default: 2.0 },
      { key: 'maxDecel', label: 'Max braking', min: 1, max: 9, step: 0.1, unit: 'm/s²', default: 3.5 },
    ],
  },
  run(_ctx, p, d) {
    if (d.emergency || !Number.isFinite(d.accel)) return;
    const c = clamp(d.accel, -p.maxDecel, p.maxAccel);
    if (c !== d.accel) {
      d.accel = c;
      d.clampedBy = 'comfort-limit';
    }
  },
};

/** Default evaluation order. Lane proposals earlier in the list win ties. */
export const RULE_IMPLS: RuleImpl[] = [
  emergencyBrake, keepDistance, yieldToMerging, weatherAdapt, keepSpeed,
  makeRoom, avoidObstacle, overtake, returnSlowLane,
  noUndertake, laneSafety, signal, comfort,
];

export const RULE_BY_ID: Record<string, RuleImpl> = Object.fromEntries(RULE_IMPLS.map((r) => [r.def.id, r]));

export function defaultParams(id: string): Params {
  const out: Params = {};
  for (const prm of RULE_BY_ID[id].def.params) out[prm.key] = prm.default;
  return out;
}

export class RuleSet {
  items: RuleItem[];

  constructor(items?: RuleItem[]) {
    this.items = items ?? RULE_IMPLS.map((r) => ({ id: r.def.id, enabled: true, params: defaultParams(r.def.id) }));
  }

  get(id: string): RuleItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  isEnabled(id: string): boolean {
    return this.get(id)?.enabled ?? false;
  }

  move(id: string, delta: number): void {
    const i = this.items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.items.length) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
  }

  clone(): RuleSet {
    return new RuleSet(this.items.map((i) => ({ id: i.id, enabled: i.enabled, params: { ...i.params } })));
  }

  toJSON(): { version: 1; rules: RuleItem[] } {
    return { version: 1, rules: this.items.map((i) => ({ id: i.id, enabled: i.enabled, params: { ...i.params } })) };
  }

  /** Lenient loader: unknown rules/params are ignored, missing ones get defaults. */
  static fromJSON(data: unknown): RuleSet {
    const set = new RuleSet();
    const rules = (data as { rules?: unknown })?.rules;
    if (!Array.isArray(rules)) throw new Error('Expected {"rules": [...]}');
    const ordered: RuleItem[] = [];
    for (const raw of rules) {
      const r = raw as Partial<RuleItem>;
      const base = set.items.find((i) => i.id === r.id);
      if (!base || ordered.includes(base)) continue;
      base.enabled = r.enabled !== false;
      for (const prm of RULE_BY_ID[base.id].def.params) {
        const v = r.params?.[prm.key];
        if (typeof v === 'number' && Number.isFinite(v)) base.params[prm.key] = clamp(v, prm.min, prm.max);
      }
      ordered.push(base);
    }
    for (const i of set.items) if (!ordered.includes(i)) ordered.push(i);
    set.items = ordered;
    return set;
  }
}

export function runStack(ctx: Ctx, set: RuleSet, d: Draft): void {
  for (const phase of ['main', 'post'] as const) {
    for (const item of set.items) {
      const impl = RULE_BY_ID[item.id];
      if (!item.enabled || impl.def.phase !== phase) continue;
      impl.run(ctx, item.params, d);
    }
  }
}

export type { Params, RuleDef };
