import type { ParamDef } from '../common';
import type { Indicator, Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';

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
    return this.world.leaderAhead(this.me);
  }

  /**
   * Is it safe to move into `target`? Uses time-headway based gaps plus a closing-speed term.
   */
  gapCheck(target: number, minGap: number, headway: number, closing: number): { ok: boolean; reason: string } {
    const { world, me } = this;
    if (target < 0 || target >= world.cfg.lanes) return { ok: false, reason: 'no such lane' };
    const lead = world.leaderIn(me, target);
    const fol = world.followerIn(me, target);
    if (lead) {
      const need = minGap + headway * 0.6 * me.v + closing * Math.max(0, me.v - lead.veh.v);
      if (lead.gap < need) return { ok: false, reason: `gap ahead ${lead.gap.toFixed(0)}m < ${need.toFixed(0)}m` };
    }
    if (fol) {
      const f = fol.veh;
      const need = minGap + headway * f.v + closing * Math.max(0, f.v - me.v);
      if (fol.gap < need) return { ok: false, reason: `gap behind ${fol.gap.toFixed(0)}m < ${need.toFixed(0)}m` };
    }
    for (const o of world.vehiclesInLane(target)) {
      if (o !== me && o.changing && Math.abs(o.s - me.s) < (o.length + me.length) / 2 + 4) {
        return { ok: false, reason: 'another car is moving into that lane' };
      }
    }
    return { ok: true, reason: '' };
  }
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

  /** Accel proposals are resolved most-restrictive-wins. */
  proposeAccel(by: string, a: number, emergency = false): void {
    if (a < this.accel) {
      this.accel = a;
      this.accelBy = by;
    }
    if (emergency) this.emergency = true;
  }

  /** Lane proposals are resolved by list order: the first rule to propose wins. */
  proposeLane(by: string, lane: number): void {
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
