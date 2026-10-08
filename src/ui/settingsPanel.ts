import { getSettings, updateSettings } from '../settings';
import { h, segmented } from './dom';
import { updateHint } from './updateHints';
import { showWhatsNewNow } from './whatsNew';

/** The ⚙ Settings dialog: appearance, units, app version, what's new, and checking for updates (desktop app). */
export function showSettings(version: string): void {
  const desktop = window.desktop;
  const close = () => { backdrop.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

  const status = h('div', { class: 'opt-status' });
  const actions = h('div', { class: 'row' });
  const checkBtn = h('button', { class: 'primary' }, 'Check for updates');

  const say = (text: string, tone: '' | 'good' | 'warn' | 'bad' = '') => {
    status.textContent = text;
    status.className = `opt-status ${tone}`;
  };

  async function check(): Promise<void> {
    if (!desktop) return;
    checkBtn.disabled = true;
    actions.replaceChildren();
    say('Checking…');
    try {
      const r = await desktop.checkForUpdates();
      switch (r.status) {
        case 'up-to-date': say(`You're up to date (v${r.version}).`, 'good'); break;
        case 'ready':
          say(`Version ${r.version} has been downloaded and is ready.${r.notes ? '\n\n' + r.notes : ''}`, 'good');
          actions.append(h('button', { class: 'primary', on: { click: () => desktop.restart() } }, 'Restart now'));
          break;
        case 'needs-installer':
          say(`Version ${r.version} changes the app shell itself, so it needs a new installer (one-off).`, 'warn');
          if (r.url) actions.append(h('button', { on: { click: () => window.open(r.url, '_blank') } }, 'Open download page'));
          break;
        case 'disabled': say('Updates are only checked in the installed app, not when run from source.', 'warn'); break;
        case 'busy': say('Already checking - try again in a moment.', 'warn'); break;
        default: {
          say(`Couldn't check for updates: ${r.message ?? 'unknown error'}\n\n${updateHint(r.code) || r.hint || ''}`.trim(), 'bad');
          if (r.code === 'private-or-missing' || r.code === 'denied') {
            actions.append(h('button', { title: 'Copy a read-only GitHub token first', on: { click: async () => {
              const t = await desktop.useTokenFromClipboard();
              say(t.message, t.ok ? 'good' : 'warn');
              if (t.ok) { actions.replaceChildren(); void check(); }
            } } }, 'Use token from clipboard'));
          }
        }
      }
    } catch (e) {
      say(`Couldn't check for updates: ${(e as Error).message}`, 'bad');
    } finally {
      checkBtn.disabled = false;
    }
  }

  checkBtn.addEventListener('click', () => void check());
  if (!desktop) {
    checkBtn.disabled = true;
    say('This is the web version: reload the page to get the latest. The desktop app checks for updates itself, and you can check here too.');
  } else {
    void desktop.info().then((i) => {
      if (i.ready) {
        say(`Version ${i.ready.version} is downloaded and waiting for a restart.`, 'good');
        actions.append(h('button', { class: 'primary', on: { click: () => desktop.restart() } }, 'Restart now'));
      } else say(`Running v${i.version}${i.updated ? ' (updated)' : ''}. The app also checks by itself every few hours.`);
    });
  }

  const card = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    h('h2', {}, '⚙ Settings'),
    h('section', { class: 'wn latest' },
      h('h3', {}, 'Appearance'),
      h('div', { class: 'set-row' }, h('span', {}, 'Theme', h('small', {}, 'Auto follows your system')),
        segmented({ name: 'theme', options: [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], value: getSettings().theme, onChange: (theme) => updateSettings({ theme }) })),
      h('div', { class: 'set-row' }, h('span', {}, 'Units', h('small', {}, 'km/h and metres, or mph and feet')),
        segmented({ name: 'units', options: [['metric', 'Metric'], ['imperial', 'Imperial']], value: getSettings().units, onChange: (units) => updateSettings({ units }) }))),
    h('section', { class: 'wn' },
      h('h3', {}, 'About'),
      h('div', { class: 'row' }, h('span', {}, `Self-Drive Test Bench v${version}`),
        h('button', { class: 'small', on: { click: () => { close(); showWhatsNewNow(version); } } }, "What's new"))),
    h('section', { class: 'wn' },
      h('h3', {}, 'Updates'),
      h('div', { class: 'row' }, checkBtn), status, actions),
    h('div', { class: 'modal-actions' }, h('button', { on: { click: close } }, 'Close')));
  const backdrop = h('div', { class: 'modal-backdrop', on: { click: (e) => { if (e.target === backdrop) close(); } } }, card);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey);
}
