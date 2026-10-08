import * as U from '../units';
import type { Conditions } from '../sim/weather';

const NAMES = { clear: 'Clear', rain: 'Rain', fog: 'Fog', snow: 'Snow & ice' } as const;

/** One-line summary for HUDs: "Rain 60% · grip 80% · sight 280 m". */
export function weatherBadge(c: Conditions): string {
  if (c.kind === 'clear') return '';
  return `${NAMES[c.kind]} ${Math.round(c.intensity * 100)}% · grip ${Math.round(c.grip * 100)}% · sight ${U.dist(c.visibility)}`;
}

/** How visible something `distance` metres away is (1 = fully, ~0.06 = lost in the fog). */
export function fogAlpha(distance: number, c: Conditions): number {
  if (c.visibility >= 900) return 1;
  return Math.min(1, Math.max(0.06, Math.exp((-2.6 * Math.abs(distance)) / c.visibility)));
}

/** deterministic pseudo-random in [0,1) from an integer */
function rnd(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Weather laid over the top-down scene. `t` is wall-clock seconds, for animation only. */
export function drawTopDownWeather(ctx: CanvasRenderingContext2D, w: number, h: number, c: Conditions, t: number): void {
  if (c.kind === 'clear' || c.intensity <= 0) return;
  const i = c.intensity;
  ctx.save();
  if (c.kind === 'rain') {
    ctx.fillStyle = `rgba(20,30,50,${0.08 + 0.16 * i})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(190,212,255,0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = Math.floor(40 + 170 * i);
    for (let k = 0; k < n; k++) {
      const x = (rnd(k) * (w + 80) + t * 140) % (w + 80) - 40;
      const y = (rnd(k + 999) * (h + 40) + t * (520 + 300 * rnd(k + 5))) % (h + 40) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 16);
    }
    ctx.stroke();
  } else if (c.kind === 'fog') {
    ctx.fillStyle = `rgba(215,221,230,${0.1 + 0.34 * i})`;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = `rgba(235,242,252,${0.05 + 0.12 * i})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const n = Math.floor(50 + 220 * i);
    for (let k = 0; k < n; k++) {
      const spd = 28 + 40 * rnd(k + 3);
      const x = (rnd(k) * w + 18 * Math.sin(t * 1.3 + k) + t * 12) % w;
      const y = (rnd(k + 77) * h + t * spd) % h;
      ctx.beginPath();
      ctx.arc(x, y, 1 + 1.8 * rnd(k + 9), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Weather as seen through the dashcam: fog bank at the horizon, drops on the lens, flakes. */
export function drawDashWeather(ctx: CanvasRenderingContext2D, w: number, h: number, horizon: number, c: Conditions, t: number): void {
  if (c.kind === 'clear' || c.intensity <= 0) return;
  const i = c.intensity;
  ctx.save();
  if (c.kind === 'fog') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(205,212,222,${0.25 + 0.4 * i})`);
    g.addColorStop(horizon / h, `rgba(215,221,230,${0.55 + 0.4 * i})`);
    g.addColorStop(1, `rgba(215,221,230,${0.08 + 0.2 * i})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (c.kind === 'rain') {
    ctx.fillStyle = `rgba(30,45,70,${0.06 + 0.14 * i})`;
    ctx.fillRect(0, 0, w, h);
    // streaks in the air
    ctx.strokeStyle = 'rgba(200,220,255,0.3)';
    ctx.beginPath();
    for (let k = 0; k < 30 + 70 * i; k++) {
      const x = rnd(k) * w;
      const y = (rnd(k + 50) * h + t * 700) % h;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 22);
    }
    ctx.stroke();
    // drops on the lens, slowly sliding
    for (let k = 0; k < 14 + 40 * i; k++) {
      const x = rnd(k + 200) * w;
      const y = (rnd(k + 300) * h + t * (8 + 14 * rnd(k + 400))) % h;
      const r = 1.5 + 3.5 * rnd(k + 500);
      ctx.fillStyle = 'rgba(210,225,245,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 1.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else if (c.kind === 'snow') {
    ctx.fillStyle = `rgba(235,242,252,${0.08 + 0.14 * i})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 60 + 240 * i; k++) {
      const near = rnd(k + 9);
      const x = (rnd(k) * w + 25 * Math.sin(t * 1.1 + k)) % w;
      const y = (rnd(k + 77) * h + t * (40 + 120 * near)) % h;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + 3 * near, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
