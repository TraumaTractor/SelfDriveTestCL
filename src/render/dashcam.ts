import * as U from '../units';
import { theme } from '../theme';
import { VEHICLE_SPECS } from '../sim/vehicle';
import { drawRear } from './sprites';
import type { EgoReport } from '../ego/egoDriver';
import { rampInstances, speedLimitAt, zoneInstances } from '../sim/road';
import type { Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';

export interface DashOptions {
  alpha: number;
  report: EgoReport | null;
}

const PAL = {
  // light = a bright day; dark = dusk
  light: { skyTop: '#5d8fc9', skyBottom: '#bcd6ee', hills: '#6f8f86', grass: '#2f5d3a', roadA: '#3a3e46', roadB: '#363a42', ramp: '#41464f', tree: '#2d6b3d', tree2: '#25593a', trunk: '#4a3a2a' },
  dark: { skyTop: '#101a33', skyBottom: '#7b5a74', hills: '#2f4350', grass: '#16301f', roadA: '#23262c', roadB: '#202328', ramp: '#2a2d33', tree: '#1c4a2c', tree2: '#163d25', trunk: '#2e251b' },
};
const CAM_H = 1.25; // camera height above the road (m)
const HFOV = (84 * Math.PI) / 180;
const Z_NEAR = 1.2;
const Z_FAR = 320;

/**
 * Pseudo-3D "dashcam" view from the driver's seat: a perspective projection of the road ahead,
 * so you see roughly what the car's forward camera sees.
 */
export class Dashcam {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(80, Math.floor(r.width));
    this.h = Math.max(60, Math.floor(r.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
  }

  draw(world: World, o: DashOptions): void {
    const { ctx, w, h } = this;
    if (w < 100) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ego = world.ego;
    const lw = world.road.laneWidth;
    const lanes = world.road.lanes;
    const lerp = (a: number, b: number) => a + (b - a) * o.alpha;
    const pal = PAL[theme()];

    const camS = lerp(ego.prevS, ego.s) + ego.length * 0.15;
    const camX = lerp(ego.prevY, ego.y) * lw;
    const f = w / 2 / Math.tan(HFOV / 2);
    const horizon = h * 0.43;
    const px = (X: number, Z: number) => w / 2 + (f * (X - camX)) / Z;
    const py = (Y: number, Z: number) => horizon + (f * (CAM_H - Y)) / Z;

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon + 1);
    // distant hills
    ctx.fillStyle = pal.hills;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, horizon - 6 - 5 * Math.sin((x + camS * 0.2) / 70) - 3 * Math.sin((x + camS * 0.2) / 23));
    ctx.lineTo(w, horizon);
    ctx.closePath();
    ctx.fill();
    // grass
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, horizon, w, h - horizon);

    // road surface, as strips from far to near
    const left = -0.5 * lw, right = (lanes - 0.5) * lw;
    const steps = 70;
    const zAt = (i: number) => Z_NEAR * Math.pow(Z_FAR / Z_NEAR, i / steps);
    for (let i = steps - 1; i >= 0; i--) {
      const z0 = zAt(i), z1 = zAt(i + 1);
      const band = Math.floor((camS + z0) / 12) % 2 === 0;
      ctx.fillStyle = band ? pal.roadA : pal.roadB;
      this.quad(z0, z1, left, right, camX, f, horizon);
    }
    this.roadStrips(left, right, camS, steps, zAt, px, py);

    // ramps (acceleration lanes on the left)
    for (const { ramp } of rampInstances(world.road, camS, camS + Z_FAR)) {
      const a = Math.max(ramp.start - camS, Z_NEAR), b = Math.min(ramp.end - camS, Z_FAR);
      if (b <= a) continue;
      ctx.fillStyle = pal.ramp;
      this.ground(left - lw, left, a, b, px, py);
      ctx.fillStyle = 'rgba(217,217,217,0.9)';
      for (let s = Math.ceil((camS + a) / 6) * 6; s < camS + b; s += 6) {
        const z0 = Math.max(s - camS, Z_NEAR), z1 = Math.min(s + 2.5 - camS, b);
        if (z1 > z0) this.ground(left - 0.07, left + 0.07, z0, z1, px, py);
      }
      if (ramp.end - camS > Z_NEAR && ramp.end - camS < Z_FAR) {
        ctx.fillStyle = '#d4a20f';
        const z = ramp.end - camS;
        this.rect(left - lw, left, 0, 1.2, z, px, py);
      }
    }

    // scenery and speed signs (far to near)
    const items: { z: number; draw: () => void }[] = [];
    const first = Math.floor((camS + Z_NEAR) / 34) * 34;
    for (let s = first; s < camS + Z_FAR; s += 34) {
      const hs = hash(s);
      const z = s + (hs % 11) - camS;
      if (z < Z_NEAR) continue;
      const onRight = hs % 2 === 0;
      const X = onRight ? right + 6 + (hs % 9) * 2 : left - 7 - (hs % 7) * 2;
      items.push({ z, draw: () => this.tree(px(X, z), py(0, z), f / z, hs, pal) });
    }
    for (const zn of zoneInstances(world.road, camS, camS + Z_FAR)) {
      const z = zn.start - camS;
      if (z < Z_NEAR || z > Z_FAR) continue;
      items.push({ z, draw: () => this.sign(px(right + 1.6, z), py(2.2, z), py(0, z), f / z, Math.round(U.speedValue(zn.limit) / (U.getUnits() === 'imperial' ? 5 : 10)) * (U.getUnits() === 'imperial' ? 5 : 10)) });
    }

    // vehicles ahead
    const vehicles = world.vehicles.filter((v) => v !== ego).map((v) => ({ v, z: lerp(v.prevS, v.s) - v.length / 2 - camS }))
      .filter((e) => e.z > Z_NEAR && e.z < Z_FAR);
    for (const e of vehicles) items.push({ z: e.z, draw: () => this.vehicle(e.v, e.z, lerp(e.v.prevY, e.v.y) * lw, px, py, f, world.time) });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.draw();

    // tracked vehicle bracket
    const lead = world.leaderAhead(ego);
    if (lead && !ego.crashed) {
      const z = lerp(lead.veh.prevS, lead.veh.s) - lead.veh.length / 2 - camS;
      if (z > Z_NEAR) {
        const X = lerp(lead.veh.prevY, lead.veh.y) * lw;
        const top = this.vh(lead.veh);
        const x0 = px(X - lead.veh.width / 2, z) - 5, x1 = px(X + lead.veh.width / 2, z) + 5;
        const y0 = py(top, z) - 5, y1 = py(0.15, z) + 4;
        const danger = lead.gap / Math.max(ego.v, 1) < 1;
        ctx.strokeStyle = danger ? '#ff4d6a' : '#35e0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        this.label(`${U.speed(lead.veh.v)} · ${U.dist(lead.gap)}`, (x0 + x1) / 2, y0 - 6, danger ? '#ff4d6a' : '#35e0ff');
      }
    }

    this.cockpit(world, o);
  }

  // ------------------------------------------------------------------ pieces

  private vh(v: Vehicle): number {
    return VEHICLE_SPECS[v.type].height;
  }

  /** Road strip between two depths; draws as a screen-space trapezoid. */
  private quad(z0: number, z1: number, left: number, right: number, camX: number, f: number, horizon: number): void {
    const { ctx, w } = this;
    const xl0 = w / 2 + (f * (left - camX)) / z0, xr0 = w / 2 + (f * (right - camX)) / z0;
    const xl1 = w / 2 + (f * (left - camX)) / z1, xr1 = w / 2 + (f * (right - camX)) / z1;
    const y0 = horizon + (f * CAM_H) / z0, y1 = horizon + (f * CAM_H) / z1;
    ctx.beginPath();
    ctx.moveTo(xl0, y0);
    ctx.lineTo(xr0, y0);
    ctx.lineTo(xr1, y1);
    ctx.lineTo(xl1, y1);
    ctx.closePath();
    ctx.fill();
  }

  /** Flat ground rectangle between lateral X0..X1 and depths z0..z1. */
  private ground(X0: number, X1: number, z0: number, z1: number, px: (X: number, Z: number) => number, py: (Y: number, Z: number) => number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(px(X0, z0), py(0, z0));
    ctx.lineTo(px(X1, z0), py(0, z0));
    ctx.lineTo(px(X1, z1), py(0, z1));
    ctx.lineTo(px(X0, z1), py(0, z1));
    ctx.closePath();
    ctx.fill();
  }

  /** Upright rectangle standing at depth z. */
  private rect(X0: number, X1: number, Y0: number, Y1: number, z: number, px: (X: number, Z: number) => number, py: (Y: number, Z: number) => number): void {
    const { ctx } = this;
    ctx.fillRect(px(X0, z), py(Y1, z), px(X1, z) - px(X0, z), py(Y0, z) - py(Y1, z));
  }

  private roadStrips(left: number, right: number, camS: number, _steps: number, _zAt: (i: number) => number, px: (X: number, Z: number) => number, py: (Y: number, Z: number) => number): void {
    const { ctx } = this;
    const lanes = Math.round((right - left) / 3.6);
    ctx.fillStyle = '#e6e6e6';
    // solid edge lines
    this.ground(left - 0.12, left + 0.12, Z_NEAR, Z_FAR, px, py);
    this.ground(right - 0.12, right + 0.12, Z_NEAR, Z_FAR, px, py);
    // dashed lane lines
    for (let l = 0; l < lanes - 1; l++) {
      const X = left + (l + 1) * 3.6;
      for (let s = Math.floor((camS + Z_NEAR) / 9) * 9; s < camS + Z_FAR; s += 9) {
        const z0 = Math.max(s - camS, Z_NEAR), z1 = Math.min(s + 3 - camS, Z_FAR);
        if (z1 > z0) this.ground(X - 0.08, X + 0.08, z0, z1, px, py);
      }
    }
  }

  private vehicle(v: Vehicle, z: number, X: number, px: (X: number, Z: number) => number, py: (Y: number, Z: number) => number, _f: number, time: number): void {
    const top = this.vh(v);
    const x0 = px(X - v.width / 2, z), x1 = px(X + v.width / 2, z);
    const y0 = py(top, z), y1 = py(0.2, z);
    if (x1 - x0 < 1.5) return;
    drawRear(this.ctx, v, x0, y0, x1 - x0, y1 - y0, time);
  }

  private tree(x: number, y: number, k: number, hs: number, pal: (typeof PAL)['light']): void {
    const { ctx } = this;
    if (k < 0.6) return;
    ctx.fillStyle = pal.trunk;
    ctx.fillRect(x - k * 0.18, y - k * 2.2, k * 0.36, k * 2.2);
    ctx.fillStyle = hs % 3 === 0 ? pal.tree : pal.tree2;
    ctx.beginPath();
    ctx.arc(x, y - k * 3.6, k * (1.6 + (hs % 5) * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }

  private sign(x: number, yTop: number, yBase: number, k: number, kmh: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(x - k * 0.05, yTop, k * 0.1, yBase - yTop);
    const r = k * 0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, yTop - r * 0.2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d6232a';
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.stroke();
    if (r > 6) {
      ctx.fillStyle = '#111';
      ctx.font = `700 ${Math.max(8, r * 0.85)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(kmh), x, yTop - r * 0.2 + r * 0.3);
    }
  }

  private round(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private label(text: string, x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(10,14,20,0.82)';
    this.round(x - tw / 2, y - 12, tw, 16, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Bonnet, windscreen frame, speed readout, indicators and the mirror. */
  private cockpit(world: World, o: DashOptions): void {
    const { ctx, w, h } = this;
    const ego = world.ego;
    // bonnet
    const hood = ctx.createLinearGradient(0, h * 0.86, 0, h);
    hood.addColorStop(0, '#2a3a44');
    hood.addColorStop(1, '#10161c');
    ctx.fillStyle = hood;
    ctx.beginPath();
    ctx.moveTo(w * 0.18, h);
    ctx.quadraticCurveTo(w * 0.5, h * 0.84, w * 0.82, h);
    ctx.closePath();
    ctx.fill();
    // dashboard strip
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    ctx.fillRect(0, h - 30, w, 30);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(`${U.speedValue(ego.v).toFixed(0)}`, w / 2, h - 9);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a0';
    ctx.fillText(U.speedUnit(), w / 2 + 34, h - 9);
    const limit = speedLimitAt(world.road, ego.s);
    ctx.textAlign = 'left';
    ctx.fillStyle = ego.v > limit * 1.02 ? '#ff9340' : '#8d94a0';
    ctx.fillText(`limit ${U.speedValue(limit).toFixed(0)}`, 12, h - 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8d94a0';
    ctx.fillText(`lane ${ego.targetLane + 1}/${world.road.lanes} · lap ${world.lap + 1}`, w - 12, h - 10);

    // indicator arrows
    if (ego.indicator !== 0 && Math.floor(world.time * 2.5) % 2 === 0) {
      ctx.fillStyle = '#3ecf8e';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ego.indicator === 1 ? '▶' : '◀', ego.indicator === 1 ? w / 2 + 80 : w / 2 - 80, h - 9);
    }

    // rear-view mirror: nearest car behind in our lane
    const mw = Math.min(180, w * 0.34), mh = 34, mx = w / 2 - mw / 2, my = 8;
    ctx.fillStyle = 'rgba(10,14,20,0.8)';
    this.round(mx, my, mw, mh, 8);
    ctx.fill();
    const fol = world.followerIn(ego, ego.targetLane);
    const chk = o.report?.check?.impact;
    ctx.textAlign = 'center';
    if (fol && fol.gap < 120) {
      const closing = fol.veh.v - ego.v;
      const wd = Math.max(8, 60 - fol.gap * 0.4);
      ctx.fillStyle = fol.veh.color;
      this.round(mx + 10, my + 8, wd * 0.7, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#cfd6e0';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${U.dist(fol.gap)} · ${U.speedDelta(closing)}`, mx + 10 + wd * 0.7 + 8, my + 21);
    } else {
      ctx.fillStyle = '#6b7685';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('clear behind', w / 2, my + 21);
    }
    if (chk?.follower && o.report?.check) {
      const ok = o.report.check.ok;
      ctx.strokeStyle = ok ? '#3ecf8e' : '#ff4d6a';
      ctx.lineWidth = 2;
      this.round(mx, my, mw, mh, 8);
      ctx.stroke();
    }

    // one-line "what I'm doing"
    const r = o.report;
    if (r) {
      const win = [...r.accelProposals].sort((a, b) => a.a - b.a)[0];
      const text = r.vetoBy ? `✖ lane change blocked: ${r.vetoReason}`
        : r.pendingLane !== null ? `signalling → lane ${r.pendingLane + 1}`
        : win?.why ?? '';
      if (text) {
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'left';
        const maxW = w - 24;
        let t = text;
        while (t.length > 6 && ctx.measureText(t).width > maxW - 14) t = t.slice(0, -2);
        if (t !== text) t += '…';
        const tw = ctx.measureText(t).width + 14;
        ctx.fillStyle = 'rgba(10,14,20,0.78)';
        this.round(10, h - 62, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = r.vetoBy ? '#ffb000' : '#cfd6e0';
        ctx.fillText(t, 17, h - 47);
      }
    }
    if (world.status !== 'running') {
      ctx.fillStyle = 'rgba(10,14,20,0.82)';
      this.round(w / 2 - 90, h * 0.3, 180, 44, 10);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillStyle = world.status === 'finished' ? '#3ecf8e' : '#ff4d6a';
      ctx.fillText(world.status === 'finished' ? 'FINISHED' : world.status === 'crashed' ? 'CRASHED' : 'TIMED OUT', w / 2, h * 0.3 + 30);
    }
  }
}

function hash(n: number): number {
  let x = Math.floor(n) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
