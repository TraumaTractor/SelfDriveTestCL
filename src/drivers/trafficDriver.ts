import { clamp } from '../common';
import { idm, type IdmParams } from '../sim/idm';
import { mergeImpact } from '../sim/impact';
import type { Rng } from '../sim/rng';
import { rampAt } from '../sim/road';
import { stoppingSightSpeed } from '../sim/weather';
import { bumperGap, occupies, type Decision, type Driver, type Indicator, type Vehicle, type VehicleSpec } from '../sim/vehicle';
import type { World } from '../sim/world';
import type { Personality } from './personality';

interface Intent {
  target: number;
  since: number;
  signal: boolean;
  lead: number;
}

/** Computes IDM acceleration for `veh` following `leader` (or free road). */
function followAccel(veh: Vehicle, leaderS: { gap: number; v: number } | null): number {
  return leaderS
    ? idm(veh.idm, veh.v, veh.v0, leaderS.gap, veh.v - leaderS.v)
    : idm(veh.idm, veh.v, veh.v0, Infinity, 0);
}

export class TrafficDriver implements Driver {
  private readonly idmParams: IdmParams;
  private readonly baseT: number;
  private readonly noise: number;
  private readonly courteous: boolean;
  private filtered = 0;
  private lapseLeft = 0;
  private lastAccel = 0;
  private nextEval: number;
  private cooldownUntil = 0;
  private intent: Intent | null = null;
  private changeSignal = false;

  constructor(private readonly p: Personality, private readonly rng: Rng, private readonly spec: VehicleSpec, private readonly maxLane: number) {
    this.idmParams = { a: p.accel * spec.accelScale, b: p.decel * spec.brakeScale, T: p.headway * spec.headwayScale, s0: p.minGap };
    this.baseT = this.idmParams.T;
    this.noise = 1 + rng.gauss() * 0.04;
    this.courteous = rng.chance(p.courtesy);
    this.nextEval = rng.range(0, 0.5);
  }

  decide(w: World, me: Vehicle, dt: number): Decision {
    const p = this.p;
    const limit = w.limitAt(me.s);
    let v0 = Math.max(3, Math.min(limit * p.speedFactor * this.noise, this.spec.maxSpeed));
    // bad weather: careful drivers slow down and back off in proportion to how careful they are
    const wx = w.conditions;
    if (wx.kind !== 'clear') {
      const care = p.weatherCare;
      v0 *= 1 - (1 - wx.speedFactor) * care;
      const safe = stoppingSightSpeed(wx.visibility * 0.8, 5 * wx.grip);
      v0 = Math.max(3, Math.min(v0, v0 * (1 - care) + safe * care));
    }
    this.idmParams.T = this.baseT * (1 + (1 / wx.grip - 1) * p.weatherCare);
    me.v0 = v0;
    me.idm = this.idmParams;

    // ---- car following ------------------------------------------------
    let gap = Infinity;
    let leadV = 0;
    const lead = w.leaderAhead(me);
    if (lead && lead.gap <= wx.visibility) { gap = lead.gap; leadV = lead.veh.v; } // can't react to what can't be seen

    // courteous drivers treat someone signalling into their lane as their leader
    if (this.courteous) {
      for (const dir of [-1, 1] as const) {
        const lane = me.targetLane + dir;
        const adjacent = lane === -1 ? (rampAt(w.road, me.s) ? w.vehiclesInLane(-1) : []) : w.vehiclesInLane(lane);
        for (const o of adjacent) {
          if (o === me || o.crashed) continue;
          const wants = o.indicator === -dir || (lane === -1 && o.onRamp && o.indicator === 1);
          if (!wants || o.changing) continue;
          const g = bumperGap(me, o);
          if (g > -o.length && g < 40 && g < gap) { gap = Math.max(g, 0.5); leadV = o.v; }
        }
      }
    }

    // ramp end acts as a wall for vehicles still on the acceleration lane
    if (me.onRamp && !me.changing) {
      const ramp = rampAt(w.road, me.s);
      if (ramp) {
        const wall = ramp.end - me.s - me.length / 2 - 4;
        if (wall < gap) { gap = Math.max(wall, 0.1); leadV = 0; }
      }
    }

    let a = idm(this.idmParams, me.v, v0, gap, me.v - leadV);

    // attention lapses: the driver simply does not react
    if (this.lapseLeft > 0) {
      this.lapseLeft -= dt;
      a = Math.min(a, 0) < 0 ? Math.max(a, this.lastAccel) : a;
    } else if (p.lapseRate > 0 && this.rng.chance(p.lapseRate * dt)) {
      this.lapseLeft = this.rng.range(0.8, 2.0);
    }

    // reaction time: low-pass filter on the demanded acceleration
    const k = Math.min(1, dt / Math.max(p.reaction, dt));
    this.filtered += (a - this.filtered) * k;
    // physical emergency: even bad drivers stamp on the brakes when nearly touching
    const out = gap < 1.0 && me.v > leadV ? Math.min(this.filtered, a) : this.filtered;
    this.lastAccel = out;

    // ---- lane changes --------------------------------------------------
    let wantLane: number | null = null;
    let indicator: Indicator = 0;

    if (me.changing) {
      indicator = this.changeSignal ? (Math.sign(me.targetLane - me.y) as Indicator) : 0;
    } else if (this.intent) {
      const it = this.intent;
      const dir = Math.sign(it.target - me.targetLane) as Indicator;
      if (!this.isSafe(w, me, it.target, v0, it.signal ? 0.9 : 1)) {
        this.intent = null; // gap closed up, abandon
      } else {
        indicator = it.signal ? dir : 0;
        if (w.time - it.since >= it.lead) {
          wantLane = it.target;
          this.changeSignal = it.signal;
          this.intent = null;
          this.cooldownUntil = w.time + this.cooldown();
        }
      }
    } else if (w.time >= this.nextEval && (w.time >= this.cooldownUntil || this.staticAhead(w, me))) {
      this.nextEval = w.time + 0.5;
      const target = me.onRamp ? this.mergeTarget(w, me, v0) : (this.avoidStatic(w, me, v0) ?? this.chooseLane(w, me, v0, a));
      if (target !== null) {
        const signal = this.rng.chance(p.signalProb);
        this.intent = { target, since: w.time, signal, lead: signal ? p.signalLead * this.rng.range(0.7, 1.3) : 0 };
        if (!signal || this.intent.lead <= 0) {
          wantLane = target;
          this.changeSignal = signal;
          this.intent = null;
          this.cooldownUntil = w.time + this.cooldown();
          if (signal) indicator = Math.sign(target - me.targetLane) as Indicator;
        } else {
          indicator = Math.sign(target - me.targetLane) as Indicator;
        }
      }
    }

    return { accel: out, wantLane, indicator };
  }

  /** Is there something stationary (debris, a closure, a broken-down vehicle) ahead in my lane, close enough to matter? */
  private staticAhead(w: World, me: Vehicle): boolean {
    if (me.changing || me.onRamp) return false;
    const lead = w.leaderIn(me, me.targetLane);
    return !!lead && lead.veh.isStatic && lead.gap < 90 + me.v * 7;
  }

  /**
   * Move out of the way of a stationary obstacle, early if the driver is considerate and late (so with a
   * smaller gap accepted) if it has run out of room.
   */
  private avoidStatic(w: World, me: Vehicle, v0: number): number | null {
    if (!this.staticAhead(w, me)) return null;
    const lane = me.targetLane;
    const lead = w.leaderIn(me, lane)!;
    const reach = 90 + me.v * 7;
    const urgency = clamp(1 - lead.gap / reach, 0, 1);
    let best: number | null = null;
    let bestGap = -1;
    for (const t of [lane + 1, lane - 1]) {
      if (t < 0 || t >= w.cfg.lanes || t > this.maxLane) continue;
      if (w.laneClosed(t, me.s - 10, me.s + reach + 100)) continue;
      const l2 = w.leaderIn(me, t);
      if (l2 && l2.veh.isStatic && l2.gap < reach) continue;
      if (!this.isSafe(w, me, t, v0, 1 - 0.6 * urgency, 1 + 3 * urgency)) continue;
      const g = l2 ? l2.gap : Infinity;
      if (g > bestGap) { best = t; bestGap = g; }
    }
    return best;
  }

  /** Patient drivers don't hop lanes; reckless ones do. */
  private cooldown(): number {
    return clamp(2 + 40 * this.p.changeThreshold, 2, 12);
  }

  // ------------------------------------------------------------ lane logic

  private mergeTarget(w: World, me: Vehicle, v0: number): number | null {
    const ramp = rampAt(w.road, me.s);
    const remaining = ramp ? ramp.end - me.s : 0;
    const urgency = clamp(1 - remaining / 220, 0, 1);
    return this.isSafe(w, me, 0, v0, 1 - 0.7 * urgency, 1 + urgency * 2) ? 0 : null;
  }

  private chooseLane(w: World, me: Vehicle, v0: number, aOld: number): number | null {
    const p = this.p;
    const lane = me.targetLane;
    // Considerate drivers don't hop around: they move over because the car ahead is holding them
    // up, and otherwise stay (or return) left.
    if (p.politeness >= 0.2) return this.considerateChoice(w, me, v0);

    let best: number | null = null;
    let bestScore = p.changeThreshold;

    for (const target of [lane + 1, lane - 1]) {
      if (target < 0 || target >= w.cfg.lanes || target > this.maxLane) continue;
      if (!this.isSafe(w, me, target, v0, 1)) continue;

      const newLead = w.leaderIn(me, target);
      const newFol = w.followerIn(me, target);
      const oldFol = w.followerIn(me, lane);
      const oldLead = w.leaderIn(me, lane);

      const aNew = idm(this.idmParams, me.v, v0, newLead ? newLead.gap : Infinity, newLead ? me.v - newLead.veh.v : 0);
      let others = 0;
      if (newFol) {
        const f = newFol.veh;
        const before = followAccel(f, newLead ? { gap: bumperGap(f, newLead.veh), v: newLead.veh.v } : null);
        const after = followAccel(f, { gap: newFol.gap, v: me.v });
        others += after - before;
      }
      if (oldFol) {
        const f = oldFol.veh;
        const before = followAccel(f, { gap: oldFol.gap, v: me.v });
        const after = followAccel(f, oldLead ? { gap: bumperGap(f, oldLead.veh), v: oldLead.veh.v } : null);
        others += after - before;
      }
      // asymmetric keep-to-the-slow-lane bias
      const bias = (target > lane ? 1 : -1) * p.keepSlowLane * 0.4;
      const score = aNew - Math.min(aOld, p.accel) + p.politeness * others - bias;
      if (score > bestScore) { bestScore = score; best = target; }
    }
    return best;
  }

  /**
   * Overtake only when the vehicle ahead will actually affect us (it is slower than we want to go
   * and close enough that we'd have to follow it) - and move over early, before encroaching, so we
   * don't slow anyone down. Otherwise drift back to the left, but never by undertaking.
   */
  private considerateChoice(w: World, me: Vehicle, v0: number): number | null {
    const p = this.p;
    const lane = me.targetLane;
    const lead = w.leaderIn(me, lane);

    // patient drivers put up with a slightly slower car; they only move over for a real difference
    const tolerance = 0.3 + 0.03 * v0 + 2 * p.keepSlowLane;
    if (lead && lane + 1 <= this.maxLane && v0 - lead.veh.v > tolerance) {
      const closing = Math.max(0, me.v - lead.veh.v);
      const reach = 2 * (p.minGap + p.headway * me.v) + closing * (1 + 4 * p.politeness);
      if (lead.gap < reach && this.isSafe(w, me, lane + 1, v0, 1)) {
        // ...and only if the other lane would actually let us go faster
        const next = w.leaderIn(me, lane + 1);
        const aHere = idm(this.idmParams, me.v, v0, lead.gap, me.v - lead.veh.v);
        const aThere = idm(this.idmParams, me.v, v0, next ? next.gap : Infinity, next ? me.v - next.veh.v : 0);
        if (aThere - aHere > 0.25) return lane + 1;
      }
    }

    if (lane > 0 && p.keepSlowLane >= 0.5 && this.rng.chance(p.keepSlowLane) && this.isSafe(w, me, lane - 1, v0, 0.7)) {
      // moving left past a slower car in our own lane would be undertaking it
      const undertaking = lead && lead.gap < 120 && lead.veh.v < me.v - 1.5 && lead.veh.v > 8;
      const ahead = w.leaderIn(me, lane - 1);
      const room = 0.5 * p.headway * me.v + p.minGap + 5;
      if (!undertaking && (!ahead || (ahead.gap > room && ahead.veh.v > me.v - 1.5))) return lane - 1;
    }
    return null;
  }

  /**
   * Is moving into `target` acceptable? Judged mainly by the impact on the driver behind (how hard
   * they must brake, which depends on how fast they are closing) and on ourselves, with a small
   * absolute gap floor. `scale` < 1 loosens the tolerances (urgency), > 1 tightens them.
   */
  private isSafe(w: World, me: Vehicle, target: number, _v0: number, scale: number, boost = 1): boolean {
    const p = this.p;
    if (target < 0 && !me.onRamp) return false;
    if (w.laneClosed(target, me.s - 10, me.s + 150)) return false; // roadworks
    const im = mergeImpact(w, me, target);
    const tol = boost / Math.max(scale, 0.3);
    const floor = Math.max(0.8, p.minGap * p.gapFactor * 0.5);

    if (im.followerGap < floor || im.leaderGap < floor) return false;
    if (im.imposedDecel > p.safeDecel * tol) return false;
    if (im.selfDecel > (p.decel + (2 - p.gapFactor)) * tol) return false;
    // someone else already changing into the same lane right beside us
    for (const o of w.vehiclesInLane(target)) {
      if (o !== me && !occupies(me, target) && Math.abs(o.s - me.s) < (o.length + me.length) / 2 + 3 && o.changing) return false;
    }
    return true;
  }
}
