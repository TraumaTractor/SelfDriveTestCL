import type { EgoDriver } from '../ego/egoDriver';
import type { RuleSet } from '../ego/rules';
import type { World, WorldConfig } from '../sim/world';

/** Shared application state handed to each panel. */
export interface App {
  cfg: WorldConfig;
  rules: RuleSet;
  world: World;
  driver: EgoDriver;
  /** rebuild the world from cfg + rules */
  restart(): void;
  /** traffic/road settings changed - needs a restart to take effect */
  trafficDirty(): void;
  /** rules changed (persist + flag results as stale) */
  rulesChanged(): void;
  setRules(rules: RuleSet): void;
  /** open the replay a few seconds before sim time t; false if that is no longer in the buffer */
  replayTo(t: number): boolean;
}

export interface Panel {
  el: HTMLElement;
  /** called a few times per second with the live world */
  refresh(app: App): void;
  /** called after the rule set or config has been replaced wholesale */
  rebuild(app: App): void;
}
