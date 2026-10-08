import type { EgoReport } from './ego/egoDriver';
import { PERSONALITY_IDS, type PersonalityId } from './drivers/personality';
import { SIM_DT } from './sim/headless';
import type { Conditions } from './sim/weather';
import { ALL_VEHICLE_TYPES, VEHICLE_SPECS, type Driver, type Vehicle } from './sim/vehicle';
import { World, type RunStatus, type Works } from './sim/world';

/** Numbers shown in the tiles - recorded with each frame so a replay shows what you saw at the time. */
export interface MetricSnap {
  time: number;
  lap: number;
  distance: number;
  avgSpeed: number;
  nearMisses: number;
  hardBrakes: number;
  laneChanges: number;
  unsignalled: number;
  cutOffs: number;
  collisions: number;
  score: number;
}

export function snapshotMetrics(w: World): MetricSnap {
  const m = w.metrics;
  return {
    time: w.time, lap: w.lap, distance: m.distance, avgSpeed: m.avgSpeed, nearMisses: m.nearMisses, hardBrakes: m.hardBrakes,
    laneChanges: m.laneChanges, unsignalled: m.unsignalledChanges, cutOffs: m.cutOffs, collisions: m.collisions,
    score: m.scores(w.status === 'crashed').overall,
  };
}

export interface Frame {
  t: number;
  lap: number;
  status: RunStatus;
  conditions: Conditions;
  works: Works[];
  n: number;
  /** n × K floats, see K and the flag bits below */
  data: Float32Array;
  report: EgoReport | null;
  m: MetricSnap;
}

// per-vehicle layout
const K = 10; // id, typeIdx, labelIdx, s, y, v, a, flags, indicator, targetLane
const CHANGING = 1, CRASHED = 2, ON_RAMP = 4, STATIC = 8, HAZARD = 16, IS_EGO = 32;

/** Records the run at 10 Hz into a rolling buffer so it can be replayed. */
export class Recorder {
  private frames: Frame[] = [];
  private tick = 0;

  constructor(public seconds = 180, private readonly every = 2) {}

  clear(): void {
    this.frames = [];
    this.tick = 0;
  }

  get length(): number { return this.frames.length; }
  get start(): number { return this.frames.length ? this.frames[0].t : 0; }
  get end(): number { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }

  /** Call once per simulation step. `force` records regardless of the sampling rate (final state). */
  record(w: World, report: EgoReport | null, force = false): void {
    this.tick++;
    if (!force && this.tick % this.every) return;
    const vs = w.vehicles;
    const data = new Float32Array(vs.length * K);
    vs.forEach((v, i) => {
      const o = i * K;
      data[o] = v.id;
      data[o + 1] = ALL_VEHICLE_TYPES.indexOf(v.type);
      data[o + 2] = PERSONALITY_IDS.indexOf(v.label as PersonalityId);
      data[o + 3] = v.s;
      data[o + 4] = v.y;
      data[o + 5] = v.v;
      data[o + 6] = v.a;
      data[o + 7] = (v.changing ? CHANGING : 0) | (v.crashed ? CRASHED : 0) | (v.onRamp ? ON_RAMP : 0) | (v.isStatic ? STATIC : 0) | (v.hazard ? HAZARD : 0) | (v === w.ego ? IS_EGO : 0);
      data[o + 8] = v.indicator;
      data[o + 9] = v.targetLane;
    });
    const last = this.frames[this.frames.length - 1];
    if (last && last.t === w.time) this.frames.pop();
    this.frames.push({ t: w.time, lap: w.lap, status: w.status, conditions: w.conditions, works: w.works, n: vs.length, data, report, m: snapshotMetrics(w) });
    const cap = Math.ceil(this.seconds / (SIM_DT * this.every));
    if (this.frames.length > cap) this.frames.splice(0, this.frames.length - cap);
  }

  /** The two frames around time t and how far between them (0..1). */
  sample(t: number): { a: Frame; b: Frame; alpha: number } | null {
    const f = this.frames;
    if (!f.length) return null;
    if (t <= f[0].t) return { a: f[0], b: f[0], alpha: 1 };
    if (t >= f[f.length - 1].t) return { a: f[f.length - 1], b: f[f.length - 1], alpha: 1 };
    let lo = 0, hi = f.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid; else hi = mid;
    }
    const span = f[hi].t - f[lo].t || 1;
    return { a: f[lo], b: f[hi], alpha: (t - f[lo].t) / span };
  }

  /** Time of the frame `n` steps (of 0.1 s) away from t. */
  stepFrom(t: number, n: number): number {
    const f = this.frames;
    if (!f.length) return t;
    let i = 0;
    while (i < f.length - 1 && f[i + 1].t <= t + 1e-6) i++;
    return f[Math.max(0, Math.min(f.length - 1, i + n))].t;
  }

  contains(t: number): boolean {
    return this.frames.length > 0 && t >= this.start - 1e-6 && t <= this.end + 1e-6;
  }
}

const NOOP: Driver = { decide: () => ({ accel: 0, wantLane: null, indicator: 0 }) };
const IDM_DEFAULT = { a: 1.5, b: 2, T: 1.5, s0: 2 };

/** Shows recorded frames through the ordinary renderers by loading them into a separate World. */
export class Replayer {
  readonly world: World;

  constructor(live: World) {
    const cfg = { ...live.cfg, endless: true, weather: { kind: 'clear' as const, intensity: 0 }, hazards: { ...live.cfg.hazards, rate: 0 } };
    this.world = new World(cfg, NOOP);
    (this.world as unknown as { road: unknown }).road = live.road; // the very same road the run used
    this.world.cfg.personalities = live.cfg.personalities;
  }

  private decode(frame: Frame, prev: Map<number, { s: number; y: number }> | null): Vehicle[] {
    const out: Vehicle[] = [];
    const personalities = this.world.cfg.personalities;
    for (let i = 0; i < frame.n; i++) {
      const o = i * K, d = frame.data;
      const type = ALL_VEHICLE_TYPES[d[o + 1]];
      const spec = VEHICLE_SPECS[type];
      const flags = d[o + 7];
      const li = d[o + 2];
      const label = flags & IS_EGO ? 'Ego' : li >= 0 ? PERSONALITY_IDS[li] : 'hazard';
      const isStatic = !!(flags & STATIC);
      const color = flags & IS_EGO ? '#35e0ff' : li >= 0 ? personalities[PERSONALITY_IDS[li]].color : type === 'debris' ? '#8b7355' : type === 'barrier' ? '#e8452c' : '#cfd5dd';
      const id = d[o];
      const p = prev?.get(id);
      out.push({
        id, kind: flags & IS_EGO ? 'ego' : 'traffic', type, label, color,
        s: d[o + 3], y: d[o + 4], prevS: p ? p.s : d[o + 3], prevY: p ? p.y : d[o + 4], v: d[o + 5], a: d[o + 6],
        length: spec.length, width: spec.width, targetLane: d[o + 9], changing: !!(flags & CHANGING),
        indicator: d[o + 8] as -1 | 0 | 1, indicatorSince: 0, changeStart: 0, onRamp: !!(flags & ON_RAMP),
        crashed: !!(flags & CRASHED), crashTime: 0, isStatic, hazard: !!(flags & HAZARD),
        idm: IDM_DEFAULT, v0: 0, driver: NOOP,
      });
    }
    return out;
  }

  /** Load the state at time t. Returns the sub-frame fraction for the renderers' interpolation. */
  show(a: Frame, b: Frame, alpha: number): number {
    const prev = new Map<number, { s: number; y: number }>();
    for (let i = 0; i < a.n; i++) prev.set(a.data[i * K], { s: a.data[i * K + 3], y: a.data[i * K + 4] });
    const vehicles = this.decode(b, a === b ? null : prev);
    const ego = vehicles.find((v) => v.kind === 'ego') ?? vehicles[0];
    this.world.loadReplay({
      time: a.t + (b.t - a.t) * alpha, lap: b.lap, status: b.status, conditions: b.conditions, works: b.works, vehicles, ego,
    });
    return alpha;
  }
}
