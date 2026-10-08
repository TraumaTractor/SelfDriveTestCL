import type { Decision, Driver, Indicator, Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';
import { Ctx, Draft, type MergeCheck } from './context';
import { DecisionLog } from './decisions';
import { RuleSet, runStack } from './rules';

/** What the rule stack decided last tick - used for the on-screen explanation. */
export interface EgoReport {
  accelBy: string | null;
  laneBy: string | null;
  vetoBy: string | null;
  vetoReason: string;
  clampedBy: string | null;
  emergency: boolean;
  accel: number;
  signalling: boolean;
  pendingLane: number | null;
  /** impact assessment of the lane change currently being considered */
  check: MergeCheck | null;
  /** everything proposed this tick (acceleration: most restrictive wins) */
  accelProposals: { by: string; a: number; why?: string }[];
  laneProposals: { by: string; lane: number; why?: string }[];
  notes: { by: string; text: string }[];
  /** speed the car is trying to hold (m/s) and the posted limit */
  targetSpeed: number;
  limit: number;
  /** seconds left on the signal-before-moving delay, if signalling */
  signalRemaining: number | null;
}

export class EgoDriver implements Driver {
  report: EgoReport = {
    accelBy: null, laneBy: null, vetoBy: null, vetoReason: '', clampedBy: null,
    emergency: false, accel: 0, signalling: false, pendingLane: null, check: null,
    accelProposals: [], laneProposals: [], notes: [], targetSpeed: 0, limit: 0, signalRemaining: null,
  };

  /** what the car decided and why (cheap, but switch off for headless batch runs) */
  readonly log = new DecisionLog();
  recordDecisions = true;

  private lastChangeEnd = -Infinity;
  private wasChanging = false;
  private pending: { target: number; since: number } | null = null;

  /** The rule set is shared by reference so edits apply live while running. */
  constructor(public rules: RuleSet) {}

  decide(world: World, me: Vehicle, dt = 0.05): Decision {
    if (this.wasChanging && !me.changing) this.lastChangeEnd = world.time;
    this.wasChanging = me.changing;

    const limit = world.limitAt(me.s);
    const ctx = new Ctx(world, me, this.rules.items, world.time - this.lastChangeEnd, limit);
    const d = new Draft();
    runStack(ctx, this.rules, d);

    // sensor-model hints for other drivers
    me.v0 = ctx.cruise;
    const kd = this.rules.get('keep-distance');
    if (kd) me.idm = { a: kd.params.maxAccel, b: kd.params.comfortDecel, T: kd.params.headway, s0: kd.params.minGap };

    const signalOn = d.signalLead !== null;
    let wantLane: number | null = null;
    let indicator: Indicator = 0;

    if (me.changing) {
      this.pending = null;
      if (signalOn) indicator = Math.sign(me.targetLane - me.y) as Indicator;
    } else if (d.lane !== null) {
      const dir = Math.sign(d.lane - me.targetLane) as Indicator;
      if (signalOn && d.signalLead! > 0) {
        if (!this.pending || this.pending.target !== d.lane) this.pending = { target: d.lane, since: world.time };
        indicator = dir;
        if (world.time - this.pending.since >= d.signalLead!) {
          wantLane = d.lane;
          this.pending = null;
        }
      } else {
        wantLane = d.lane;
        if (signalOn) indicator = dir;
        this.pending = null;
      }
    } else {
      this.pending = null;
    }

    const accel = Number.isFinite(d.accel) ? d.accel : 0;
    this.report = {
      accelBy: d.accelBy, laneBy: d.laneBy, vetoBy: d.vetoBy, vetoReason: d.vetoReason,
      clampedBy: d.clampedBy, emergency: d.emergency, accel,
      signalling: indicator !== 0, pendingLane: this.pending?.target ?? null, check: d.check,
      accelProposals: d.accelProposals, laneProposals: d.laneProposals, notes: d.notes,
      targetSpeed: ctx.cruise, limit,
      signalRemaining: this.pending && d.signalLead !== null ? Math.max(0, d.signalLead - (world.time - this.pending.since)) : null,
    };
    if (this.recordDecisions) this.log.observe(world, me, d, ctx.cruise, limit, dt, d.signalLead);
    return { accel, wantLane, indicator };
  }
}
