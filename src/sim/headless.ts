import { EgoDriver } from '../ego/egoDriver';
import type { RuleSet } from '../ego/rules';
import type { Scores } from './metrics';
import { World, type RunStatus, type WorldConfig } from './world';

export const SIM_DT = 0.05;

export interface RunSummary {
  seed: number;
  status: RunStatus;
  scores: Scores;
  time: number;
  distance: number;
  avgSpeed: number;
  collisions: number;
  nearMisses: number;
  hardBrakes: number;
  unsignalled: number;
  cutOffs: number;
  laneChanges: number;
}

export function summarise(world: World): RunSummary {
  const m = world.metrics;
  return {
    seed: world.cfg.seed,
    status: world.status,
    scores: m.scores(world.status === 'crashed'),
    time: world.time,
    distance: m.distance,
    avgSpeed: m.avgSpeed,
    collisions: m.collisions,
    nearMisses: m.nearMisses,
    hardBrakes: m.hardBrakes,
    unsignalled: m.unsignalledChanges,
    cutOffs: m.cutOffs,
    laneChanges: m.laneChanges,
  };
}

/** Run one scenario to completion without any rendering. */
export function runHeadless(cfg: WorldConfig, rules: RuleSet): RunSummary {
  const world = new World(cfg, new EgoDriver(rules.clone()));
  while (world.status === 'running') world.step(SIM_DT);
  return summarise(world);
}
