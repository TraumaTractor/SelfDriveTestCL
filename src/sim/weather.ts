export type WeatherKind = 'clear' | 'rain' | 'fog' | 'snow';
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'rain', 'fog', 'snow'];

/** What the user picks: a fixed kind, or "variable" (the weather drifts through the run). */
export interface WeatherConfig {
  kind: WeatherKind | 'variable';
  /** 0..1 */
  intensity: number;
}

export interface Conditions {
  kind: WeatherKind;
  intensity: number;
  /** tyre grip, 1 = dry road. Limits braking and acceleration. */
  grip: number;
  /** how far anyone (human or sensor) can see, metres */
  visibility: number;
  /** how much slower sensible drivers go, 1 = no change */
  speedFactor: number;
}

export const CLEAR: Conditions = { kind: 'clear', intensity: 0, grip: 1, visibility: 1000, speedFactor: 1 };

export function conditionsFor(kind: WeatherKind, intensity: number): Conditions {
  const i = Math.max(0, Math.min(1, intensity));
  switch (kind) {
    case 'rain': return { kind, intensity: i, grip: 1 - 0.32 * i, visibility: 1000 - 800 * i, speedFactor: 1 - 0.14 * i };
    case 'fog': return { kind, intensity: i, grip: 1 - 0.08 * i, visibility: 1000 - 940 * i, speedFactor: 1 - 0.35 * i };
    case 'snow': return { kind, intensity: i, grip: 1 - 0.62 * i, visibility: 1000 - 750 * i, speedFactor: 1 - 0.4 * i };
    default: return CLEAR;
  }
}

/** Greatest speed (m/s) from which a driver can stop within `distance`, given braking `decel` and reaction `t`. */
export function stoppingSightSpeed(distance: number, decel: number, t = 1.2): number {
  const b = Math.max(decel, 0.5);
  return Math.max(2, b * (Math.sqrt(t * t + (2 * distance) / b) - t));
}

/**
 * Variable weather: drifts between kinds and intensities over time. Intensity eases to zero before the
 * kind changes, so the change is gradual (about 10 s per 1.0 of intensity).
 */
export class WeatherDrift {
  kind: WeatherKind;
  intensity: number;
  private targetKind: WeatherKind;
  private targetIntensity: number;
  private timer: number;

  constructor(private rand: () => number, start: { kind: WeatherKind; intensity: number } = { kind: 'clear', intensity: 0 }) {
    this.kind = start.kind;
    this.intensity = start.intensity;
    this.targetKind = start.kind;
    this.targetIntensity = start.intensity;
    this.timer = 20 + rand() * 30;
  }

  step(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 50 + this.rand() * 70;
      const r = this.rand();
      this.targetKind = r < 0.3 ? 'clear' : r < 0.6 ? 'rain' : r < 0.82 ? 'fog' : 'snow';
      this.targetIntensity = this.targetKind === 'clear' ? 0 : 0.35 + this.rand() * 0.65;
    }
    const rate = 0.1 * dt;
    if (this.kind !== this.targetKind) {
      this.intensity = Math.max(0, this.intensity - rate);
      if (this.intensity === 0) this.kind = this.targetKind;
    } else {
      const d = this.targetIntensity - this.intensity;
      this.intensity += Math.max(-rate, Math.min(rate, d));
    }
  }

  conditions(): Conditions {
    return this.kind === 'clear' || this.intensity <= 0 ? CLEAR : conditionsFor(this.kind, this.intensity);
  }
}
