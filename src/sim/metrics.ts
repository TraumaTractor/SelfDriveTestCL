import { clamp } from '../common';
import { speedLimitAt } from './road';
import type { Vehicle } from './vehicle';
import type { World } from './world';

export interface Scores {
  safety: number;
  comfort: number;
  efficiency: number;
  courtesy: number;
  overall: number;
}

interface CutoffWatch {
  followerId: number;
  until: number;
}

export class EgoMetrics {
  time = 0;
  distance = 0;
  collisions = 0;
  nearMisses = 0;
  hardBrakes = 0;
  unsignalledChanges = 0;
  laneChanges = 0;
  cutOffs = 0;
  tailgateSeconds = 0;
  maxDecel = 0;
  minTtc = Infinity;
  private jerkSq = 0;
  private limitTime = 0;
  private prevA = 0;
  private nearMissCooldown = 0;
  private hardBrakeLatch = false;
  private hardBrakeCooldown = 0;
  private watches: CutoffWatch[] = [];

  get avgSpeed(): number {
    return this.time > 0 ? this.distance / this.time : 0;
  }

  get rmsJerk(): number {
    return this.time > 0 ? Math.sqrt(this.jerkSq / this.time) : 0;
  }

  update(world: World, dt: number): void {
    const ego = world.ego;
    this.time += dt;
    this.distance += ego.v * dt;
    this.limitTime += speedLimitAt(world.road, ego.s) * dt;

    const jerk = (ego.a - this.prevA) / dt;
    this.jerkSq += jerk * jerk * dt;
    this.prevA = ego.a;
    this.maxDecel = Math.max(this.maxDecel, -ego.a);

    // hard braking (latched so one stop counts once)
    this.hardBrakeCooldown -= dt;
    if (ego.a < -4) {
      if (!this.hardBrakeLatch && this.hardBrakeCooldown <= 0) {
        this.hardBrakeLatch = true;
        this.hardBrakeCooldown = 2;
        this.hardBrakes++;
        world.log('hardbrake', 'warn', `Hard braking (${(-ego.a).toFixed(1)} m/s²)`);
      }
    } else if (ego.a > -1.5) this.hardBrakeLatch = false;

    // near misses & tailgating relative to whatever is physically in front
    this.nearMissCooldown -= dt;
    const lead = world.corridorLeader(ego);
    if (lead && !ego.crashed) {
      const closing = ego.v - lead.veh.v;
      if (closing > 0.5) {
        const ttc = Math.max(lead.gap, 0) / closing;
        this.minTtc = Math.min(this.minTtc, ttc);
        if (ttc < 1.5 && lead.gap < 25 && this.nearMissCooldown <= 0) {
          this.nearMisses++;
          this.nearMissCooldown = 3;
          world.log('nearmiss', 'bad', `Near miss: TTC ${ttc.toFixed(1)}s, gap ${lead.gap.toFixed(1)}m`);
        }
      }
      if (ego.v > 8 && lead.gap / ego.v < 0.7) this.tailgateSeconds += dt;
    }

    // did someone have to brake hard because of an ego lane change?
    this.watches = this.watches.filter((w) => {
      const f = world.vehicles.find((v) => v.id === w.followerId);
      if (!f) return false;
      if (f.a <= -4 || (f.crashed && world.time - f.crashTime < 1)) {
        this.cutOffs++;
        world.log('cutoff', 'bad', `Cut off a ${f.label} driver (they braked ${(-f.a).toFixed(1)} m/s²)`);
        return false;
      }
      return world.time < w.until;
    });
  }

  onLaneChangeStart(world: World, v: Vehicle, from: number, to: number, signalled: boolean): void {
    if (v !== world.ego) return;
    this.laneChanges++;
    if (!signalled) {
      this.unsignalledChanges++;
      world.log('unsignalled', 'warn', `Changed lane ${from}→${to} without signalling`);
    } else {
      world.log('lanechange', 'info', `Lane change ${from}→${to}`);
    }
    const f = world.followerIn(v, to);
    if (f && f.veh !== v && f.gap < 60) this.watches.push({ followerId: f.veh.id, until: world.time + 4 });
  }

  onLaneChangeEnd(_world: World, _v: Vehicle): void {
    /* reserved for future use */
  }

  scores(crashed: boolean): Scores {
    const safety = crashed || this.collisions > 0
      ? 0
      : clamp(100 - 12 * this.nearMisses - 1.0 * this.tailgateSeconds, 0, 100);
    const comfort = clamp(100 - 4 * this.hardBrakes - 8 * this.rmsJerk, 0, 100);
    const avgLimit = this.time > 0 ? this.limitTime / this.time : 1;
    const efficiency = clamp((this.avgSpeed / (0.92 * avgLimit)) * 100, 0, 100);
    const courtesy = clamp(100 - 10 * this.unsignalledChanges - 15 * this.cutOffs, 0, 100);
    const overall = crashed || this.collisions > 0
      ? 0
      : 0.45 * safety + 0.15 * comfort + 0.25 * efficiency + 0.15 * courtesy;
    return { safety, comfort, efficiency, courtesy, overall };
  }
}
