import type { Vehicle } from '../sim/vehicle';

/**
 * Vehicle artwork. Top-down sprites are drawn heading right (+x) around the origin;
 * rear sprites are what a following driver sees (the dashcam).
 */

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const bodyColour = (v: Vehicle): string => (v.crashed ? '#555a63' : v.color);
const GLASS = 'rgba(15,20,30,0.75)';

// ------------------------------------------------------------------------------------ top-down

export function drawTopDown(ctx: CanvasRenderingContext2D, v: Vehicle, len: number, wid: number): void {
  const body = bodyColour(v);
  const x0 = -len / 2, y0 = -wid / 2;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';

  switch (v.type) {
    case 'debris': {
      ctx.fillStyle = '#7d6a4d';
      ctx.beginPath();
      ctx.moveTo(x0, 0); ctx.lineTo(-len * 0.1, y0); ctx.lineTo(len * 0.35, y0 * 0.6); ctx.lineTo(-x0, wid * 0.1);
      ctx.lineTo(len * 0.1, -y0); ctx.lineTo(x0 * 0.5, -y0 * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4a4a4f';
      ctx.fillRect(-len * 0.12, -wid * 0.1, len * 0.3, wid * 0.22);
      break;
    }
    case 'barrier': {
      ctx.fillStyle = '#f4f4f4';
      rrect(ctx, x0, y0, len, wid, 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, len, wid);
      ctx.clip();
      ctx.fillStyle = '#d9342b';
      const step = Math.max(6, wid / 5);
      for (let y = y0 - len; y < -y0 + len; y += step * 2) {
        ctx.beginPath();
        ctx.moveTo(x0, y); ctx.lineTo(x0 + len, y + len * 0.8); ctx.lineTo(x0 + len, y + len * 0.8 + step); ctx.lineTo(x0, y + step);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      rrect(ctx, x0, y0, len, wid, 2);
      ctx.stroke();
      const lamp = Math.floor(performance.now() / 450) % 2 === 0;
      ctx.fillStyle = lamp ? '#ffb000' : '#7a5600';
      ctx.beginPath(); ctx.arc(0, y0 + 3, 3, 0, Math.PI * 2); ctx.arc(0, -y0 - 3, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'van': {
      ctx.fillStyle = body;
      rrect(ctx, x0, y0, len, wid, 3);
      ctx.fill();
      ctx.stroke();
      // cargo box (rear) with roof ribs, cab (front) with windscreen
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x0 + 1, y0 + 1, len * 0.64, wid - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x0 + (len * 0.64 * i) / 5, y0 + 1); ctx.lineTo(x0 + (len * 0.64 * i) / 5, y0 + wid - 1); ctx.stroke(); }
      ctx.fillStyle = GLASS;
      ctx.fillRect(len * 0.2, y0 + 2, len * 0.14, wid - 4);
      break;
    }
    case 'lorry': {
      const cabLen = len * 0.24;
      // trailer
      ctx.fillStyle = v.crashed ? '#555a63' : '#cdd3db';
      rrect(ctx, x0, y0, len - cabLen - len * 0.025, wid, 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      for (let i = 1; i < 9; i++) { const x = x0 + ((len - cabLen) * i) / 9; ctx.beginPath(); ctx.moveTo(x, y0 + 1); ctx.lineTo(x, y0 + wid - 1); ctx.stroke(); }
      // stripe in the driver's colour so personality stays readable
      ctx.fillStyle = body;
      ctx.fillRect(x0 + 2, -wid * 0.08, len - cabLen - len * 0.025 - 4, wid * 0.16);
      // cab
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.fillStyle = body;
      rrect(ctx, len / 2 - cabLen, y0 + wid * 0.04, cabLen, wid * 0.92, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GLASS;
      ctx.fillRect(len / 2 - cabLen * 0.42, y0 + wid * 0.14, cabLen * 0.3, wid * 0.72);
      break;
    }
    case 'coach': {
      ctx.fillStyle = body;
      rrect(ctx, x0, y0, len, wid, 5);
      ctx.fill();
      ctx.stroke();
      // roof windows
      ctx.fillStyle = GLASS;
      ctx.fillRect(x0 + len * 0.05, -wid * 0.3, len * 0.72, wid * 0.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      for (let i = 1; i < 8; i++) { const x = x0 + len * 0.05 + (len * 0.72 * i) / 8; ctx.beginPath(); ctx.moveTo(x, -wid * 0.3); ctx.lineTo(x, wid * 0.3); ctx.stroke(); }
      ctx.fillStyle = GLASS;
      ctx.fillRect(len * 0.36, y0 + 2, len * 0.1, wid - 4);
      break;
    }
    case 'motorcycle': {
      const w = Math.max(wid * 0.95, 9); // exaggerated a little so bikes stay visible when zoomed out
      ctx.fillStyle = '#1b1f26';
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.5, w * 0.22, 0, 0, Math.PI * 2); // frame and wheels
      ctx.fill();
      ctx.fillStyle = body; // rider
      ctx.beginPath();
      ctx.ellipse(len * 0.02, 0, len * 0.2, w * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1b1f26'; // handlebars
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(len * 0.26, -w * 0.45);
      ctx.lineTo(len * 0.26, w * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#10141a'; // helmet
      ctx.beginPath();
      ctx.arc(len * 0.14, 0, Math.max(2, w * 0.24), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = body;
      rrect(ctx, x0, y0, len, wid, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GLASS;
      ctx.fillRect(len * 0.12, y0 + 2, len * 0.2, wid - 4); // windscreen
      ctx.fillRect(-len * 0.34, y0 + 3, len * 0.1, wid - 6); // rear window
    }
  }
}

/** Where the rear lights sit for the top-down sprite (x is the rear edge; ys are lateral offsets). */
export function topDownLightOffsets(v: Vehicle, wid: number): number[] {
  return v.type === 'motorcycle' ? [0] : [-wid / 2 + 3, wid / 2 - 3];
}

// ------------------------------------------------------------------------------------ rear view

/**
 * Draw the back of a vehicle into the box (x, y, w, h): y is the roof, y + h is the road.
 */
export function drawRear(ctx: CanvasRenderingContext2D, v: Vehicle, x: number, y: number, w: number, h: number, time: number): void {
  const body = bodyColour(v);
  const braking = !v.crashed && v.a < -1;
  const tail = braking ? '#ff2a2a' : '#7a1c22';
  const lit = (px: number, py: number, pw: number, ph: number) => {
    ctx.fillStyle = tail;
    ctx.fillRect(px, py, pw, ph);
    if (braking && w > 10) { ctx.fillStyle = 'rgba(255,42,42,0.3)'; ctx.fillRect(px - 2, py - 1, pw + 4, ph + 2); }
  };

  // contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h, w * 0.58, Math.max(1, h * 0.06), 0, 0, Math.PI * 2);
  ctx.fill();

  switch (v.type) {
    case 'debris': {
      ctx.fillStyle = '#7d6a4d';
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.2, y + h * 0.3); ctx.lineTo(x + w * 0.5, y + h * 0.6); ctx.lineTo(x + w * 0.75, y + h * 0.1); ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#4a4a4f';
      ctx.fillRect(x + w * 0.35, y + h * 0.65, w * 0.25, h * 0.3);
      break;
    }
    case 'barrier': {
      // a striped board on two legs with warning lamps
      ctx.fillStyle = '#555a63';
      ctx.fillRect(x + w * 0.08, y + h * 0.5, Math.max(2, w * 0.03), h * 0.5);
      ctx.fillRect(x + w * 0.9, y + h * 0.5, Math.max(2, w * 0.03), h * 0.5);
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(x, y + h * 0.1, w, h * 0.42);
      ctx.fillStyle = '#d9342b';
      const n = Math.max(6, Math.floor(w / 12));
      for (let i = 0; i < n; i += 2) {
        ctx.beginPath();
        ctx.moveTo(x + (w * i) / n, y + h * 0.52); ctx.lineTo(x + (w * (i + 1)) / n, y + h * 0.52);
        ctx.lineTo(x + (w * (i + 2)) / n, y + h * 0.1); ctx.lineTo(x + (w * (i + 1)) / n, y + h * 0.1);
        ctx.closePath();
        ctx.fill();
      }
      const lamp = Math.floor(time * 2.2) % 2 === 0;
      ctx.fillStyle = lamp ? '#ffb000' : '#7a5600';
      const r = Math.max(2, w * 0.04);
      ctx.beginPath(); ctx.arc(x + w * 0.1, y + h * 0.06, r, 0, Math.PI * 2); ctx.arc(x + w * 0.9, y + h * 0.06, r, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'van': {
      ctx.fillStyle = body;
      rrect(ctx, x, y, w, h * 0.92, Math.min(5, w * 0.08));
      ctx.fill();
      ctx.fillStyle = GLASS;
      ctx.fillRect(x + w * 0.08, y + h * 0.1, w * 0.38, h * 0.26); // rear door windows
      ctx.fillRect(x + w * 0.54, y + h * 0.1, w * 0.38, h * 0.26);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; // door split
      ctx.fillRect(x + w * 0.495, y + h * 0.05, Math.max(1, w * 0.012), h * 0.8);
      ctx.fillStyle = '#1b1f26';
      ctx.fillRect(x + w * 0.04, y + h * 0.84, w * 0.92, h * 0.08);
      if (!v.crashed) { lit(x + w * 0.03, y + h * 0.5, w * 0.07, h * 0.2); lit(x + w * 0.9, y + h * 0.5, w * 0.07, h * 0.2); }
      break;
    }
    case 'lorry': {
      ctx.fillStyle = v.crashed ? '#555a63' : '#c8ced6';
      rrect(ctx, x, y, w, h * 0.9, Math.min(3, w * 0.03));
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; // double doors
      ctx.fillRect(x + w * 0.495, y + h * 0.04, Math.max(1, w * 0.012), h * 0.78);
      ctx.fillStyle = body; // driver-colour band
      ctx.fillRect(x + w * 0.02, y + h * 0.42, w * 0.96, h * 0.07);
      // red/yellow conspicuity strip
      const n = Math.max(6, Math.floor(w / 10));
      for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#e8c91a' : '#d22b2b'; ctx.fillRect(x + (w * i) / n, y + h * 0.77, w / n + 0.5, h * 0.05); }
      ctx.fillStyle = '#1b1f26'; // underrun bar and wheels
      ctx.fillRect(x + w * 0.04, y + h * 0.88, w * 0.92, h * 0.04);
      ctx.fillRect(x + w * 0.02, y + h * 0.8, w * 0.1, h * 0.2);
      ctx.fillRect(x + w * 0.88, y + h * 0.8, w * 0.1, h * 0.2);
      if (!v.crashed) { lit(x + w * 0.03, y + h * 0.6, w * 0.07, h * 0.12); lit(x + w * 0.9, y + h * 0.6, w * 0.07, h * 0.12); }
      break;
    }
    case 'coach': {
      ctx.fillStyle = body;
      rrect(ctx, x, y, w, h * 0.9, Math.min(7, w * 0.08));
      ctx.fill();
      ctx.fillStyle = GLASS;
      ctx.fillRect(x + w * 0.1, y + h * 0.12, w * 0.8, h * 0.28); // rear window
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; // engine vents
      for (let i = 0; i < 4; i++) ctx.fillRect(x + w * 0.32, y + h * (0.52 + i * 0.06), w * 0.36, Math.max(1, h * 0.02));
      ctx.fillStyle = '#1b1f26';
      ctx.fillRect(x + w * 0.02, y + h * 0.84, w * 0.96, h * 0.06);
      if (!v.crashed) { lit(x + w * 0.03, y + h * 0.58, w * 0.07, h * 0.12); lit(x + w * 0.9, y + h * 0.58, w * 0.07, h * 0.12); }
      break;
    }
    case 'motorcycle': {
      const cx = x + w / 2;
      ctx.fillStyle = '#1b1f26'; // rear wheel
      ctx.beginPath();
      ctx.ellipse(cx, y + h * 0.9, w * 0.11, h * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body; // rider's back
      rrect(ctx, cx - w * 0.34, y + h * 0.22, w * 0.68, h * 0.44, w * 0.2);
      ctx.fill();
      ctx.fillStyle = '#10141a'; // helmet
      ctx.beginPath();
      ctx.arc(cx, y + h * 0.13, w * 0.24, 0, Math.PI * 2);
      ctx.fill();
      if (!v.crashed) lit(cx - w * 0.12, y + h * 0.68, w * 0.24, Math.max(2, h * 0.07));
      break;
    }
    default: {
      ctx.fillStyle = body;
      rrect(ctx, x, y + h * (0.18), w, h * 0.82, Math.min(6, w * 0.12));
      ctx.fill();
      ctx.fillStyle = GLASS;
      ctx.fillRect(x + w * 0.14, y + h * 0.24, w * 0.72, h * 0.24);
      if (!v.crashed) { lit(x + w * 0.04, y + h * 0.62, w * 0.2, Math.max(2, h * 0.1)); lit(x + w * 0.76, y + h * 0.62, w * 0.2, Math.max(2, h * 0.1)); }
    }
  }

  if (!v.crashed && v.type !== 'motorcycle' && v.type !== 'debris' && v.type !== 'barrier') { // number plate
    ctx.fillStyle = '#e9e4c9';
    ctx.fillRect(x + w * 0.38, y + h * (v.type === 'lorry' ? 0.72 : 0.68), w * 0.24, Math.max(1.5, h * 0.06));
  }

  // indicators / hazards (seen from behind, +1 = the driver's right)
  const blink = Math.floor(time * 2.5) % 2 === 0;
  if ((v.indicator !== 0 || v.crashed || v.hazard) && blink && v.type !== 'barrier') {
    ctx.fillStyle = '#ffb000';
    const size = Math.max(2, w * 0.1);
    const py = y + h * (v.type === 'motorcycle' ? 0.35 : 0.5);
    if (v.crashed || v.hazard || v.indicator === -1) ctx.fillRect(x + w * 0.01, py, size, size);
    if (v.crashed || v.hazard || v.indicator === 1) ctx.fillRect(x + w * 0.99 - size, py, size, size);
  }
}
