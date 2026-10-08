/**
 * Display units. The simulation always works in SI (metres, m/s); this module only changes how numbers
 * are shown. Imperial uses mph, feet / miles, ft/s² and lbf.
 */
export type UnitSystem = 'metric' | 'imperial';

let system: UnitSystem = 'metric';
const listeners = new Set<() => void>();

export function setUnits(s: UnitSystem): void {
  if (s === system) return;
  system = s;
  listeners.forEach((fn) => fn());
}
export const getUnits = (): UnitSystem => system;
export const onUnitsChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };

const KMH = 3.6, MPH = 2.2369363, FT = 3.2808399, MI = 0.00062137119, LBF_PER_KN = 224.80894;
const imp = () => system === 'imperial';

/** Conversion of an SI value to the display unit, for a unit string used in parameter definitions. */
export function convertForDisplay(value: number, unit: string | undefined): { value: number; unit: string | undefined; factor: number } {
  const f = (factor: number, u: string) => ({ value: value * factor, unit: u, factor });
  switch (unit) {
    case 'm/s': return imp() ? f(MPH, 'mph') : f(KMH, 'km/h');
    case 'km/h': return imp() ? f(MPH / KMH, 'mph') : f(1, 'km/h');
    case 'm': return imp() ? f(FT, 'ft') : f(1, 'm');
    case 'm/s²': return imp() ? f(FT, 'ft/s²') : f(1, 'm/s²');
    case 'long-m': return imp() ? f(MI, 'mi') : f(1 / 1000, 'km');
    case 'veh/km/lane': return imp() ? f(1 / 0.621371, 'veh/mi/lane') : f(1, unit);
    default: return { value, unit, factor: 1 };
  }
}

export const speedUnit = (): string => (imp() ? 'mph' : 'km/h');
export const speedValue = (ms: number): number => ms * (imp() ? MPH : KMH);
/** "104 km/h" / "65 mph" */
export const speed = (ms: number, digits = 0): string => `${speedValue(ms).toFixed(digits)} ${speedUnit()}`;
/** signed speed difference: "+14 km/h" */
export const speedDelta = (ms: number): string => `${ms >= 0 ? '+' : '−'}${Math.abs(speedValue(ms)).toFixed(0)} ${speedUnit()}`;

export const distUnit = (): string => (imp() ? 'ft' : 'm');
export const distValue = (m: number): number => m * (imp() ? FT : 1);
/** "59 m" / "194 ft" */
export const dist = (m: number, digits = 0): string => `${distValue(m).toFixed(digits)} ${distUnit()}`;
/** loop / road lengths: "6.0 km" / "3.7 mi" */
export const longDist = (m: number, digits = 1): string => (imp() ? `${(m * MI).toFixed(digits)} mi` : `${(m / 1000).toFixed(digits)} km`);

export const accelUnit = (): string => (imp() ? 'ft/s²' : 'm/s²');
/** "1.5 m/s²" (sign kept as given unless `signed`, which forces +/−) */
export function accel(a: number, signed = false, digits = 1): string {
  const v = a * (imp() ? FT : 1);
  const body = `${Math.abs(v).toFixed(digits)} ${accelUnit()}`;
  if (signed) return `${v >= 0 ? '+' : '−'}${body}`;
  return v < 0 ? `−${body}` : body;
}

export const forceUnit = (): string => (imp() ? 'lbf' : 'kN');
/** momentum rate of change, from kN: "−3.2 kN" / "−720 lbf" */
export function force(kN: number): string {
  const v = imp() ? kN * LBF_PER_KN : kN;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(imp() ? 0 : 1)} ${forceUnit()}`;
}
