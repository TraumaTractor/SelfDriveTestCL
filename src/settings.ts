import { setUnits, type UnitSystem } from './units';
import { applyTheme, type ThemeSetting } from './theme';

export interface AutoPause {
  nearmiss: boolean;
  collision: boolean;
  hardbrake: boolean;
  emergency: boolean;
  cutoff: boolean;
}

export interface SoundSettings {
  on: boolean;
  volume: number;
  indicator: boolean;
  warnings: boolean;
  collision: boolean;
  horn: boolean;
  lane: boolean;
  hazard: boolean;
  ambient: boolean;
}

export interface Settings {
  theme: ThemeSetting;
  units: UnitSystem;
  autoPause: AutoPause;
  /** how much of the run is kept for replay */
  replaySeconds: number;
  sound: SoundSettings;
  legend: boolean;
}

const KEY = 'selfdrive-settings';
export const DEFAULTS: Settings = {
  theme: 'auto',
  units: 'metric',
  autoPause: { nearmiss: true, collision: true, hardbrake: false, emergency: false, cutoff: false },
  replaySeconds: 180,
  sound: { on: false, volume: 0.5, indicator: true, warnings: true, collision: true, horn: true, lane: false, hazard: true, ambient: true },
  legend: true,
};

let current: Settings = structuredClone(DEFAULTS);
const listeners = new Set<(s: Settings) => void>();

export const getSettings = (): Settings => current;
export const onSettingsChange = (fn: (s: Settings) => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

function sanitize(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  const ap = (r.autoPause ?? {}) as Partial<AutoPause>;
  const so = (r.sound ?? {}) as Partial<SoundSettings>;
  const d = DEFAULTS;
  return {
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : d.theme,
    units: r.units === 'imperial' || r.units === 'metric' ? r.units : d.units,
    autoPause: {
      nearmiss: bool(ap.nearmiss, d.autoPause.nearmiss), collision: bool(ap.collision, d.autoPause.collision),
      hardbrake: bool(ap.hardbrake, d.autoPause.hardbrake), emergency: bool(ap.emergency, d.autoPause.emergency),
      cutoff: bool(ap.cutoff, d.autoPause.cutoff),
    },
    replaySeconds: [60, 180, 600].includes(Number(r.replaySeconds)) ? Number(r.replaySeconds) : d.replaySeconds,
    sound: {
      on: bool(so.on, d.sound.on),
      volume: typeof so.volume === 'number' && so.volume >= 0 && so.volume <= 1 ? so.volume : d.sound.volume,
      indicator: bool(so.indicator, d.sound.indicator), warnings: bool(so.warnings, d.sound.warnings),
      collision: bool(so.collision, d.sound.collision), horn: bool(so.horn, d.sound.horn), lane: bool(so.lane, d.sound.lane),
      hazard: bool(so.hazard, d.sound.hazard), ambient: bool(so.ambient, d.sound.ambient),
    },
    legend: bool(r.legend, d.legend),
  };
}

/** Load saved settings and apply them (call once at start-up). */
export function loadSettings(): Settings {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* none saved */ }
  // first run: guess imperial for US-style locales
  if (!raw && typeof navigator !== 'undefined' && /^en-(US|LR|MM)\b/i.test(navigator.language)) raw = { units: 'imperial' };
  current = sanitize(raw);
  applyTheme(current.theme);
  setUnits(current.units);
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = sanitize({ ...current, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage unavailable - fine */ }
  applyTheme(current.theme);
  setUnits(current.units);
  listeners.forEach((fn) => fn(current));
}
