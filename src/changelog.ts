import raw from './changelog.json';

export interface ChangelogEntry {
  version: string;
  title: string;
  items: string[];
}

/** Newest first. This file is the single source of truth: it feeds the pop-up and the update notes. */
export const CHANGELOG: ChangelogEntry[] = raw;

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/**
 * What to show someone who last saw `lastSeen` and is now running `current`:
 * everything newer than they saw (at most `max` versions), or just the latest for a first launch.
 */
export function entriesToShow(lastSeen: string | null, current: string, max = 4): ChangelogEntry[] {
  const upToCurrent = CHANGELOG.filter((e) => compareVersions(e.version, current) <= 0);
  if (!lastSeen) return upToCurrent.slice(0, 1);
  return upToCurrent.filter((e) => compareVersions(e.version, lastSeen) > 0).slice(0, max);
}
