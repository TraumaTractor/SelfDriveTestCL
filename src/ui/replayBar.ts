import type { SimEvent } from '../sim/world';
import { h } from './dom';

export interface ReplayBarHandlers {
  onSeek(t: number): void;
  onPlayToggle(): void;
  onLive(): void;
  onStep(frames: number): void;
  onBack(seconds: number): void;
  onSpeed(x: number): void;
}

export interface ReplayBarState {
  live: boolean;
  playing: boolean;
  t: number;
  start: number;
  end: number;
  events: SimEvent[];
}

const MARK_KINDS = new Set(['nearmiss', 'collision', 'hardbrake', 'cutoff', 'hazard', 'unsignalled', 'lanechange']);
const MARK_COLOUR: Record<string, string> = {
  nearmiss: '#ff4d6a', collision: '#ff4d6a', hardbrake: '#ffb000', cutoff: '#ff4d6a', hazard: '#ffd24a', unsignalled: '#ffb000', lanechange: '#7f8da0',
};

/** The timeline under the stage: scrub back through the last few minutes and jump to events. */
export function replayBar(hd: ReplayBarHandlers): { el: HTMLElement; update(s: ReplayBarState): void } {
  const slider = h('input', { type: 'range', min: '0', max: '1', step: '0.1', value: '1', class: 'rb-slider' });
  slider.addEventListener('input', () => hd.onSeek(Number(slider.value)));
  const marks = h('div', { class: 'rb-marks' });
  const label = h('span', { class: 'rb-label' });
  const live = h('button', { class: 'small rb-live', title: 'Back to the live run (L)', on: { click: () => hd.onLive() } }, '● Live');
  const play = h('button', { class: 'small', title: 'Play / pause the replay (Space)', on: { click: () => hd.onPlayToggle() } }, '▶');
  const speed = h('select', { class: 'rb-speed', title: 'Replay speed', on: { change: () => hd.onSpeed(Number(speed.value)) } },
    ...[0.25, 0.5, 1, 2].map((x) => h('option', { value: String(x), selected: x === 1 }, `${x}×`)));
  let sig = '';

  const el = h('div', { class: 'replaybar' },
    h('button', { class: 'small', title: 'Back 5 seconds (←)', on: { click: () => hd.onBack(5) } }, '⏪ 5s'),
    h('button', { class: 'small', title: 'Previous frame (Shift+← for 1 s)', on: { click: () => hd.onStep(-1) } }, '◀'),
    play,
    h('button', { class: 'small', title: 'Next frame (Shift+→ for 1 s)', on: { click: () => hd.onStep(1) } }, '▶|'),
    h('div', { class: 'rb-track' }, slider, marks),
    label, speed, live);

  return {
    el,
    update(s) {
      slider.min = String(s.start);
      slider.max = String(Math.max(s.end, s.start + 0.1));
      slider.value = String(s.live ? s.end : s.t);
      el.classList.toggle('replaying', !s.live);
      live.classList.toggle('on', s.live);
      play.textContent = s.live ? '▶' : s.playing ? '⏸' : '▶';
      label.textContent = s.live ? `live · ${s.end.toFixed(0)} s` : `replay ${s.t.toFixed(1)} s · ${(s.end - s.t).toFixed(1)} s behind`;
      const span = Math.max(s.end - s.start, 0.1);
      const shown = s.events.filter((e) => MARK_KINDS.has(e.kind) && e.t >= s.start && e.t <= s.end);
      const key = `${shown.length}:${shown[shown.length - 1]?.seq ?? 0}:${Math.round(s.start)}:${Math.round(s.end / 2)}`;
      if (key === sig) return;
      sig = key;
      marks.replaceChildren(...shown.map((e) => h('i', {
        class: `rb-mark ${e.kind}`, title: `${e.t.toFixed(1)} s - ${e.text}`,
        style: `left:${(((e.t - s.start) / span) * 100).toFixed(2)}%;background:${MARK_COLOUR[e.kind] ?? '#7f8da0'}`,
        on: { pointerdown: (ev) => { ev.preventDefault(); ev.stopPropagation(); hd.onSeek(Math.max(s.start, e.t - 3)); } },
      })));
    },
  };
}
