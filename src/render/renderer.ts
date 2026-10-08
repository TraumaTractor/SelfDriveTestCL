import * as U from '../units';
import { theme } from '../theme';
import { VEHICLE_SPECS } from '../sim/vehicle';
import { drawTopDown, topDownLightOffsets } from './sprites';
import { drawTopDownWeather, fogAlpha, weatherBadge } from './weatherFx';
import type { EgoReport } from '../ego/egoDriver';
import { RULE_BY_ID } from '../ego/rules';
import { rampAt, rampInstances, speedLimitAt, wrapS, zoneInstances } from '../sim/road';
import type { Vehicle } from '../sim/vehicle';
import type { World } from '../sim/world';

export interface RenderOptions {
  /** pixels per metre along the road */
  zoom: number;
  showSensors: boolean;
  showLabels: boolean;
  alpha: number;
  report: EgoReport | null;
  /** forward sensor range in metres */
  sensorRange: number;
}

const Y_STRETCH = 1.8;

const PALETTE = {
  dark: { grass: '#1f3a2a', asphalt: '#34383f', ramp: '#3d424b', tree1: '#2b5a3c', tree2: '#27503a', ramps: '#8d94a0' },
  light: { grass: '#79a867', asphalt: '#5b616b', ramp: '#676d78', tree1: '#4f8a4a', tree2: '#5b9a54', ramps: '#d5dae2' },
}; // exaggerate lateral scale so lanes are readable

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pal = PALETTE.dark;
  private smoothA = new Map<number, number>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(100, Math.floor(rect.width));
    this.h = Math.max(100, Math.floor(rect.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
  }

  draw(world: World, o: RenderOptions): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sx = o.zoom;
    const sy = o.zoom * Y_STRETCH;
    const lw = world.road.laneWidth;
    const lanes = world.road.lanes;

    const ego = world.ego;
    const egoS = lerp(ego.prevS, ego.s, o.alpha);
    const camS = egoS + this.w / sx * 0.18; // ego sits left of centre
    const sOf = (px: number) => camS + (px - this.w / 2) / sx;
    const xOf = (s: number) => (s - camS) * sx + this.w / 2;

    // Vehicles drive left-to-right and keep LEFT (UK style): the slow lane (lane 0) is the
    // driver's left, i.e. the top of the screen. Overtaking lanes are below it, on-ramps join on the left.
    const roadH = (lanes + 1) * lw * sy;
    const lane0Y = this.h / 2 - roadH / 2 + lw * sy * 1.5 + 44;
    const yOf = (lane: number) => lane0Y + lane * lw * sy;

    // grass + scenery
    const pal = PALETTE[theme()];
    this.pal = pal;
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, 0, this.w, this.h);
    this.scenery(sOf(0), sOf(this.w), xOf, yOf, lanes, lw * sy, sx);

    // asphalt
    const top = yOf(0) - lw * sy / 2;
    const bot = yOf(lanes - 1) + lw * sy / 2;
    ctx.fillStyle = pal.asphalt;
    ctx.fillRect(0, top, this.w, bot - top);
    // verge line along the outer (overtaking) edge
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, bot - 2, this.w, 2);

    // ramps (acceleration lanes) with tapers
    const rampY = yOf(-1);
    for (const { ramp: r } of rampInstances(world.road, sOf(0) - 60, sOf(this.w) + 60)) {
      const x0 = xOf(r.start), x1 = xOf(r.end);
      if (x1 < -50 || x0 > this.w + 50) continue;
      const rampH = lw * sy;
      ctx.fillStyle = pal.ramp;
      ctx.beginPath();
      ctx.moveTo(x0 - 40, rampY - rampH / 2);
      ctx.lineTo(x0 + 30, rampY + rampH / 2);
      ctx.lineTo(x1, rampY + rampH / 2);
      ctx.lineTo(x1, rampY - rampH / 2);
      ctx.closePath();
      ctx.fill();
      // broken line separating the ramp from the slow lane
      ctx.strokeStyle = '#d9d9d9';
      ctx.lineWidth = 2;
      ctx.setLineDash([sx * 1.5, sx * 1.5]);
      ctx.beginPath();
      ctx.moveTo(x0 + 30, rampY + rampH / 2);
      ctx.lineTo(x1, rampY + rampH / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // end barrier
      ctx.fillStyle = '#d4a20f';
      ctx.fillRect(x1 - 2, rampY - rampH / 2, 4, rampH);
      this.text(`ON-RAMP`, x0 + 30, rampY + 4, pal.ramps, 10);
    }

    // lane markings
    ctx.lineWidth = 2;
    for (let l = 0; l < lanes - 1; l++) {
      const y = yOf(l) + lw * sy / 2;
      ctx.strokeStyle = '#d9d9d9';
      ctx.setLineDash([sx * 3, sx * 6]);
      ctx.lineDashOffset = -((-camS * sx) % (sx * 9));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // solid edge line along the slow lane (broken where a ramp joins)
    ctx.strokeStyle = '#d9d9d9';
    ctx.beginPath();
    const edgeY = yOf(0) - lw * sy / 2;
    let x = 0;
    const rampsSorted = rampInstances(world.road, sOf(0) - 60, sOf(this.w) + 60).map((i) => i.ramp).sort((a, b) => a.start - b.start);
    for (const r of rampsSorted) {
      const x0 = xOf(r.start), x1 = xOf(r.end);
      if (x0 > x) { ctx.moveTo(x, edgeY); ctx.lineTo(Math.min(x0, this.w), edgeY); }
      x = Math.max(x, x1);
    }
    if (x < this.w) { ctx.moveTo(x, edgeY); ctx.lineTo(this.w, edgeY); }
    ctx.stroke();

    // speed limit signs
    for (const z of zoneInstances(world.road, sOf(0), sOf(this.w))) {
      const px = xOf(z.start);
      if (px < -40 || px > this.w + 40) continue;
      this.sign(px, bot + 16, Math.round(U.speedValue(z.limit) / (U.getUnits() === 'imperial' ? 5 : 10)) * (U.getUnits() === 'imperial' ? 5 : 10));
    }

    // vehicles (wrecks first so they sit underneath)
    const sorted = [...world.vehicles].sort((a, b) => Number(b.crashed) - Number(a.crashed));
    for (const v of sorted) {
      const vs = lerp(v.prevS, v.s, o.alpha);
      const vy = lerp(v.prevY, v.y, o.alpha);
      const px = xOf(vs);
      if (px < -60 || px > this.w + 60) continue;
      ctx.globalAlpha = fogAlpha(vs - egoS, world.conditions);
      this.vehicle(v, px, yOf(vy), sx, lw * sy, world.time);
      ctx.globalAlpha = 1;
      if (o.showLabels && v !== ego && !v.crashed) {
        this.text(v.label.slice(0, 3).toUpperCase(), px, yOf(vy) - lw * sy * 0.45, v.color, 9, 'center');
      }
    }

    drawTopDownWeather(ctx, this.w, this.h, world.conditions, performance.now() / 1000);

    // ego overlays
    if (o.showSensors && !ego.crashed) this.sensors(world, o, xOf, yOf, sx, lw * sy);
    this.hud(world, o);
  }

  // ------------------------------------------------------------- pieces

  private vehicle(v: Vehicle, px: number, py: number, sx: number, laneH: number, time: number): void {
    const { ctx } = this;
    const len = v.length * sx;
    const wid = Math.min(laneH * 0.62, len * 0.55) * (v.width / 1.9) ** 0.5;
    ctx.save();
    ctx.translate(px, py);
    // lateral movement tilt
    if (v.changing) ctx.rotate(Math.atan2(-(v.targetLane - v.y) * 0.25, 1) * -1 * 0.6);

    drawTopDown(ctx, v, len, wid);
    if (v.kind === 'ego') {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      roundRect(ctx, -len / 2, -wid / 2, len, wid, 4);
      ctx.stroke();
    }
    // brake lights
    if (!v.crashed && v.a < -1) {
      ctx.fillStyle = '#ff2a2a';
      for (const dy of topDownLightOffsets(v, wid)) ctx.fillRect(-len / 2 - 1, dy - 2, 3, 4);
    }
    // indicators / hazards
    const blink = Math.floor(time * 2.5) % 2 === 0;
    const hazards = v.crashed;
    if ((v.indicator !== 0 || hazards) && blink) {
      ctx.fillStyle = '#ffb000';
      const edge = v.type === 'motorcycle' ? Math.max(3, wid * 0.3) : wid / 2 - 2;
      const lit = (side: number) => {
        ctx.beginPath();
        ctx.arc(len / 2 - 2, side * edge, 3, 0, Math.PI * 2);
        ctx.arc(-len / 2 + 2, side * edge, 3, 0, Math.PI * 2);
        ctx.fill();
      };
      if (hazards || v.indicator === 1) lit(1); // overtaking side = down on screen
      if (hazards || v.indicator === -1) lit(-1);
    }
    if (v.crashed) {
      ctx.strokeStyle = '#ff4d6a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-len / 3, -wid / 3); ctx.lineTo(len / 3, wid / 3);
      ctx.moveTo(-len / 3, wid / 3); ctx.lineTo(len / 3, -wid / 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private sensors(world: World, o: RenderOptions, xOf: (s: number) => number, yOf: (l: number) => number, sx: number, laneH: number): void {
    const { ctx } = this;
    const ego = world.ego;
    const ex = xOf(lerp(ego.prevS, ego.s, o.alpha));
    const ey = yOf(lerp(ego.prevY, ego.y, o.alpha));

    // forward sensor field in our lane
    const reach = o.sensorRange * sx;
    const grad = ctx.createLinearGradient(ex, 0, ex + reach, 0);
    grad.addColorStop(0, 'rgba(53,224,255,0.16)');
    grad.addColorStop(1, 'rgba(53,224,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(ex + ego.length * sx / 2, ey - laneH * 0.48, reach, laneH * 0.96);

    const t = this.tracked(world);
    if (t) {
      const lead = t.veh;
      const lx = xOf(lerp(lead.prevS, lead.s, o.alpha));
      const ly = yOf(lerp(lead.prevY, lead.y, o.alpha));
      const danger = t.gap / Math.max(ego.v, 1) < 1;
      ctx.strokeStyle = danger ? '#ff4d6a' : '#35e0ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ex + ego.length * sx / 2, ey);
      ctx.lineTo(lx - lead.length * sx / 2, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      this.text(`${U.dist(t.gap)} · ${(t.gap / Math.max(ego.v, 0.1)).toFixed(1)} s`, (ex + lx) / 2, Math.min(ey, ly) + laneH * 0.62, danger ? '#ff4d6a' : '#35e0ff', 11, 'center');

      // tracking tag attached to the tracked vehicle
      const accCol = t.a < -0.8 ? '#ff4d6a' : t.a > 0.8 ? '#3ecf8e' : '#cfd6e0';
      const arrow = t.a < -0.8 ? '▼' : t.a > 0.8 ? '▲' : '■';
      const l1 = `${t.name} ${t.noun} · ${U.speed(lead.v)}`;
      const l2 = `${arrow} ${U.accel(t.a, true)}  (${U.force(t.kN)})`;
      const w = 150, hgt = 34;
      const tx = Math.min(Math.max(lx - w / 2, 6), this.w - w - 6);
      const ty = ly - laneH * 0.5 - hgt - 4;
      ctx.fillStyle = 'rgba(10,14,20,0.82)';
      roundRect(ctx, tx, ty, w, hgt, 6);
      ctx.fill();
      ctx.strokeStyle = danger ? '#ff4d6a' : 'rgba(53,224,255,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this.text(l1, tx + 8, ty + 14, '#ffffff', 11);
      this.text(l2, tx + 8, ty + 28, accCol, 11);
      // bracket around the tracked car
      ctx.strokeStyle = danger ? '#ff4d6a' : '#35e0ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(lx - lead.length * sx / 2 - 3, ly - laneH * 0.36, lead.length * sx + 6, laneH * 0.72);
    }

    // impact of the lane change currently under consideration on the driver it would pull in front of
    const chk = o.report?.check;
    const im = chk?.impact;
    if (chk && im && im.follower) {
      const f = im.follower;
      const fx = xOf(lerp(f.prevS, f.s, o.alpha));
      const fy = yOf(lerp(f.prevY, f.y, o.alpha));
      const col = chk.ok ? '#3ecf8e' : '#ff4d6a';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeRect(fx - f.length * sx / 2 - 3, fy - laneH * 0.36, f.length * sx + 6, laneH * 0.72);
      const l1 = `they would brake ${U.accel(im.imposedDecel)} (limit ${U.accel(chk.limit)})`;
      const l2 = `${U.dist(Math.max(0, im.followerGap))} back · ${U.speedDelta(im.followerClosing)} vs us`;
      const w = 205, hgt = 34;
      const tx = Math.min(Math.max(fx - w / 2, 6), this.w - w - 6);
      const ty = fy + laneH * 0.5 + 4;
      ctx.fillStyle = 'rgba(10,14,20,0.85)';
      roundRect(ctx, tx, ty, w, hgt, 6);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.stroke();
      this.text(l1, tx + 8, ty + 14, col, 11);
      this.text(l2, tx + 8, ty + 28, '#cfd6e0', 11);
    }
    const rep = o.report;
    if (rep && rep.pendingLane !== null) {
      ctx.strokeStyle = 'rgba(255,176,0,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(ex - 60, yOf(rep.pendingLane) - laneH / 2 + 3, 200, laneH - 6);
      ctx.setLineDash([]);
    }
    // ramp cars the ego is aware of
    for (const v of world.vehicles) {
      if (v.onRamp && Math.abs(v.s - ego.s) < 120 && !v.crashed) {
        ctx.strokeStyle = 'rgba(255,176,0,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(xOf(v.s) - v.length * sx / 2 - 3, yOf(v.y) - laneH * 0.35, v.length * sx + 6, laneH * 0.7);
      }
    }
  }

  /** The vehicle the ego is currently tracking: whatever is ahead in its lane. */
  private tracked(world: World): { veh: Vehicle; gap: number; a: number; kN: number; name: string; noun: string; closing: number; ttc: number } | null {
    const lead = world.leaderAhead(world.ego);
    if (!lead) return null;
    const v = lead.veh;
    const prev = this.smoothA.get(v.id) ?? v.a;
    const a = prev + (v.a - prev) * 0.12;
    this.smoothA.set(v.id, a);
    if (this.smoothA.size > 200) this.smoothA.clear();
    const spec = VEHICLE_SPECS[v.type];
    const mass = spec.mass;
    const closing = world.ego.v - v.v;
    return {
      veh: v, gap: lead.gap, a, kN: (mass * a) / 1000, closing,
      ttc: closing > 0.3 ? Math.max(lead.gap, 0) / closing : Infinity,
      noun: v.crashed ? '' : spec.noun,
      name: v.crashed ? 'Wreck' : (world.cfg.personalities[v.label as keyof typeof world.cfg.personalities]?.name ?? v.label),
    };
  }

  /** The "thought process" card: what the car wants, what each rule proposed, and why. Returns its bottom edge. */
  private thinking(world: World, r: EgoReport, top: number): number {
    const { ctx } = this;
    const ego = world.ego;
    const name = (id: string) => RULE_BY_ID[id]?.def.name ?? id;
    const fmt = (a: number) => U.accel(a, true);
    type Line = { text: string; color: string; bold?: boolean };
    const L: Line[] = [];
    const dim = '#8d94a0', txt = '#cfd6e0', amber = '#ffb000', red = '#ff4d6a', cyan = '#35e0ff', green = '#3ecf8e';

    // speed
    L.push({ text: `GOAL  hold ${U.speed(r.targetSpeed)} (limit ${U.speedValue(r.limit).toFixed(0)}) · now ${U.speedValue(ego.v).toFixed(0)}`, color: txt });

    // acceleration: every proposal, most restrictive first
    const props = [...r.accelProposals].sort((x, y) => x.a - y.a).slice(0, 4);
    if (props.length === 0) L.push({ text: 'SPEED  no rule is controlling speed (coasting)', color: amber });
    props.forEach((p, i) => {
      const winner = i === 0;
      L.push({
        text: `${i === 0 ? 'SPEED ' : '      '}${winner ? '▶' : ' '} ${name(p.by)} ${fmt(p.a)}${winner ? '  ◀ wins' : ''}`,
        color: winner ? (r.emergency ? red : cyan) : dim, bold: winner,
      });
    });
    if (r.clampedBy) L.push({ text: `      ⤷ ${name(r.clampedBy)} limits it to ${fmt(r.accel)}`, color: amber });
    else if (props.length) L.push({ text: `      ⤷ applying ${fmt(r.accel)}`, color: dim });
    if (r.emergency) L.push({ text: 'EMERGENCY BRAKE', color: red, bold: true });

    // lane
    const lane = ego.targetLane + 1;
    if (ego.changing) {
      const prog = Math.round((1 - Math.abs(ego.targetLane - ego.y)) * 100);
      L.push({ text: `LANE  changing ${lane - Math.sign(ego.targetLane - ego.y)}→${lane} (${prog}%)${r.signalling ? ' · indicator on' : ' · no indicator!'}`, color: green });
    } else if (r.pendingLane !== null) {
      L.push({ text: `LANE  ${name(r.laneBy ?? 'overtake')} → lane ${r.pendingLane + 1}`, color: amber });
      L.push({ text: `      signalling, moving in ${(r.signalRemaining ?? 0).toFixed(1)}s`, color: amber });
    } else if (r.vetoBy) {
      const want = r.laneProposals[0];
      L.push({ text: `LANE  ${want ? `${name(want.by)} wants lane ${want.lane + 1}` : 'lane change wanted'}`, color: txt });
      L.push({ text: `      ✖ blocked: ${r.vetoReason}`, color: red });
    } else if (r.laneProposals.length) {
      L.push({ text: `LANE  ${name(r.laneProposals[0].by)} → lane ${r.laneProposals[0].lane + 1}`, color: amber });
      L.push({ text: '      no signal rule: moving without indicating', color: red });
    } else {
      L.push({ text: `LANE  staying in lane ${lane}`, color: dim });
    }
    for (const n of r.notes.slice(0, 3)) L.push({ text: `      · ${n.text}`, color: dim });

    const w = 400, lh = 15;
    const h = 24 + L.length * lh;
    ctx.fillStyle = 'rgba(10,14,20,0.82)';
    roundRect(ctx, 10, top, w, h, 8);
    ctx.fill();
    this.text('THINKING', 20, top + 15, cyan, 10);
    L.forEach((l, i) => {
      ctx.font = `${l.bold ? '600 ' : ''}12px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillStyle = l.color;
      ctx.textAlign = 'left';
      ctx.fillText(this.fit(l.text, w - 20), 20, top + 31 + i * lh);
    });
    return top + h;
  }

  private fit(text: string, maxW: number): string {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  /** A little ring showing the whole loop: speed zones, on-ramps and where the ego is. */
  private loopRing(world: World, cx: number, cy: number, r: number): void {
    const { ctx } = this;
    const L = world.road.length;
    const ang = (s: number) => (s / L) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = 'rgba(10,14,20,0.7)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    for (const z of world.road.zones) {
      ctx.strokeStyle = z.limit > 30 ? '#4b5563' : z.limit > 25 ? '#a37a1f' : '#a33a4a';
      ctx.beginPath();
      ctx.arc(cx, cy, r, ang(z.start), ang(z.end));
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffb000';
    for (const rp of world.road.ramps) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5, ang(rp.start), ang(rp.end));
      ctx.stroke();
    }
    const a = ang(wrapS(world.road, world.ego.s));
    ctx.fillStyle = '#35e0ff';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4.5, 0, Math.PI * 2);
    ctx.fill();
    this.text(String(world.lap + 1), cx, cy + 4, '#ffffff', 11, 'center');
    this.text('LAP', cx, cy - 9, '#8d94a0', 8, 'center');
  }

  private hud(world: World, o: RenderOptions): void {
    const { ctx } = this;
    const ego = world.ego;
    const limit = speedLimitAt(world.road, ego.s);
    // speedometer card
    const wx = weatherBadge(world.conditions);
    ctx.fillStyle = 'rgba(10,14,20,0.78)';
    roundRect(ctx, 10, 10, 190, wx ? 84 : 66, 8);
    ctx.fill();
    if (wx) this.text(wx, 22, 87, '#9fd0ff', 10);
    this.text(`${U.speedValue(ego.v).toFixed(0)}`, 22, 52, '#ffffff', 34);
    this.text(U.speedUnit(), 88, 52, '#8d94a0', 12);
    this.text(`limit ${U.speedValue(limit).toFixed(0)}`, 22, 68, ego.v > limit * 1.02 ? '#ff9340' : '#8d94a0', 11);
    this.text(`lane ${ego.targetLane + 1}/${world.road.lanes}${rampAt(world.road, ego.s) ? ' · ramp' : ''} · lap ${world.lap + 1}${world.cfg.endless ? '' : '/' + Math.max(1, world.cfg.laps)}`, 100, 68, '#8d94a0', 11);

    const hudTop = wx ? 102 : 84;
    let hudBottom = hudTop;
    const r = o.report;
    if (r) hudBottom = this.thinking(world, r, hudTop);

    const t = this.tracked(world);
    ctx.fillStyle = 'rgba(10,14,20,0.78)';
    roundRect(ctx, 10, hudBottom + 8, 400, 66, 8);
    ctx.fill();
    this.text('TRACKING', 20, hudBottom + 23, '#35e0ff', 10);
    if (t) {
      const accCol = t.a < -0.8 ? '#ff4d6a' : t.a > 0.8 ? '#3ecf8e' : '#cfd6e0';
      this.text(`${t.name} ${t.noun} · ${U.speed(t.veh.v)} · ${U.dist(t.gap)} ahead`, 20, hudBottom + 39, '#ffffff', 12);
      this.text(`momentum ${U.force(t.kN)} (${U.accel(t.a, true)})`, 20, hudBottom + 54, accCol, 12);
      this.text(`closing ${U.speedDelta(t.closing)} · TTC ${Number.isFinite(t.ttc) ? t.ttc.toFixed(1) + ' s' : '—'}`, 20, hudBottom + 69, t.ttc < 2.5 ? '#ff9340' : '#cfd6e0', 12);
    } else {
      this.text('nothing ahead in range', 20, hudBottom + 42, '#8d94a0', 12);
    }

    // progress along the current lap
    const stripY = this.h - 14, x0 = 12, x1 = this.w - 12;
    const L = world.road.length;
    const lapPos = wrapS(world.road, ego.s);
    ctx.fillStyle = '#10141a';
    ctx.fillRect(x0, stripY, x1 - x0, 6);
    const px = (s: number) => x0 + (s / L) * (x1 - x0);
    for (const rp of world.road.ramps) {
      ctx.fillStyle = '#d4a20f';
      ctx.fillRect(px(rp.start), stripY - 3, Math.max(2, px(rp.end) - px(rp.start)), 3);
    }
    ctx.fillStyle = '#35e0ff';
    ctx.fillRect(x0, stripY, px(lapPos) - x0, 6);
    ctx.beginPath();
    ctx.arc(px(lapPos), stripY + 3, 5, 0, Math.PI * 2);
    ctx.fill();

    this.loopRing(world, this.w - 44, this.h - 70, 26);

    if (world.status !== 'running') {
      const label = world.status === 'finished' ? 'FINISHED' : world.status === 'crashed' ? 'CRASHED' : 'TIMED OUT';
      ctx.fillStyle = 'rgba(10,14,20,0.82)';
      roundRect(ctx, this.w / 2 - 110, this.h / 2 - 30, 220, 60, 10);
      ctx.fill();
      this.text(label, this.w / 2, this.h / 2 + 10, world.status === 'finished' ? '#3ecf8e' : '#ff4d6a', 28, 'center');
    }
  }

  private scenery(s0: number, s1: number, xOf: (s: number) => number, yOf: (l: number) => number, lanes: number, laneH: number, sx: number): void {
    const { ctx } = this;
    const top = yOf(0) - laneH * 1.5;
    const bot = yOf(lanes - 1) + laneH / 2;
    const step = 37;
    for (let s = Math.floor(s0 / step) * step; s < s1 + step; s += step) {
      const hsh = hash(s);
      const x = xOf(s + (hsh % 17));
      const r = 4 + (hsh % 5) * sx / 6;
      ctx.fillStyle = hsh % 3 === 0 ? this.pal.tree1 : this.pal.tree2;
      ctx.beginPath();
      ctx.arc(x, top - 28 - (hsh % 23), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 11, bot + 28 + ((hsh >> 3) % 25) + laneH * 0.6, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private sign(x: number, y: number, kmh: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d6232a';
    ctx.lineWidth = 3;
    ctx.stroke();
    this.text(String(kmh), x, y + 4, '#111', 11, 'center');
  }

  private text(t: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left'): void {
    const { ctx } = this;
    ctx.font = `${size >= 20 ? '700 ' : ''}${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash(n: number): number {
  let x = Math.floor(n) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
