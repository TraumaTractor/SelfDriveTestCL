import { setUnits, type UnitSystem } from './units';
import { applyTheme, type ThemeSetting } from './theme';

export interface Settings {
  theme: ThemeSetting;
  units: UnitSystem;
}

const KEY = 'selfdrive-settings';
const DEFAULTS: Settings = { theme: 'auto', units: 'metric' };

let current: Settings = { ...DEFAULTS };

export const getSettings = (): Settings => current;

function sanitize(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  return {
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULTS.theme,
    units: r.units === 'imperial' || r.units === 'metric' ? r.units : DEFAULTS.units,
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
}
