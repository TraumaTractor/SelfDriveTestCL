import { convertForDisplay, onUnitsChange } from '../units';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string; on?: Record<string, (e: Event) => void> };

/** Tiny hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'on') for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface ToggleOpts {
  label: string;
  value: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
}

/** iOS-style switch. */
export function toggle(o: ToggleOpts): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: o.value, role: 'switch', on: { change: () => o.onChange(input.checked) } });
  return h('label', { class: 'switch', title: o.hint ?? '' }, h('span', { class: 'sl-label' }, o.label), input, h('span', { class: 'track' }, h('span', { class: 'thumb' })));
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  hint?: string;
  onInput: (v: number) => void;
}

export function slider(o: SliderOpts): HTMLElement {
  // Values are always stored in SI; only the read-out is converted to the chosen units.
  const fmt = (v: number) => {
    const c = convertForDisplay(v, o.unit);
    const decimals = Math.min(2, Math.max(0, -Math.floor(Math.log10(o.step * c.factor))));
    return `${c.value.toFixed(decimals)}${c.unit ? ' ' + c.unit : ''}`;
  };
  const out = h('span', { class: 'sl-val' }, fmt(o.value));
  const input = h('input', {
    type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.value),
    on: {
      input: () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        o.onInput(v);
      },
    },
  });
  const offUnits = onUnitsChange(() => { if (out.isConnected) out.textContent = fmt(Number(input.value)); else offUnits(); });
  return h('label', { class: 'sl', title: o.hint ?? '' }, h('span', { class: 'sl-label' }, o.label), out, input);
}

export interface SegmentedOpts<T extends string> {
  name: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}

/** A row of radio buttons styled as a segmented control. */
export function segmented<T extends string>(o: SegmentedOpts<T>): HTMLElement {
  return h('div', { class: 'seg', role: 'radiogroup' },
    ...o.options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name: o.name, value, checked: value === o.value, on: { change: () => { if (input.checked) o.onChange(value); } } });
      return h('label', {}, input, h('span', {}, label));
    }));
}
