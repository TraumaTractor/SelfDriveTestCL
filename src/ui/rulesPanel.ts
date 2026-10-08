import { PRESETS } from '../ego/presets';
import { RULE_BY_ID, RuleSet } from '../ego/rules';
import { h, slider } from './dom';
import type { App, Panel } from './state';

const ALERT_RULES = new Set(['emergency-brake', 'lane-change-safety']);

export function rulesPanel(app: App): Panel {
  const el = h('div');
  const cards = new Map<string, HTMLElement>();
  const open = new Set<string>();

  function build(): void {
    el.replaceChildren();
    cards.clear();

    const presetSel = h('select', {},
      h('option', { value: '' }, 'Load preset…'),
      ...PRESETS.map((p, i) => h('option', { value: String(i), title: p.description }, p.name)));
    presetSel.addEventListener('change', () => {
      if (presetSel.value === '') return;
      app.setRules(PRESETS[Number(presetSel.value)].build());
    });

    const box = h('textarea', { spellcheck: false, placeholder: 'Rule set JSON appears here' });
    const status = h('div', { class: 'note' });
    el.append(
      h('div', { class: 'row' }, presetSel,
        h('button', { class: 'small', on: { click: () => { box.value = JSON.stringify(app.rules.toJSON(), null, 2); status.textContent = 'Exported current rules.'; } } }, 'Export'),
        h('button', { class: 'small', on: { click: () => {
          try { app.setRules(RuleSet.fromJSON(JSON.parse(box.value))); status.textContent = 'Imported.'; }
          catch (e) { status.textContent = `Import failed: ${(e as Error).message}`; }
        } } }, 'Import'),
        h('button', { class: 'small', on: { click: () => app.setRules(new RuleSet()) } }, 'Reset')),
      h('p', { class: 'note' },
        'Rules run top to bottom. Acceleration proposals are resolved most-restrictive-wins; for lane changes the first rule to propose wins, so order matters. ',
        'Filters run last and can veto or adjust. Edits apply live.'),
    );

    for (const item of app.rules.items) {
      const impl = RULE_BY_ID[item.id];
      const def = impl.def;
      const body = h('div', { class: 'card-body' }, h('p', {}, def.description),
        ...def.params.map((prm) => slider({
          label: prm.label, min: prm.min, max: prm.max, step: prm.step, unit: prm.unit, hint: prm.hint,
          value: item.params[prm.key],
          onInput: (v) => { item.params[prm.key] = v; app.rulesChanged(); },
        })));
      body.hidden = !open.has(item.id);

      const check = h('input', { type: 'checkbox', checked: item.enabled });
      const card = h('div', { class: `card${item.enabled ? '' : ' off'}${ALERT_RULES.has(item.id) ? ' alert' : ''}` },
        h('div', { class: 'card-head' },
          h('span', { class: 'dot' }),
          check,
          h('span', { class: 'name', on: { click: () => {
            body.hidden = !body.hidden;
            if (body.hidden) open.delete(item.id); else open.add(item.id);
          } } }, def.name),
          h('span', { class: 'tag' }, def.phase === 'post' ? 'filter' : 'rule'),
          h('button', { class: 'small', title: 'Move up', on: { click: () => { app.rules.move(item.id, -1); app.rulesChanged(); build(); } } }, '▲'),
          h('button', { class: 'small', title: 'Move down', on: { click: () => { app.rules.move(item.id, 1); app.rulesChanged(); build(); } } }, '▼')),
        body);
      check.addEventListener('change', () => {
        item.enabled = check.checked;
        card.classList.toggle('off', !item.enabled);
        app.rulesChanged();
      });
      cards.set(item.id, card);
      el.append(card);
    }
    el.append(status, box);
  }

  build();

  return {
    el,
    rebuild: build,
    refresh(a) {
      const r = a.driver.report;
      const active = new Set<string>();
      if (r.accelBy) active.add(r.accelBy);
      if (r.laneBy) active.add(r.laneBy);
      if (r.vetoBy) active.add(r.vetoBy);
      if (r.clampedBy) active.add(r.clampedBy);
      if (r.signalling) active.add('signal');
      for (const [id, card] of cards) card.classList.toggle('active', active.has(id));
    },
  };
}
