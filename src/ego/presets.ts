import { RuleSet } from './rules';

export interface Preset {
  name: string;
  description: string;
  build(): RuleSet;
}

function tweak(set: RuleSet, id: string, params: Record<string, number>, enabled = true): void {
  const item = set.get(id)!;
  item.enabled = enabled;
  Object.assign(item.params, params);
}

export const PRESETS: Preset[] = [
  {
    name: 'Balanced (default)',
    description: 'Sensible highway driver: keeps its distance, signals, overtakes and returns, yields to mergers.',
    build: () => new RuleSet(),
  },
  {
    name: 'Cruise control only',
    description: 'Only holds the speed and brakes in an emergency. No lane changes, no yielding.',
    build() {
      const s = new RuleSet();
      for (const id of ['keep-distance', 'yield-to-merging', 'make-room', 'overtake', 'return-slow-lane', 'no-undertake', 'lane-change-safety', 'signal']) {
        s.get(id)!.enabled = false;
      }
      return s;
    },
  },
  {
    name: 'Cautious chauffeur',
    description: 'Large gaps, slow and smooth, gives way to everyone.',
    build() {
      const s = new RuleSet();
      tweak(s, 'keep-speed', { speedFactor: 0.9 });
      tweak(s, 'keep-distance', { headway: 2.4, comfortDecel: 1.6, maxAccel: 1.2 });
      tweak(s, 'yield-to-merging', { lookahead: 70, extraHeadway: 1.2 });
      tweak(s, 'lane-change-safety', { maxImpact: 0.4, maxSelfDecel: 1.5, minGap: 6 });
      tweak(s, 'signal', { leadTime: 3 });
      tweak(s, 'comfort-limit', { maxAccel: 1.3, maxDecel: 2.5 });
      return s;
    },
  },
  {
    name: 'Late for work',
    description: 'Fast, tailgates, small gaps, signals late. Expect near misses and annoyed drivers.',
    build() {
      const s = new RuleSet();
      tweak(s, 'keep-speed', { speedFactor: 1.2, maxAccel: 2.8 });
      tweak(s, 'keep-distance', { headway: 0.7, minGap: 1.5, comfortDecel: 3.5, maxAccel: 2.8 });
      tweak(s, 'yield-to-merging', {}, false);
      tweak(s, 'overtake', { margin: 0.3, reach: 1.0, foresight: 0.5, cooldown: 2 });
      tweak(s, 'no-undertake', {}, false);
      tweak(s, 'lane-change-safety', { maxImpact: 4.5, maxSelfDecel: 6, minGap: 1 });
      tweak(s, 'signal', { leadTime: 0.3 });
      tweak(s, 'comfort-limit', { maxAccel: 3.5, maxDecel: 6 });
      return s;
    },
  },
];
