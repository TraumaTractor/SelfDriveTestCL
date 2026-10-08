import type { IdmParams } from './idm';
import type { World } from './world';

export type Indicator = -1 | 0 | 1; // +1 = towards higher lane index (overtaking side)

export interface Decision {
  accel: number;
  /** absolute lane to start moving into this tick, or null */
  wantLane: number | null;
  indicator: Indicator;
}

export interface Driver {
  decide(world: World, me: Vehicle, dt: number): Decision;
}

export interface Vehicle {
  id: number;
  kind: 'ego' | 'traffic';
  /** personality id for traffic, 'ego' for the ego car */
  label: string;
  color: string;
  /** longitudinal position of centre (m) */
  s: number;
  /** lateral position in lane units (lane 0 = 0, ramp lane = -1) */
  y: number;
  prevS: number;
  prevY: number;
  v: number;
  a: number;
  length: number;
  width: number;
  /** the lane this vehicle is in, or moving into */
  targetLane: number;
  changing: boolean;
  indicator: Indicator;
  indicatorSince: number;
  /** time the current lane change started */
  changeStart: number;
  onRamp: boolean;
  crashed: boolean;
  crashTime: number;
  /** hints other drivers use to predict this vehicle's behaviour */
  idm: IdmParams;
  v0: number;
  driver: Driver;
}

/** Does vehicle v occupy lane l (physically, or because it is moving into it)? */
export function occupies(v: Vehicle, lane: number): boolean {
  return v.targetLane === lane || Math.abs(v.y - lane) < 0.85;
}

export function bumperGap(rear: Vehicle, front: Vehicle): number {
  return front.s - rear.s - (front.length + rear.length) / 2;
}
