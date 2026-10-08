export interface Bundle {
  format: 1;
  version: string;
  shell: number;
  notes: string;
  files: Record<string, { sha256: string; data: string }>;
}
export interface Current { version: string; shell: number; dir: string }
export class UpdateError extends Error { code: string }
export function parseVersion(v: string): [number, number, number] | null;
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function sha256(buf: Uint8Array): string;
export function buildBundle(distDir: string, meta: { version: string; shell: number; notes?: string }): Bundle;
export function validateBundle(bundle: unknown): Map<string, Buffer>;
export function installBundle(bundle: Bundle, updatesDir: string): string;
export function readCurrent(updatesDir: string): Current | null;
export function clearCurrent(updatesDir: string, badVersion?: string): void;
export function readBad(updatesDir: string): string[];
export function checkForUpdate(opts: {
  fetchImpl?: typeof fetch; apiBase?: string; repo: string; token?: string; currentVersion: string;
  shellVersion: number; updatesDir: string; skip?: string[];
}): Promise<
  | { status: 'up-to-date'; version: string }
  | { status: 'ready'; version: string; notes?: string }
  | { status: 'needs-installer'; version: string; url: string; notes?: string }
>;
