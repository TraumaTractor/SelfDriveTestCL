import type { SoundSettings } from './settings';
import type { Conditions } from './sim/weather';

export type Cue = 'tick' | 'tock' | 'nearmiss' | 'emergency' | 'hardbrake' | 'collision' | 'horn' | 'lane' | 'hazard' | 'pause';

/**
 * Small synthesised sound cues (Web Audio - no files). Everything is silent until sound is switched on, and
 * the audio context is only created after the first click or key press, as browsers require.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lastBlink = -1;
  private tickToggle = false;
  private cfg: SoundSettings | null = null;

  configure(cfg: SoundSettings): void {
    this.cfg = cfg;
    if (this.master) this.master.gain.value = cfg.on ? cfg.volume : 0;
    if (!cfg.on || !cfg.ambient) this.setAmbient(null);
    if (cfg.on) this.ensure();
  }

  /** Create / resume the audio context (needs to happen after a user gesture). */
  private ensure(): AudioContext | null {
    if (!this.cfg?.on || typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.cfg.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noiseBuffer(seconds: number): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private burst(dur: number, gain: number, freq: number, q = 1, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const buf = this.noiseBuffer(dur);
    if (!buf) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  play(cue: Cue): void {
    const c = this.cfg;
    if (!c?.on) return;
    switch (cue) {
      case 'tick': if (c.indicator) this.burst(0.03, 0.5, 3200, 4); break;
      case 'tock': if (c.indicator) this.burst(0.035, 0.45, 1900, 4); break;
      case 'nearmiss':
        if (c.warnings) { this.tone(880, 0.12, 'sine', 0.3); this.tone(660, 0.12, 'sine', 0.3, 0.16); this.tone(880, 0.12, 'sine', 0.3, 0.32); }
        break;
      case 'emergency':
        if (c.warnings) for (let i = 0; i < 3; i++) this.tone(440, 0.09, 'square', 0.16, i * 0.13);
        break;
      case 'hardbrake': if (c.warnings) this.tone(150, 0.25, 'triangle', 0.35, 0, 70); break;
      case 'collision':
        if (c.collision) { this.burst(0.5, 0.9, 700, 0.6); this.tone(110, 0.55, 'sawtooth', 0.35, 0, 38); }
        break;
      case 'horn': if (c.horn) { this.tone(420, 0.28, 'square', 0.12); this.tone(530, 0.28, 'square', 0.1); } break;
      case 'lane': if (c.lane) this.burst(0.18, 0.18, 900, 0.8); break;
      case 'hazard':
        if (c.hazard) { this.tone(660, 0.14, 'sine', 0.2); this.tone(990, 0.2, 'sine', 0.2, 0.15); }
        break;
      case 'pause': if (c.warnings) this.tone(520, 0.1, 'sine', 0.22); break;
    }
  }

  /** Indicator ticking (in step with the blinking light) - call every frame. */
  update(simTime: number, indicatorOn: boolean): void {
    if (!this.cfg?.on) return;
    if (!indicatorOn) { this.lastBlink = -1; return; }
    const phase = Math.floor(simTime * 2.5); // the lights blink at 2.5 Hz, toggling every 0.4 s
    if (phase !== this.lastBlink) {
      if (this.lastBlink >= 0) this.play((this.tickToggle = !this.tickToggle) ? 'tick' : 'tock');
      this.lastBlink = phase;
    }
  }

  /** Quiet rain / snow-hiss bed under everything while the weather is bad. */
  weather(c: Conditions | null): void {
    if (!this.cfg?.on || !this.cfg.ambient || !c || c.kind === 'clear' || c.kind === 'fog' || c.intensity <= 0) {
      this.setAmbient(null);
      return;
    }
    this.setAmbient(c.kind === 'rain' ? 0.05 + 0.1 * c.intensity : 0.015 + 0.02 * c.intensity, c.kind === 'rain' ? 2500 : 900);
  }

  private setAmbient(level: number | null, freq = 2500): void {
    if (level === null) {
      if (this.ambient && this.ctx) {
        const { src, gain } = this.ambient;
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        setTimeout(() => src.stop(), 800);
        this.ambient = null;
      }
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.ambient) {
      const buf = this.noiseBuffer(2);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(f).connect(gain).connect(this.master);
      src.start();
      this.ambient = { src, gain };
    }
    this.ambient.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
  }
}
