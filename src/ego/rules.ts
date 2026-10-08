import { clamp } from '../common';
import { idm } from '../sim/idm';
import { distanceToNextRamp } from '../sim/road';
import { bumperGap, type Indicator } from '../sim/vehicle';
import type { Ctx, Draft, Params, RuleDef, RuleImpl, RuleItem } from './context';

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
    if (!lead) return;
    const closing = ctx.me.v - lead.veh.v;
    if (closing <= 0.3) return;
    const ttc = Math.max(lead.gap, 0) / closing;
    if (ttc < p.ttc || lead.gap < 1) d.proposeAccel('emergency-brake', -p.brake, true);
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
    const a = idm({ a: p.maxAccel, b: p.comfortDecel, T: p.headway, s0: p.minGap }, ctx.me.v, ctx.cruise, lead.gap, ctx.me.v - lead.veh.v);
    d.proposeAccel('keep-distance', a);
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
        d.proposeAccel('yield-to-merging', a);
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
    d.proposeAccel('keep-speed', clamp(p.gain * (ctx.cruise - ctx.me.v), -3, p.maxAccel));
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
        d.proposeLane('make-room', 1);
        return;
      }
    }
  },
};

const overtake: RuleImpl = {
  def: {
    id: 'overtake', name: 'Overtake slow vehicles', phase: 'main',
    description: 'Moves to the faster lane when stuck behind something much slower than our target speed.',
    params: [
      { key: 'speedGain', label: 'Slower than target by', min: 0.5, max: 12, step: 0.5, unit: 'm/s', default: 3 },
      { key: 'lookahead', label: 'Look-ahead', min: 20, max: 200, step: 5, unit: 'm', default: 80 },
      { key: 'cooldown', label: 'Cooldown', min: 0, max: 30, step: 1, unit: 's', default: 6 },
    ],
  },
  run(ctx, p, d) {
    const { me, world } = ctx;
    if (!ctx.canChangeLane || ctx.timeSinceLaneChange < p.cooldown) return;
    const up = ctx.lane + 1;
    if (up >= world.cfg.lanes) return;
    const lead = world.leaderIn(me, ctx.lane);
    if (!lead || lead.gap > p.lookahead || lead.veh.v > ctx.cruise - p.speedGain) return;
    const next = world.leaderIn(me, up);
    if (next && next.gap < p.lookahead && next.veh.v < lead.veh.v + 1) return; // no better over there
    d.proposeLane('overtake', up);
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
    if (!ctx.canChangeLane || ctx.lane <= 0 || ctx.timeSinceLaneChange < p.dwell) return;
    if (ctx.lane === 1 && distanceToNextRamp(world.road, me.s) < p.avoidRamp) return;
    const down = ctx.lane - 1;
    const lead = world.leaderIn(me, down);
    if (lead && lead.gap < p.freeGap && lead.veh.v < ctx.cruise - 1) return;
    d.proposeLane('return-slow-lane', down);
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
  emergencyBrake, keepDistance, yieldToMerging, keepSpeed,
  makeRoom, overtake, returnSlowLane,
  laneSafety, signal, comfort,
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
