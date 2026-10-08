import { clamp } from '../common';
import { TrafficDriver } from '../drivers/trafficDriver';
import {
  PERSONALITIES, PERSONALITY_IDS, clonePersonalities,
  type Personality, type PersonalityId,
} from '../drivers/personality';
import { EgoMetrics } from './metrics';
import { Rng } from './rng';
import { generateRoad, lapOf, rampInstances, speedLimitAt, type Road } from './road';
import { CLEAR, WeatherDrift, conditionsFor, type Conditions, type WeatherConfig } from './weather';
import { bumperGap, occupies, VEHICLE_SPECS, VEHICLE_TYPES, type Decision, type Driver, type TrafficVehicleType, type Vehicle, type VehicleType } from './vehicle';

export interface WorldConfig {
  seed: number;
  lanes: number;
  length: number;
  /** vary the posted speed limit along the road (off = constant 120 km/h) */
  variableLimits: boolean;
  /** vehicles per km per lane */
  density: number;
  /** vehicles per minute joining from each on-ramp */
  rampRate: number;
  /** relative share of each driver personality */
  mix: Record<PersonalityId, number>;
  /** relative share of each kind of vehicle */
  vehicleMix: Record<TrafficVehicleType, number>;
  weather: WeatherConfig;
  personalities: Record<PersonalityId, Personality>;
  egoStart: number;
  /** the road loops forever (laps repeat the same layout); otherwise the run ends after `laps` laps */
  endless: boolean;
  laps: number;
  /** abort a finite run after this many simulated seconds per lap */
  maxTime: number;
}

export function defaultConfig(): WorldConfig {
  return {
    seed: 1,
    lanes: 3,
    length: 6000,
    variableLimits: true,
    density: 10,
    rampRate: 6,
    mix: { great: 3, average: 5, cautious: 2, aggressive: 2, reckless: 1 },
    vehicleMix: { car: 70, van: 12, lorry: 9, motorcycle: 6, coach: 3 },
    weather: { kind: 'clear', intensity: 0.6 },
    personalities: clonePersonalities(),
    egoStart: 300,
    endless: true,
    laps: 1,
    maxTime: 600,
  };
}

export type EventKind =
  | 'collision' | 'nearmiss' | 'cutoff' | 'lanechange' | 'unsignalled' | 'hardbrake' | 'info';
export type Severity = 'good' | 'info' | 'warn' | 'bad';

export interface SimEvent {
  t: number;
  kind: EventKind;
  severity: Severity;
  text: string;
}

export type RunStatus = 'running' | 'finished' | 'crashed' | 'timeout';

export const LANE_CHANGE_TIME = 3.0;
const WINDOW_BEHIND = 800;
const WINDOW_AHEAD = 1500;
const WRECK_LIFETIME = 15;

/** Who tends to be in which lane: [slow lane, middle lanes, fastest lane]. */
const LANE_AFFINITY: Record<PersonalityId, [number, number, number]> = {
  great: [3, 0.6, 0.2],
  average: [1.5, 1.2, 0.8],
  cautious: [1.2, 1.3, 0.6],
  aggressive: [0.5, 1, 2],
  reckless: [0.3, 1, 2.5],
};

export class World {
  readonly cfg: WorldConfig;
  readonly road: Road;
  readonly rng: Rng;
  readonly metrics: EgoMetrics;
  vehicles: Vehicle[] = [];
  ego!: Vehicle;
  time = 0;
  status: RunStatus = 'running';
  events: SimEvent[] = [];
  trafficCollisions = 0;
  trafficUnsignalled = 0;
  /** completed laps of the loop */
  lap = 0;
  /** weather right now: grip, visibility, how sensible drivers adapt */
  conditions: Conditions = CLEAR;
  private drift: WeatherDrift | null = null;
  /** distance at which a finite run ends */
  readonly totalLength: number;

  private laneLists: Vehicle[][] = [];
  private nextId = 1;
  private seedFront = 0;
  private nextLaneSpawn: number[] = [];
  private nextRearSpawn: number[] = [];
  private nextRampSpawn: number[] = [];
  private pendingDecisions = new Map<Vehicle, Decision>();

  constructor(cfg: WorldConfig, egoDriver: Driver) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.road = generateRoad(this.rng, { lanes: cfg.lanes, length: cfg.length, variableLimits: cfg.variableLimits });
    this.metrics = new EgoMetrics();
    this.totalLength = cfg.endless ? Infinity : cfg.length * Math.max(1, cfg.laps);
    this.initWeather();

    const egoLane = Math.min(1, cfg.lanes - 1);
    const ego = this.makeVehicle('ego', 'Ego', '#35e0ff', 'car', cfg.egoStart, egoLane, speedLimitAt(this.road, cfg.egoStart), egoDriver);
    ego.idm = { a: 1.5, b: 2, T: 1.5, s0: 2 };
    this.ego = ego;
    this.vehicles.push(ego);

    this.seedFront = Math.max(0, cfg.egoStart - WINDOW_BEHIND);
    this.seedUpTo(cfg.egoStart + WINDOW_AHEAD);
    for (let l = 0; l < cfg.lanes; l++) {
      this.nextLaneSpawn.push(0);
      this.nextRearSpawn.push(this.rng.range(2, 10));
    }
    for (let r = 0; r < this.road.ramps.length; r++) this.nextRampSpawn.push(this.rng.range(2, 8));
    this.rebuildIndex();
    this.log('info', 'info', `Run started (seed ${cfg.seed})`);
  }

  // ---------------------------------------------------------------- queries

  /** Vehicles currently occupying `lane`, sorted by s. */
  vehiclesInLane(lane: number): readonly Vehicle[] {
    return this.laneLists[lane + 1] ?? [];
  }

  leaderIn(me: Vehicle, lane: number): { veh: Vehicle; gap: number } | null {
    const list = this.vehiclesInLane(lane);
    let i = lowerBound(list, me.s);
    for (; i < list.length; i++) {
      const e = list[i];
      if (e === me) continue;
      if (e.s > me.s || (e.s === me.s && e.id > me.id)) return { veh: e, gap: bumperGap(me, e) };
    }
    return null;
  }

  followerIn(me: Vehicle, lane: number): { veh: Vehicle; gap: number } | null {
    const list = this.vehiclesInLane(lane);
    for (let i = lowerBound(list, me.s) - 1; i >= 0; i--) {
      const e = list[i];
      if (e === me) continue;
      if (e.s < me.s || (e.s === me.s && e.id < me.id)) return { veh: e, gap: bumperGap(e, me) };
    }
    return null;
  }

  /** Nearest vehicle ahead among all lanes `me` currently occupies. */
  leaderAhead(me: Vehicle): { veh: Vehicle; gap: number } | null {
    let best: { veh: Vehicle; gap: number } | null = null;
    const lo = Math.max(-1, Math.floor(me.y)), hi = Math.min(this.cfg.lanes - 1, Math.ceil(me.y));
    for (let l = lo; l <= hi; l++) {
      if (!occupies(me, l)) continue;
      const c = this.leaderIn(me, l);
      if (c && (!best || c.gap < best.gap)) best = c;
    }
    return best;
  }

  /** Nearest vehicle ahead that physically overlaps `me`'s lateral corridor (+margin metres). */
  corridorLeader(me: Vehicle, margin = 0.4): { veh: Vehicle; gap: number } | null {
    let best: { veh: Vehicle; gap: number } | null = null;
    const lo = Math.max(-1, Math.floor(me.y) - 1), hi = Math.min(this.cfg.lanes - 1, Math.ceil(me.y) + 1);
    for (let l = lo; l <= hi; l++) {
      const list = this.vehiclesInLane(l);
      for (let i = lowerBound(list, me.s); i < list.length; i++) {
        const e = list[i];
        if (e === me || e.s <= me.s) continue;
        if (this.lateralGap(me, e) > margin) continue;
        const gap = bumperGap(me, e);
        if (!best || gap < best.gap) best = { veh: e, gap };
        break;
      }
    }
    return best;
  }

  /** Free lateral space (m) between the bodies of two vehicles; <=0 means overlapping. */
  lateralGap(a: Vehicle, b: Vehicle): number {
    return Math.abs(a.y - b.y) * this.road.laneWidth - (a.width + b.width) / 2;
  }

  // ------------------------------------------------------------------- step

  step(dt: number): void {
    if (this.status !== 'running') return;

    this.maintainPopulation(dt);
    this.rebuildIndex();

    this.updateWeather(dt);

    // 1. everyone decides from the same snapshot
    this.pendingDecisions.clear();
    for (const v of this.vehicles) {
      if (v.crashed) continue;
      this.pendingDecisions.set(v, v.driver.decide(this, v, dt));
    }

    // 2. apply
    this.time += dt;
    for (const v of this.vehicles) {
      v.prevS = v.s;
      v.prevY = v.y;
      if (v.crashed) continue;
      this.apply(v, this.pendingDecisions.get(v)!, dt);
    }

    this.rebuildIndex();
    this.detectCollisions();
    this.metrics.update(this, dt);
    this.cleanup();

    const lap = lapOf(this.road, this.ego.s);
    if (lap > this.lap) {
      this.lap = lap;
      this.log('info', 'good', `Lap ${lap} complete`);
    }

    const ego = this.ego;
    if (ego.crashed) this.status = 'crashed';
    else if (ego.s >= this.totalLength - 20) {
      this.status = 'finished';
      this.log('info', 'good', 'Reached the end of the motorway');
    } else if (!this.cfg.endless && this.time >= this.cfg.maxTime * Math.max(1, this.cfg.laps)) {
      this.status = 'timeout';
      this.log('info', 'warn', 'Run timed out');
    }
  }

  private apply(v: Vehicle, d: Decision, dt: number): void {
    // lane change start
    if (d.wantLane !== null && !v.changing && Math.abs(d.wantLane - v.targetLane) === 1
        && d.wantLane >= 0 && d.wantLane < this.cfg.lanes && !this.laneChangeBlocked(v, d.wantLane)) {
      const dir = Math.sign(d.wantLane - v.targetLane);
      const signalled = v.indicator === dir && this.time - v.indicatorSince >= 0.8;
      v.changing = true;
      v.changeStart = this.time;
      const from = v.targetLane;
      v.targetLane = d.wantLane;
      this.metrics.onLaneChangeStart(this, v, from, d.wantLane, signalled);
      if (v !== this.ego && !signalled) this.trafficUnsignalled++;
    }

    if (d.indicator !== v.indicator) {
      v.indicator = d.indicator;
      v.indicatorSince = this.time;
    }

    // longitudinal
    // grip limits what the tyres can do: wet or icy roads mean longer stopping distances
    const g = this.conditions.grip;
    const a = clamp(d.accel, -10 * g, 5 * Math.max(g, 0.4));
    let v1 = v.v + a * dt;
    if (v1 < 0) v1 = 0;
    v.a = (v1 - v.v) / dt;
    v.s += ((v.v + v1) / 2) * dt;
    v.v = v1;

    // ramp end barrier
    if (v.onRamp && !v.changing) {
      const ramp = rampInstances(this.road, v.s - 20, v.s + 20)[0]?.ramp;
      if (ramp && v.s > ramp.end - v.length / 2) {
        v.s = ramp.end - v.length / 2;
        v.v = 0;
        v.a = 0;
      }
    }

    // lateral
    if (v.changing) {
      const dir = Math.sign(v.targetLane - v.y);
      v.y += (dir * dt) / LANE_CHANGE_TIME;
      if (Math.abs(v.targetLane - v.y) < (dt / LANE_CHANGE_TIME) * 0.5 + 1e-9 || Math.sign(v.targetLane - v.y) !== dir) {
        v.y = v.targetLane;
        v.changing = false;
        v.onRamp = false;
        this.metrics.onLaneChangeEnd(this, v);
      }
    }
  }

  /** Last-moment check: two cars deciding in the same tick must not merge into the same space. */
  private laneChangeBlocked(v: Vehicle, target: number): boolean {
    for (const o of this.vehicles) {
      if (o === v) continue;
      if (o.targetLane !== target && Math.abs(o.y - target) >= 0.85) continue;
      if (Math.abs(o.s - v.s) < (o.length + v.length) / 2 + 1.5) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ weather

  private initWeather(): void {
    const w = this.cfg.weather ?? { kind: 'clear', intensity: 0 };
    if (w.kind === 'variable') {
      // own random stream, so the weather never disturbs the traffic for a given seed
      const r = new Rng((this.cfg.seed ^ 0x9e3779b9) >>> 0);
      this.drift = new WeatherDrift(() => r.next());
      this.conditions = this.drift.conditions();
    } else {
      this.conditions = w.kind === 'clear' ? CLEAR : conditionsFor(w.kind, w.intensity);
    }
  }

  private updateWeather(dt: number): void {
    if (!this.drift) return;
    this.drift.step(dt);
    this.conditions = this.drift.conditions();
  }

  // ------------------------------------------------------------ bookkeeping

  private rebuildIndex(): void {
    const n = this.cfg.lanes + 1;
    if (this.laneLists.length !== n) this.laneLists = Array.from({ length: n }, () => []);
    for (const l of this.laneLists) l.length = 0;
    for (const v of this.vehicles) {
      for (let l = -1; l < this.cfg.lanes; l++) if (occupies(v, l)) this.laneLists[l + 1].push(v);
    }
    for (const l of this.laneLists) l.sort((a, b) => a.s - b.s || a.id - b.id);
  }

  private detectCollisions(): void {
    const half = 0.05;
    for (const list of this.laneLists) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length && j <= i + 3; j++) {
          const b = list[j];
          if (b.s - a.s >= (a.length + b.length) / 2) break;
          if (a.crashed && b.crashed) continue;
          if (this.lateralGap(a, b) > -half) continue;
          this.crash(a, b);
        }
      }
    }
  }

  private crash(a: Vehicle, b: Vehicle): void {
    for (const v of [a, b]) {
      if (v.crashed) continue;
      v.crashed = true;
      v.crashTime = this.time;
      v.v = 0;
      v.a = 0;
      v.indicator = 0;
    }
    if (a === this.ego || b === this.ego) {
      const other = a === this.ego ? b : a;
      this.metrics.collisions++;
      this.log('collision', 'bad', `Ego collided with a ${other.label} vehicle`);
    } else {
      this.trafficCollisions++;
      this.log('collision', 'warn', `Traffic collision: ${a.label} / ${b.label}`);
    }
  }

  private cleanup(): void {
    const egoS = this.ego.s;
    this.vehicles = this.vehicles.filter((v) => {
      if (v === this.ego) return true;
      if (v.crashed && this.time - v.crashTime > WRECK_LIFETIME) return false;
      return v.s > egoS - WINDOW_BEHIND && v.s < egoS + WINDOW_AHEAD + 600 && v.s < this.totalLength + 50;
    });
  }

  private maintainPopulation(dt: number): void {
    const { cfg } = this;
    // front: seed fresh traffic as the horizon advances
    this.seedUpTo(this.ego.s + WINDOW_AHEAD);

    // rear: occasional faster vehicles catching up from behind
    const flow = (cfg.density / 1000) * 5; // veh/s/lane
    for (let l = 0; l < cfg.lanes; l++) {
      this.nextRearSpawn[l] -= dt;
      if (this.nextRearSpawn[l] > 0) continue;
      const s = this.ego.s - WINDOW_BEHIND + 20;
      if (s < 0) { this.nextRearSpawn[l] = 1; continue; }
      this.nextRearSpawn[l] = this.rng.exp(1 / Math.max(flow, 1e-3));
      const id = this.pickPersonality(l);
      const p = cfg.personalities[id];
      const v0 = speedLimitAt(this.road, s) * p.speedFactor;
      const v = Math.min(v0, this.ego.v + this.rng.range(1, 8));
      this.trySpawn(id, s, l, v);
    }

    // on-ramps (only while the ego is approaching, to save work)
    for (const { ramp, index: i } of rampInstances(this.road, this.ego.s - 100, this.ego.s + 1000)) {
      if (this.ego.s < ramp.start - 900 || this.ego.s > ramp.end) continue;
      this.nextRampSpawn[i] -= dt;
      if (this.nextRampSpawn[i] > 0) continue;
      const busy = (this.laneLists[0] ?? []).some((e) => Math.abs(e.s - (ramp.start + 5)) < 28);
      if (busy) { this.nextRampSpawn[i] = 1; continue; }
      this.nextRampSpawn[i] = this.rng.exp(60 / Math.max(cfg.rampRate, 0.01));
      const id = this.rng.weighted(cfg.mix);
      const v = this.trySpawn(id, ramp.start + 5, -1, Math.min(22, speedLimitAt(this.road, ramp.start) * 0.8));
      if (v) v.onRamp = true;
    }
  }

  /** Pick a driver type, biased by lane so good drivers start in the slow lane and bad ones in the fast lanes. */
  private pickPersonality(lane: number): PersonalityId {
    const k = lane <= 0 ? 0 : lane >= this.cfg.lanes - 1 ? 2 : 1;
    const w = {} as Record<PersonalityId, number>;
    for (const id of PERSONALITY_IDS) w[id] = this.cfg.mix[id] * LANE_AFFINITY[id][k];
    return this.rng.weighted(w);
  }

  private seedUpTo(frontier: number): void {
    const { cfg } = this;
    const target = Math.min(frontier, this.totalLength);
    while (this.seedFront < target) {
      const blockStart = this.seedFront;
      const blockEnd = Math.min(blockStart + 100, this.totalLength);
      for (let l = 0; l < cfg.lanes; l++) {
        // the slow lane is busier than the fast lane, as on a real motorway
        const laneDensity = cfg.density * (l === 0 ? 1.2 : l === cfg.lanes - 1 ? 0.8 : 1.0);
        const meanSpacing = 1000 / Math.max(laneDensity, 0.5);
        // everyone starts at a similar, safe lane speed so the initial state is collision-free
        const laneSpeedFactor = 0.78 + 0.09 * l;
        let s = blockStart + this.rng.exp(meanSpacing * 0.5) + 6;
        while (s < blockEnd) {
          const id = this.pickPersonality(l);
          const p = cfg.personalities[id];
          const limit = speedLimitAt(this.road, s);
          const v = Math.min(limit * p.speedFactor, limit * laneSpeedFactor) * this.rng.range(0.95, 1.0);
          const nearEgo = this.ego && l === this.ego.targetLane && Math.abs(s - this.ego.s) < 60;
          if (!nearEgo) this.trySpawn(id, s, l, v);
          const minSpacing = 25 + v * 1.1;
          s += minSpacing + this.rng.exp(Math.max(5, meanSpacing - minSpacing));
        }
      }
      this.seedFront = blockEnd;
      if (blockEnd >= this.totalLength) break;
    }
  }

  /** Pick a kind of vehicle; heavy ones are kept out of the fastest lane on 3+ lane roads. */
  private pickVehicleType(lane: number): VehicleType {
    const w = {} as Record<TrafficVehicleType, number>;
    for (const t of VEHICLE_TYPES) w[t] = VEHICLE_SPECS[t].heavy && lane > this.maxHeavyLane() ? 0 : this.cfg.vehicleMix[t] ?? 0;
    return this.rng.weighted(w);
  }

  private maxHeavyLane(): number {
    return this.cfg.lanes >= 3 ? this.cfg.lanes - 2 : this.cfg.lanes - 1;
  }

  private trySpawn(id: PersonalityId, s: number, lane: number, v: number): Vehicle | null {
    const type = this.pickVehicleType(lane);
    const spec = VEHICLE_SPECS[type];
    // refuse if it would overlap an existing vehicle
    for (const e of this.vehicles) {
      if (Math.abs(e.s - s) < Math.max(12, (e.length + spec.length) / 2 + 6) && (Math.abs(e.y - lane) < 0.9 || e.targetLane === lane)) return null;
    }
    const p = this.cfg.personalities[id];
    const maxLane = spec.heavy ? this.maxHeavyLane() : this.cfg.lanes - 1;
    const driver = new TrafficDriver(p, this.rng.fork(), spec, maxLane);
    const veh = this.makeVehicle('traffic', id, p.color, type, s, lane, Math.min(v, spec.maxSpeed * 0.97), driver);
    veh.onRamp = lane < 0;
    veh.idm = { a: p.accel * spec.accelScale, b: p.decel * spec.brakeScale, T: p.headway * spec.headwayScale, s0: p.minGap };
    this.vehicles.push(veh);
    return veh;
  }

  private makeVehicle(kind: 'ego' | 'traffic', label: string, color: string, type: VehicleType, s: number, lane: number, v: number, driver: Driver): Vehicle {
    const spec = VEHICLE_SPECS[type];
    return {
      id: this.nextId++, kind, type, label, color,
      s, y: lane, prevS: s, prevY: lane, v, a: 0,
      length: spec.length, width: spec.width,
      targetLane: lane, changing: false, indicator: 0, indicatorSince: 0, changeStart: 0,
      onRamp: false, crashed: false, crashTime: 0, isStatic: false, hazard: false,
      idm: { a: 1.5, b: 2, T: 1.5, s0: 2 }, v0: speedLimitAt(this.road, s),
      driver,
    };
  }

  log(kind: EventKind, severity: Severity, text: string): void {
    this.events.push({ t: this.time, kind, severity, text });
    if (this.events.length > 500) this.events.shift();
  }
}

function lowerBound(list: readonly Vehicle[], s: number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export { PERSONALITIES, PERSONALITY_IDS };
