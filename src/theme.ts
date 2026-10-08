export type ThemeSetting = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Pure: which theme to use for a setting, given whether the system prefers dark. */
export function resolveTheme(setting: ThemeSetting, systemPrefersDark: boolean): ResolvedTheme {
  return setting === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : setting;
}

let current: ResolvedTheme = 'dark';
let setting: ThemeSetting = 'auto';
let media: MediaQueryList | null = null;

/** The theme currently in effect (read by the canvas renderers every frame). */
export const theme = (): ResolvedTheme => current;

function refresh(): void {
  current = resolveTheme(setting, media ? media.matches : true);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;
}

export function applyTheme(s: ThemeSetting): void {
  setting = s;
  if (typeof window !== 'undefined' && !media && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);
  }
  refresh();
}
