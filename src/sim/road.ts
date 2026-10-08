import { Rng } from './rng';

export interface Ramp {
  start: number;
  end: number;
}

export interface SpeedZone {
  start: number;
  end: number;
  /** m/s */
  limit: number;
}

export interface Road {
  length: number;
  /** Number of main lanes. Lane 0 is the slow (rightmost) lane, higher = faster. */
  lanes: number;
  laneWidth: number;
  /** On-ramps feed an extra acceleration lane (lane index -1) beside lane 0. */
  ramps: Ramp[];
  zones: SpeedZone[];
}

const LIMITS = [33.3, 33.3, 33.3, 27.8, 22.2]; // 120, 120, 120, 100, 80 km/h

export const CONSTANT_LIMIT = 33.3; // 120 km/h

export function generateRoad(rng: Rng, opts: { lanes: number; length: number; variableLimits?: boolean }): Road {
  const { lanes, length } = opts;

  const zones: SpeedZone[] = [];
  let s = 0;
  while (s < length) {
    const len = rng.range(800, 1600);
    const limit = s === 0 ? 33.3 : LIMITS[rng.int(0, LIMITS.length - 1)];
    zones.push({ start: s, end: Math.min(length, s + len), limit });
    s += len;
  }

  // Zones are always drawn from the RNG so the rest of the scenario (ramps, traffic) is identical
  // whether or not variable limits are switched on.
  if (opts.variableLimits === false) {
    zones.length = 0;
    zones.push({ start: 0, end: length, limit: CONSTANT_LIMIT });
  }

  const ramps: Ramp[] = [];
  let r = rng.range(700, 1100);
  while (r + 400 < length - 400) {
    const len = rng.range(280, 420);
    ramps.push({ start: r, end: r + len });
    r += len + rng.range(900, 1500);
  }

  return { length, lanes, laneWidth: 3.6, ramps, zones };
}

/** The road is a loop: position `s` grows forever and the layout repeats every `road.length` metres. */
export function wrapS(road: Road, s: number): number {
  return ((s % road.length) + road.length) % road.length;
}

export function lapOf(road: Road, s: number): number {
  return Math.floor(s / road.length);
}

export function speedLimitAt(road: Road, s: number): number {
  const w = wrapS(road, s);
  for (const z of road.zones) if (w >= z.start && w < z.end) return z.limit;
  return road.zones[road.zones.length - 1].limit;
}

export interface RampInstance {
  /** this lap's copy of the ramp, in absolute positions */
  ramp: Ramp;
  /** index into road.ramps */
  index: number;
}

/** Every copy of every ramp that overlaps [from, to], across laps. */
export function rampInstances(road: Road, from: number, to: number): RampInstance[] {
  const out: RampInstance[] = [];
  for (let lap = Math.floor(from / road.length); lap <= Math.floor(to / road.length); lap++) {
    const off = lap * road.length;
    road.ramps.forEach((r, index) => {
      if (r.end + off >= from && r.start + off <= to) out.push({ ramp: { start: r.start + off, end: r.end + off }, index });
    });
  }
  return out;
}

/** Every copy of every speed zone that overlaps [from, to], across laps. */
export function zoneInstances(road: Road, from: number, to: number): SpeedZone[] {
  const out: SpeedZone[] = [];
  for (let lap = Math.floor(from / road.length); lap <= Math.floor(to / road.length); lap++) {
    const off = lap * road.length;
    for (const z of road.zones) {
      if (z.end + off >= from && z.start + off <= to) out.push({ start: z.start + off, end: z.end + off, limit: z.limit });
    }
  }
  return out;
}

/** The (absolute) ramp we are currently alongside, if any. */
export function rampAt(road: Road, s: number): Ramp | undefined {
  return rampInstances(road, s, s)[0]?.ramp;
}

/** Distance to the start of the next ramp ahead (0 if inside one). */
export function distanceToNextRamp(road: Road, s: number): number {
  let best = Infinity;
  for (const { ramp } of rampInstances(road, s, s + road.length)) {
    if (s >= ramp.start && s <= ramp.end) return 0;
    if (ramp.start >= s) best = Math.min(best, ramp.start - s);
  }
  return best;
}
