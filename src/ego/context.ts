import type { ParamDef } from '../common';
import type { PersonalityId } from '../drivers/personality';
import { mergeImpact, type MergeImpact } from '../sim/impact';
import type { Conditions } from '../sim/weather';
import { VEHICLE_SPECS, type Indicator, type Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';
import * as U from '../units';

export type Params = Record<string, number>;

export interface RuleParam extends ParamDef {
  default: number;
}

export interface RuleDef {
  id: string;
  name: string;
  description: string;
  /** 'main' rules propose actions; 'post' rules veto / adjust the combined result */
  phase: 'main' | 'post';
  params: RuleParam[];
}

export interface RuleImpl {
  def: RuleDef;
  run(ctx: Ctx, p: Params, d: Draft): void;
}

export interface RuleItem {
  id: string;
  enabled: boolean;
  params: Params;
}

/** Everything a rule may look at. */
export class Ctx {
  readonly limit: number;
  readonly cruise: number;

  constructor(
    readonly world: World,
    readonly me: Vehicle,
    private readonly items: RuleItem[],
    readonly timeSinceLaneChange: number,
    limit: number,
  ) {
    this.limit = limit;
    this.cruise = limit * this.param('keep-speed', 'speedFactor', 1);
  }

  /** What to call a vehicle in explanations: car, van, lorry, motorcycle, coach. */
  noun(v: Vehicle): string {
    return VEHICLE_SPECS[v.type].noun;
  }

  /** Human name for a vehicle, e.g. "Great driver" or "wreck". */
  name(v: Vehicle): string {
    if (v.crashed) return 'wreck';
    if (v.isStatic) return v.type === 'barrier' ? 'road closure' : v.type === 'debris' ? 'debris' : `stationary ${VEHICLE_SPECS[v.type].noun}`;
    const p = this.world.cfg.personalities[v.label as PersonalityId];
    return p ? `${p.name} driver` : v.label;
  }

  get conditions(): Conditions {
    return this.world.conditions;
  }

  /** How far sensors can see right now (fog, rain and snow shorten it). */
  get visibility(): number {
    return this.world.conditions.visibility;
  }

  /** Following-distance multiplier from the weather rule (1 = none). */
  get headwayScale(): number {
    const item = this.items.find((i) => i.id === 'weather-adapt');
    if (!item || !item.enabled) return 1;
    return 1 + (1 / this.world.conditions.grip - 1) * item.params.headway;
  }

  get lane(): number {
    return this.me.targetLane;
  }

  get canChangeLane(): boolean {
    return !this.me.changing;
  }

  /** Read another rule's parameter even if that rule is disabled. */
  param(ruleId: string, key: string, fallback: number): number {
    const item = this.items.find((i) => i.id === ruleId);
    return item?.params[key] ?? fallback;
  }

  /** Leader in the lane(s) we occupy, as seen by sensors. */
  leader(): { veh: Vehicle; gap: number } | null {
    const lead = this.world.leaderAhead(this.me);
    return lead && lead.gap <= this.visibility ? lead : null;
  }

  /**
   * Is it acceptable to move into `target`? Judged by the impact on the driver behind (how much
   * harder they must brake - which depends on how fast they are closing, not just the distance)
   * and by how hard we must brake to match the new leader.
   */
  mergeCheck(target: number, maxImpact: number, maxSelfDecel: number, minGap: number): MergeCheck {
    const { world, me } = this;
    const empty = { impact: null, ok: false, reason: 'no such lane', limit: maxImpact };
    if (target < 0 || target >= world.cfg.lanes) return empty;
    if (world.laneClosed(target, me.s - 10, me.s + 200)) return { impact: null, ok: false, reason: 'that lane is closed ahead (roadworks)', limit: maxImpact };
    const im = mergeImpact(world, me, target);
    const info = (ok: boolean, reason: string): MergeCheck => ({ impact: im, ok, reason, limit: maxImpact });

    if (im.followerGap < minGap) return info(false, `only ${U.dist(Math.max(im.followerGap, 0), 1)} clear behind`);
    if (im.leaderGap < minGap) return info(false, `only ${U.dist(Math.max(im.leaderGap, 0), 1)} clear ahead`);
    if (im.imposedDecel > maxImpact) {
      const who = im.follower ? ` (${im.followerClosing >= 0 ? '+' : ''}${U.speed(im.followerClosing)}, ${U.dist(Math.max(0, im.followerGap), 0)} back)` : '';
      return info(false, `would make them brake ${U.accel(im.imposedDecel)}${who}`);
    }
    if (im.selfDecel > maxSelfDecel) return info(false, `I'd need ${U.accel(im.selfDecel)} to match the vehicle ahead`);
    for (const o of world.vehiclesInLane(target)) {
      if (o !== me && o.changing && Math.abs(o.s - me.s) < (o.length + me.length) / 2 + 4) {
        return info(false, 'another car is moving into that lane');
      }
    }
    return info(true, '');
  }
}

export interface MergeCheck {
  impact: MergeImpact | null;
  ok: boolean;
  reason: string;
  /** the tolerated impact, for display */
  limit: number;
}

/** Accumulates the output of the rule stack for one tick. */
export class Draft {
  accel = Infinity;
  accelBy: string | null = null;
  emergency = false;
  lane: number | null = null;
  laneBy: string | null = null;
  indicator: Indicator = 0;
  indicatorBy: string | null = null;
  /** seconds to signal before moving; null = no signal rule active */
  signalLead: number | null = null;
  vetoBy: string | null = null;
  vetoReason = '';
  clampedBy: string | null = null;
  /** the last lane-change impact assessment, for display */
  check: MergeCheck | null = null;
  /** everything that was proposed or observed this tick, so the car's reasoning can be shown */
  accelProposals: { by: string; a: number; why?: string }[] = [];
  laneProposals: { by: string; lane: number; why?: string }[] = [];
  notes: { by: string; text: string }[] = [];

  /** A rule's observation about why it is (not) acting - purely for explanation. */
  note(by: string, text: string): void {
    this.notes.push({ by, text });
  }

  /** Accel proposals are resolved most-restrictive-wins. */
  proposeAccel(by: string, a: number, emergency = false, why?: string): void {
    this.accelProposals.push({ by, a, why });
    if (a < this.accel) {
      this.accel = a;
      this.accelBy = by;
    }
    if (emergency) this.emergency = true;
  }

  /** Lane proposals are resolved by list order: the first rule to propose wins. */
  proposeLane(by: string, lane: number, why?: string): void {
    this.laneProposals.push({ by, lane, why });
    if (this.lane === null && this.vetoBy === null) {
      this.lane = lane;
      this.laneBy = by;
    }
  }

  veto(by: string, reason: string): void {
    this.lane = null;
    this.vetoBy = by;
    this.vetoReason = reason;
  }
}
