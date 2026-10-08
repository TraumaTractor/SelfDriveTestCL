export interface IdmParams {
  /** max acceleration m/s² */
  a: number;
  /** comfortable deceleration m/s² */
  b: number;
  /** desired time headway s */
  T: number;
  /** minimum bumper gap m */
  s0: number;
}

/**
 * Intelligent Driver Model acceleration.
 * gap = bumper-to-bumper distance to leader (Infinity = none), dv = v - vLeader (closing speed).
 */
export function idm(p: IdmParams, v: number, v0: number, gap: number, dv: number): number {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (!Number.isFinite(gap)) return p.a * free;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const g = Math.max(gap, 0.1);
  return p.a * (free - (sStar / g) * (sStar / g));
}
