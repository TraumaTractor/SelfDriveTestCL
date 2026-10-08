import type { IdmParams } from './idm';
import type { World } from './world';

export type TrafficVehicleType = 'car' | 'van' | 'lorry' | 'motorcycle' | 'coach';
/** Traffic plus the static things that can be in the road. */
export type VehicleType = TrafficVehicleType | 'debris' | 'barrier';

export interface VehicleSpec {
  /** word used when describing it ("a lorry ahead") */
  noun: string;
  label: string;
  length: number;
  width: number;
  /** body height in metres (used by the dashcam) */
  height: number;
  /** kg */
  mass: number;
  /** top speed in m/s (lorries and coaches are speed limited) */
  maxSpeed: number;
  /** heavy vehicles may not use the fastest lane of a motorway with 3+ lanes */
  heavy: boolean;
  /** how it accelerates / brakes / follows compared with the driver's own style */
  accelScale: number;
  brakeScale: number;
  headwayScale: number;
}

export const VEHICLE_TYPES: TrafficVehicleType[] = ['car', 'van', 'lorry', 'motorcycle', 'coach'];
export const ALL_VEHICLE_TYPES: VehicleType[] = [...VEHICLE_TYPES, 'debris', 'barrier'];

export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  car: { noun: 'car', label: 'Car', length: 4.5, width: 1.9, height: 1.45, mass: 1500, maxSpeed: Infinity, heavy: false, accelScale: 1, brakeScale: 1, headwayScale: 1 },
  van: { noun: 'van', label: 'Van', length: 5.4, width: 2.0, height: 2.1, mass: 2600, maxSpeed: Infinity, heavy: false, accelScale: 0.8, brakeScale: 0.9, headwayScale: 1.1 },
  lorry: { noun: 'lorry', label: 'Lorry', length: 13.5, width: 2.55, height: 4.0, mass: 22000, maxSpeed: 25, heavy: true, accelScale: 0.4, brakeScale: 0.7, headwayScale: 1.4 },
  motorcycle: { noun: 'motorcycle', label: 'Motorcycle', length: 2.1, width: 0.8, height: 1.5, mass: 300, maxSpeed: Infinity, heavy: false, accelScale: 1.7, brakeScale: 1.2, headwayScale: 0.75 },
  debris: { noun: 'debris', label: 'Debris', length: 0.9, width: 0.9, height: 0.35, mass: 30, maxSpeed: 0, heavy: false, accelScale: 1, brakeScale: 1, headwayScale: 1 },
  barrier: { noun: 'road closure', label: 'Road closure', length: 1.2, width: 3.3, height: 1.1, mass: 2000, maxSpeed: 0, heavy: false, accelScale: 1, brakeScale: 1, headwayScale: 1 },
  coach: { noun: 'coach', label: 'Coach', length: 12, width: 2.5, height: 3.5, mass: 13000, maxSpeed: 28, heavy: true, accelScale: 0.5, brakeScale: 0.75, headwayScale: 1.3 },
};

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
  type: VehicleType;
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
  /** something that stays where it is: debris, a closure barrier or a broken-down vehicle */
  isStatic: boolean;
  /** hazard warning lights on (broken-down vehicles) */
  hazard: boolean;
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
