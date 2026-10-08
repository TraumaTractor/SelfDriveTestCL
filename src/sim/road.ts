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

export function speedLimitAt(road: Road, s: number): number {
  for (const z of road.zones) if (s >= z.start && s < z.end) return z.limit;
  return road.zones[road.zones.length - 1].limit;
}

export function rampAt(road: Road, s: number): Ramp | undefined {
  for (const r of road.ramps) if (s >= r.start && s <= r.end) return r;
  return undefined;
}

/** Distance to the start of the next ramp ahead (or Infinity). Negative-free. */
export function distanceToNextRamp(road: Road, s: number): number {
  let best = Infinity;
  for (const r of road.ramps) {
    const d = r.start - s;
    if (d >= 0 && d < best) best = d;
    else if (s >= r.start && s <= r.end) return 0;
  }
  return best;
}
