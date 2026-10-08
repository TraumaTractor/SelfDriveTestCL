import { idm } from './idm';
import { bumperGap, type Vehicle } from './vehicle';
import type { World } from './world';

/** Gap (m) we try to keep as a last-ditch margin when working out how hard someone must brake. */
const STANDOFF = 1.0;

/**
 * Constant deceleration (m/s²) needed for `closing` (m/s, >0 means approaching) to reach zero
 * before the gap shrinks to the standoff distance. Zero if not approaching.
 */
export function brakingNeeded(closing: number, gap: number): number {
  if (closing <= 0) return 0;
  return (closing * closing) / (2 * Math.max(gap - STANDOFF, 0.1));
}

export interface MergeImpact {
  target: number;
  /** vehicle that ends up directly behind us in the target lane */
  follower: Vehicle | null;
  followerGap: number;
  /** speed of the follower relative to us (m/s, + = they are faster) */
  followerClosing: number;
  /**
   * How much harder (m/s²) the follower has to brake because we pull in front of them.
   * Driven by closing speed first: a fast approaching car is affected even at a "safe" distance,
   * while someone crawling behind us barely is, even when we are close.
   */
  imposedDecel: number;
  /** vehicle directly ahead of us in the target lane */
  leader: Vehicle | null;
  leaderGap: number;
  /** braking WE need to match the new leader */
  selfDecel: number;
}

export function mergeImpact(world: World, me: Vehicle, target: number): MergeImpact {
  const lead = world.leaderIn(me, target);
  const fol = world.followerIn(me, target);

  let imposed = 0;
  let closing = 0;
  if (fol) {
    const f = fol.veh;
    closing = f.v - me.v;
    const kinematic = brakingNeeded(closing, fol.gap);

    // Comfort: a driver following at speed also wants their usual time headway back. That matters
    // less the slower they are going - someone crawling doesn't care much about a short gap.
    const v0 = Math.max(f.v0, f.v);
    const before = lead
      ? idm(f.idm, f.v, v0, bumperGap(f, lead.veh), f.v - lead.veh.v)
      : idm(f.idm, f.v, v0, Infinity, 0);
    const after = idm(f.idm, f.v, v0, fol.gap, closing);
    const weight = Math.min(1, Math.max(0, (f.v - 2) / 10)) * 0.5;
    imposed = Math.max(kinematic, weight * Math.max(0, before - after));
  }

  return {
    target,
    follower: fol?.veh ?? null,
    followerGap: fol?.gap ?? Infinity,
    followerClosing: closing,
    imposedDecel: imposed,
    leader: lead?.veh ?? null,
    leaderGap: lead?.gap ?? Infinity,
    selfDecel: lead ? brakingNeeded(me.v - lead.veh.v, lead.gap) : 0,
  };
}
