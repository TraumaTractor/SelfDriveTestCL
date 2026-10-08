import { entriesToShow, CHANGELOG, type ChangelogEntry } from '../changelog';
import { h } from './dom';

const KEY = 'selfdrive-last-seen-version';

function readLastSeen(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function writeLastSeen(v: string): void {
  try { localStorage.setItem(KEY, v); } catch { /* storage unavailable - fine */ }
}

function show(entries: ChangelogEntry[], current: string): void {
  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
    writeLastSeen(current);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };

  const card = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': "What's new" },
    h('h2', {}, entries.length === 1 && !readLastSeen() ? `Welcome - version ${current}` : `What's new in v${current}`),
    ...entries.map((e, i) => h('section', { class: i === 0 ? 'wn latest' : 'wn' },
      h('h3', {}, i === 0 ? e.title : `v${e.version} · ${e.title}`),
      h('ul', {}, ...e.items.map((t) => h('li', {}, t))))),
    h('div', { class: 'modal-actions' }, h('button', { class: 'primary', on: { click: close } }, 'Got it')));
  const backdrop = h('div', { class: 'modal-backdrop', on: { click: (e) => { if (e.target === backdrop) close(); } } }, card);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey);
}

/** Show the "what's new" pop-up the first time a new version is opened. */
export function maybeShowWhatsNew(current: string): void {
  const entries = entriesToShow(readLastSeen(), current);
  if (entries.length === 0) { writeLastSeen(current); return; }
  show(entries, current);
}

/** Show the latest changes on demand (click the version number). */
export function showWhatsNewNow(current: string): void {
  show(CHANGELOG.slice(0, 4), current);
}
