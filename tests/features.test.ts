import { afterEach, describe, expect, it } from 'vitest';
import { EgoDriver } from '../src/ego/egoDriver';
import { RuleSet } from '../src/ego/rules';
import { resolveTheme } from '../src/theme';
import * as U from '../src/units';
import { VEHICLE_SPECS, VEHICLE_TYPES } from '../src/sim/vehicle';
import { defaultConfig, World } from '../src/sim/world';

afterEach(() => U.setUnits('metric'));

describe('units', () => {
  it('shows metric by default and imperial on request', () => {
    expect(U.speed(27.78)).toBe('100 km/h');
    expect(U.dist(59.4)).toBe('59 m');
    expect(U.longDist(6000)).toBe('6.0 km');
    U.setUnits('imperial');
    expect(U.speed(26.8224)).toBe('60 mph');
    expect(U.dist(100)).toBe('328 ft');
    expect(U.longDist(1609.344, 2)).toBe('1.00 mi');
    expect(U.accel(-1.5, true)).toMatch(/^−4\.9 ft\/s²$/);
    expect(U.force(-3)).toBe('−674 lbf');
    expect(U.speedDelta(5)).toBe('+11 mph');
  });

  it('converts slider read-outs but never the stored SI values', () => {
    expect(U.convertForDisplay(10, 'm/s').unit).toBe('km/h');
    U.setUnits('imperial');
    const c = U.convertForDisplay(10, 'm/s');
    expect(c.unit).toBe('mph');
    expect(c.value).toBeCloseTo(22.37, 1);
    expect(U.convertForDisplay(100, 'm').unit).toBe('ft');
    expect(U.convertForDisplay(6000, 'long-m')).toMatchObject({ unit: 'mi' });
    expect(U.convertForDisplay(5, 's').unit).toBe('s'); // unchanged
  });

  it('notifies listeners when the system changes', () => {
    let n = 0;
    const off = U.onUnitsChange(() => n++);
    U.setUnits('imperial');
    U.setUnits('imperial'); // no change, no event
    U.setUnits('metric');
    off();
    U.setUnits('imperial');
    expect(n).toBe(2);
  });

  it('explanations from the car follow the chosen units', () => {
    U.setUnits('imperial');
    const cfg = defaultConfig();
    cfg.endless = false;
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    for (let i = 0; i < 40; i++) w.step(0.05);
    const text = JSON.stringify(w.ego.driver && (w.ego.driver as EgoDriver).report.accelProposals);
    expect(text).toMatch(/mph/);
    expect(text).not.toMatch(/km\/h/);
  });
});

describe('theme', () => {
  it('resolves auto from the system preference', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('vehicle types', () => {
  it('has sensible specs', () => {
    expect(VEHICLE_SPECS.lorry.length).toBeGreaterThan(VEHICLE_SPECS.van.length);
    expect(VEHICLE_SPECS.motorcycle.width).toBeLessThan(1);
    expect(VEHICLE_SPECS.lorry.maxSpeed).toBeLessThan(VEHICLE_SPECS.car.maxSpeed);
    expect(VEHICLE_TYPES).toHaveLength(5);
  });

  it('spawns every kind, and keeps lorries and coaches out of the fastest lane', () => {
    const cfg = defaultConfig();
    cfg.endless = false;
    cfg.seed = 4;
    cfg.vehicleMix = { car: 1, van: 1, lorry: 3, motorcycle: 1, coach: 2 };
    const w = new World(cfg, new EgoDriver(new RuleSet()));
    const seen = new Set<string>();
    let heavyInTopLane = 0;
    let heavyTopSamples = 0;
    for (let i = 0; i < 20 * 150; i++) {
      w.step(0.05);
      for (const v of w.vehicles) {
        seen.add(v.type);
        if (v.kind === 'traffic' && VEHICLE_SPECS[v.type].heavy && !v.crashed) {
          heavyTopSamples++;
          if (v.targetLane > cfg.lanes - 2) heavyInTopLane++;
          expect(v.v).toBeLessThan(VEHICLE_SPECS[v.type].maxSpeed + 1);
        }
      }
    }
    for (const t of VEHICLE_TYPES) expect(seen.has(t)).toBe(true);
    expect(heavyTopSamples).toBeGreaterThan(50);
    expect(heavyInTopLane).toBe(0);
  });

  it('a lorry takes far longer to speed up than a motorcycle', () => {
    expect(VEHICLE_SPECS.motorcycle.accelScale / VEHICLE_SPECS.lorry.accelScale).toBeGreaterThan(3);
  });
});
