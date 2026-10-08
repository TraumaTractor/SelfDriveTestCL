import type { Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';
import type { Draft } from './context';
import { RULE_BY_ID } from './rules';
import * as U from '../units';

export interface Snapshot {
  lane: number;
  speed: number;
  target: number;
  limit: number;
  leader: { name: string; v: number; gap: number; ttc: number | null } | null;
}

export type DecisionKind = 'speed' | 'lane' | 'blocked' | 'emergency';

export interface DecisionRecord {
  id: number;
  t: number;
  kind: DecisionKind;
  title: string;
  /** rules involved */
  rules: string[];
  /** reasons, in plain words */
  why: string[];
  snapshot: Snapshot;
  /** every acceleration proposal at the moment of the decision */
  proposals: { by: string; a: number; why?: string }[];
  outcome?: string;
  tone?: 'good' | 'warn' | 'bad' | 'info';
}

const MAX_RECORDS = 400;
const ruleName = (id: string): string => RULE_BY_ID[id]?.def.name ?? id;
const fmt = (a: number): string => U.accel(a, true);

/**
 * Watches the ego's rule stack every tick and writes down the decisions it makes - what it chose,
 * which rules were involved, why, and how it turned out.
 */
export class DecisionLog {
  records: DecisionRecord[] = [];
  /** bumped whenever anything changes, so the UI knows when to redraw */
  version = 0;
  /** seconds each rule spent controlling acceleration */
  ruleTime: Record<string, number> = {};
  totalTime = 0;
  counts = { planned: 0, completed: 0, abandoned: 0, blocked: 0, emergencies: 0 };

  private nextId = 1;
  private mode: { by: string | null; since: number; logged: boolean } = { by: null, since: 0, logged: false };
  private modeRecord: DecisionRecord | null = null;
  private wasEmergency = false;
  private state: 'idle' | 'planning' | 'moving' = 'idle';
  private plan: DecisionRecord | null = null;
  private moveStart = 0;
  private vetoKey: string | null = null;
  private vetoClearSince = 0;

  private add(rec: Omit<DecisionRecord, 'id'>): DecisionRecord {
    const full = { ...rec, id: this.nextId++ };
    this.records.push(full);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    this.version++;
    return full;
  }

  private snapshot(world: World, me: Vehicle, cruise: number, limit: number): Snapshot {
    const lead = world.leaderAhead(me);
    const closing = lead ? me.v - lead.veh.v : 0;
    return {
      lane: me.targetLane + 1, speed: me.v, target: cruise, limit,
      leader: lead ? {
        name: lead.veh.crashed ? 'wreck' : lead.veh.isStatic ? (lead.veh.type === 'barrier' ? 'road closure' : lead.veh.type === 'debris' ? 'debris' : `stationary ${lead.veh.type}`) : (world.cfg.personalities[lead.veh.label as keyof typeof world.cfg.personalities]?.name ?? lead.veh.label),
        v: lead.veh.v, gap: lead.gap, ttc: closing > 0.3 ? Math.max(lead.gap, 0) / closing : null,
      } : null,
    };
  }

  observe(world: World, me: Vehicle, d: Draft, cruise: number, limit: number, dt: number, signalLead: number | null): void {
    const t = world.time;
    const key = d.accelBy ?? 'none';
    this.ruleTime[key] = (this.ruleTime[key] ?? 0) + dt;
    this.totalTime += dt;

    // ---------------------------------------------------------- speed control
    if (d.accelBy !== this.mode.by) {
      if (this.modeRecord && this.mode.logged) {
        this.modeRecord.outcome = `in control for ${(t - this.mode.since).toFixed(0)} s`;
        this.version++;
      }
      this.mode = { by: d.accelBy, since: t, logged: false };
      this.modeRecord = null;
    }
    if (!this.mode.logged && d.accelBy && t - this.mode.since >= 0.5 && !d.emergency) {
      const props = [...d.accelProposals].sort((a, b) => a.a - b.a);
      const winner = props[0];
      const why: string[] = [];
      if (winner?.why) why.push(winner.why);
      for (const o of props.slice(1, 4)) why.push(`${ruleName(o.by)} would allow ${fmt(o.a)}: less restrictive, so overruled`);
      if (d.clampedBy) why.push(`${ruleName(d.clampedBy)} then limited it to ${fmt(d.accel)}`);
      this.modeRecord = this.add({
        t: this.mode.since, kind: 'speed', title: `Speed: ${ruleName(d.accelBy)} takes control (${fmt(d.accel)})`,
        rules: [d.accelBy, ...(d.clampedBy ? [d.clampedBy] : [])], why,
        snapshot: this.snapshot(world, me, cruise, limit), proposals: d.accelProposals.map((p) => ({ ...p })),
      });
      this.mode.logged = true;
    }

    if (d.emergency && !this.wasEmergency) {
      this.counts.emergencies++;
      const win = [...d.accelProposals].sort((a, b) => a.a - b.a)[0];
      this.add({
        t, kind: 'emergency', title: 'EMERGENCY BRAKE', rules: ['emergency-brake'],
        why: [win?.why ?? 'a collision was imminent'], snapshot: this.snapshot(world, me, cruise, limit),
        proposals: d.accelProposals.map((p) => ({ ...p })), tone: 'bad',
      });
    }
    this.wasEmergency = d.emergency;

    // ------------------------------------------------------------------ lanes
    if (me.changing) {
      if (this.state !== 'moving') {
        if (this.plan) this.plan.outcome = `signalled, then moved after ${(t - this.plan.t).toFixed(1)} s`;
        else {
          this.plan = this.add({
            t, kind: 'lane', title: `Changed lane to ${me.targetLane + 1} without a plan`, rules: [],
            why: ['the lane change was triggered without any rule proposing it'], snapshot: this.snapshot(world, me, cruise, limit),
            proposals: [], tone: 'warn',
          });
        }
        this.state = 'moving';
        this.moveStart = t;
        this.version++;
      }
    } else {
      if (this.state === 'moving') {
        if (this.plan) {
          this.plan.outcome = `completed: now in lane ${me.targetLane + 1} after a ${(t - this.moveStart).toFixed(1)} s move`;
          this.plan.tone = 'good';
          this.counts.completed++;
        }
        this.state = 'idle';
        this.plan = null;
        this.version++;
      }
      if (d.lane !== null) {
        if (this.state === 'idle') {
          const why: string[] = [];
          const prop = d.laneProposals[0];
          if (prop?.why) why.push(prop.why);
          const im = d.check?.impact;
          if (d.check && im) {
            why.push(im.follower
              ? `safe to pull out: would make the ${world.cfg.personalities[im.follower.label as keyof typeof world.cfg.personalities]?.name ?? im.follower.label} driver ${U.dist(Math.max(0, im.followerGap))} behind brake ${U.accel(im.imposedDecel)} (limit ${U.accel(d.check.limit)})`
              : `safe to pull out: nobody close behind in lane ${d.lane + 1}`);
          } else why.push('safety check is switched off: not checking who is behind');
          if (signalLead !== null) why.push(`signalling ${signalLead.toFixed(1)} s before moving so others can react`);
          else why.push('no signal rule: will move without indicating');
          this.plan = this.add({
            t, kind: 'lane', title: `Plan: move to lane ${d.lane + 1} (${ruleName(d.laneBy ?? '')})`,
            rules: [d.laneBy ?? '', ...(d.check ? ['lane-change-safety'] : []), ...(signalLead !== null ? ['signal'] : [])].filter(Boolean),
            why, snapshot: this.snapshot(world, me, cruise, limit), proposals: d.accelProposals.map((p) => ({ ...p })), tone: 'info',
          });
          this.counts.planned++;
          this.state = 'planning';
        }
      } else if (this.state === 'planning' && this.plan) {
        this.plan.outcome = d.vetoBy ? `blocked before moving: ${d.vetoReason}` : 'abandoned: the reason for moving went away';
        this.plan.tone = 'warn';
        this.counts.abandoned++;
        this.state = 'idle';
        this.plan = null;
        this.version++;
      }
    }

    // a lane change that wanted to happen but was vetoed
    if (d.vetoBy && d.laneProposals.length && !me.changing) {
      const prop = d.laneProposals[0];
      const k = `${d.vetoBy}:${prop.lane}`;
      this.vetoClearSince = t;
      if (k !== this.vetoKey) {
        this.vetoKey = k;
        this.counts.blocked++;
        this.add({
          t, kind: 'blocked', title: `Blocked: wanted lane ${prop.lane + 1} (${ruleName(prop.by)})`,
          rules: [prop.by, d.vetoBy], why: [...(prop.why ? [prop.why] : []), `${ruleName(d.vetoBy)} vetoed it: ${d.vetoReason}`],
          snapshot: this.snapshot(world, me, cruise, limit), proposals: d.accelProposals.map((p) => ({ ...p })),
          outcome: 'stayed in lane', tone: 'warn',
        });
      }
    } else if (this.vetoKey && t - this.vetoClearSince > 1) {
      this.vetoKey = null;
    }
  }
}
