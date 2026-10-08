import type { ParamDef } from '../common';

export type PersonalityId = 'great' | 'average' | 'cautious' | 'aggressive' | 'reckless';

export interface Personality {
  name: string;
  color: string;
  /** desired speed as a fraction of the posted limit */
  speedFactor: number;
  /** desired time headway (s) */
  headway: number;
  /** minimum standstill gap (m) */
  minGap: number;
  /** max acceleration (m/s²) */
  accel: number;
  /** comfortable braking (m/s²) */
  decel: number;
  /** reaction time constant (s) - low-pass on accel changes */
  reaction: number;
  /** probability of signalling before a lane change (0..1) */
  signalProb: number;
  /** how long the indicator is on before moving (s) */
  signalLead: number;
  /** MOBIL politeness: weight given to other drivers' inconvenience */
  politeness: number;
  /** probability that this driver yields to a signalling / merging car */
  courtesy: number;
  /** scales the gap accepted when changing lanes or merging (1 = normal) */
  gapFactor: number;
  /** minimum benefit (m/s²) before bothering to change lane */
  changeThreshold: number;
  /** preference for returning to the slow lane (0 = hogs lanes) */
  keepSlowLane: number;
  /** attention lapses per second (during a lapse the driver does not react) */
  lapseRate: number;
  /** max braking imposed on followers by a lane change (m/s²) */
  safeDecel: number;
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  great: {
    name: 'Great', color: '#3ecf8e', speedFactor: 1.0, headway: 1.8, minGap: 2.5, accel: 1.3, decel: 1.8,
    reaction: 0.25, signalProb: 1, signalLead: 2.5, politeness: 0.8, courtesy: 0.95, gapFactor: 1.5,
    changeThreshold: 0.35, keepSlowLane: 0.9, lapseRate: 0, safeDecel: 2.0,
  },
  average: {
    name: 'Average', color: '#4da3ff', speedFactor: 1.05, headway: 1.4, minGap: 2.0, accel: 1.6, decel: 2.2,
    reaction: 0.5, signalProb: 0.8, signalLead: 1.5, politeness: 0.4, courtesy: 0.7, gapFactor: 1.0,
    changeThreshold: 0.2, keepSlowLane: 0.5, lapseRate: 0.002, safeDecel: 3.5,
  },
  cautious: {
    name: 'Cautious / slow', color: '#c9b458', speedFactor: 0.72, headway: 2.2, minGap: 3.0, accel: 1.0, decel: 1.5,
    reaction: 0.5, signalProb: 0.9, signalLead: 2.0, politeness: 0.5, courtesy: 0.8, gapFactor: 1.6,
    changeThreshold: 0.6, keepSlowLane: 0.1, lapseRate: 0.002, safeDecel: 2.0,
  },
  aggressive: {
    name: 'Aggressive', color: '#ff9340', speedFactor: 1.2, headway: 0.8, minGap: 1.2, accel: 2.4, decel: 3.0,
    reaction: 0.7, signalProb: 0.3, signalLead: 0.5, politeness: 0.05, courtesy: 0.2, gapFactor: 0.65,
    changeThreshold: 0.1, keepSlowLane: 0.1, lapseRate: 0.01, safeDecel: 6.0,
  },
  reckless: {
    name: 'Reckless', color: '#ff4d6a', speedFactor: 1.35, headway: 0.4, minGap: 0.7, accel: 3.0, decel: 4.0,
    reaction: 1.1, signalProb: 0, signalLead: 0, politeness: 0, courtesy: 0, gapFactor: 0.4,
    changeThreshold: 0.0, keepSlowLane: 0, lapseRate: 0.04, safeDecel: 9.0,
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES) as PersonalityId[];

export const PERSONALITY_PARAMS: (ParamDef & { key: keyof Personality })[] = [
  { key: 'speedFactor', label: 'Desired speed vs limit', min: 0.5, max: 1.6, step: 0.01, unit: '×' },
  { key: 'headway', label: 'Time headway', min: 0.2, max: 3, step: 0.05, unit: 's' },
  { key: 'minGap', label: 'Min gap', min: 0.3, max: 5, step: 0.1, unit: 'm' },
  { key: 'accel', label: 'Max acceleration', min: 0.5, max: 4, step: 0.1, unit: 'm/s²' },
  { key: 'decel', label: 'Comfortable braking', min: 1, max: 6, step: 0.1, unit: 'm/s²' },
  { key: 'reaction', label: 'Reaction time', min: 0.1, max: 2, step: 0.05, unit: 's' },
  { key: 'signalProb', label: 'Signals before turning', min: 0, max: 1, step: 0.05 },
  { key: 'signalLead', label: 'Signal lead time', min: 0, max: 4, step: 0.1, unit: 's' },
  { key: 'politeness', label: 'Politeness', min: 0, max: 1, step: 0.05 },
  { key: 'courtesy', label: 'Yields to mergers', min: 0, max: 1, step: 0.05 },
  { key: 'gapFactor', label: 'Merge gap required', min: 0.1, max: 2.5, step: 0.05, unit: '×' },
  { key: 'changeThreshold', label: 'Lane change benefit needed', min: 0, max: 1, step: 0.05, unit: 'm/s²' },
  { key: 'keepSlowLane', label: 'Keeps to slow lane', min: 0, max: 1, step: 0.05 },
  { key: 'lapseRate', label: 'Attention lapses', min: 0, max: 0.1, step: 0.002, unit: '/s' },
  { key: 'safeDecel', label: 'Braking imposed on others', min: 1, max: 10, step: 0.5, unit: 'm/s²' },
];

export function clonePersonalities(src: Record<PersonalityId, Personality> = PERSONALITIES): Record<PersonalityId, Personality> {
  const out = {} as Record<PersonalityId, Personality>;
  for (const id of PERSONALITY_IDS) out[id] = { ...src[id] };
  return out;
}
