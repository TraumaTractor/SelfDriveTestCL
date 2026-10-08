import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const u = require('../electron/updater.cjs') as typeof import('../electron/updater.cjs');

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'sdtb-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function makeDist(version: string) {
  const dist = tmp();
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), `<html>v${version}</html>`);
  writeFileSync(path.join(dist, 'assets', 'app.js'), `console.log("${version}")`);
  return dist;
}

/** A fake GitHub: serves the "latest release" JSON and its update asset. */
function fakeGithub(bundle: unknown, { requireToken = false } = {}) {
  const calls: { url: string; auth?: string }[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (requireToken && !init.headers.Authorization) return new Response('nope', { status: 404 });
    if (url.endsWith('/releases/latest')) {
      return Response.json({ html_url: 'https://example.test/release', assets: [{ name: 'app-update.json', url: 'https://api.test/asset/1' }] });
    }
    if (url === 'https://api.test/asset/1') return new Response(JSON.stringify(bundle));
    return new Response('?', { status: 500 });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('version comparison', () => {
  it('orders versions numerically', () => {
    expect(u.compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(u.compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(u.compareVersions('0.8.0', '0.8.1')).toBe(-1);
    expect(u.compareVersions('junk', '1.0.0')).toBe(0);
  });
});

describe('update bundle', () => {
  it('round-trips a dist folder through validate + install', () => {
    const bundle = u.buildBundle(makeDist('2.0.0'), { version: '2.0.0', shell: 1 });
    const updates = tmp();
    const dest = u.installBundle(bundle, updates);
    expect(readFileSync(path.join(dest, 'index.html'), 'utf8')).toBe('<html>v2.0.0</html>');
    expect(readFileSync(path.join(dest, 'assets', 'app.js'), 'utf8')).toContain('2.0.0');
    expect(u.readCurrent(updates)?.version).toBe('2.0.0');
  });

  it('rejects tampered files and path traversal', () => {
    const good = u.buildBundle(makeDist('2.0.0'), { version: '2.0.0', shell: 1 });
    const tampered = structuredClone(good);
    tampered.files['assets/app.js'].data = Buffer.from('evil()').toString('base64');
    expect(() => u.validateBundle(tampered)).toThrow(/checksum/);

    const traversal = structuredClone(good);
    traversal.files['../../escape.js'] = traversal.files['assets/app.js'];
    expect(() => u.validateBundle(traversal)).toThrow(/unsafe/);

    const noIndex = structuredClone(good);
    delete noIndex.files['index.html'];
    expect(() => u.validateBundle(noIndex)).toThrow(/index.html/);
  });

  it('keeps only the newest two versions on disk', () => {
    const updates = tmp();
    for (const v of ['1.0.1', '1.0.2', '1.0.3']) u.installBundle(u.buildBundle(makeDist(v), { version: v, shell: 1 }), updates);
    expect(existsSync(path.join(updates, '1.0.1'))).toBe(false);
    expect(existsSync(path.join(updates, '1.0.3'))).toBe(true);
  });
});

describe('checking for updates', () => {
  const base = { repo: 'o/r', shellVersion: 1 };

  it('downloads and installs a newer version', async () => {
    const updatesDir = tmp();
    const gh = fakeGithub(u.buildBundle(makeDist('0.9.0'), { version: '0.9.0', shell: 1, notes: 'better' }));
    const r = await u.checkForUpdate({ ...base, fetchImpl: gh.fetchImpl, currentVersion: '0.8.0', updatesDir });
    expect(r).toMatchObject({ status: 'ready', version: '0.9.0', notes: 'better' });
    expect(u.readCurrent(updatesDir)?.version).toBe('0.9.0');
  });

  it('does nothing when already up to date, or when the version was rolled back', async () => {
    const updatesDir = tmp();
    const gh = fakeGithub(u.buildBundle(makeDist('0.9.0'), { version: '0.9.0', shell: 1 }));
    expect((await u.checkForUpdate({ ...base, fetchImpl: gh.fetchImpl, currentVersion: '0.9.0', updatesDir })).status).toBe('up-to-date');
    expect((await u.checkForUpdate({ ...base, fetchImpl: gh.fetchImpl, currentVersion: '0.8.0', updatesDir, skip: ['0.9.0'] })).status).toBe('up-to-date');
    expect(u.readCurrent(updatesDir)).toBeNull();
  });

  it('asks for a new installer when the native shell changed', async () => {
    const updatesDir = tmp();
    const gh = fakeGithub(u.buildBundle(makeDist('1.0.0'), { version: '1.0.0', shell: 2 }));
    const r = await u.checkForUpdate({ ...base, fetchImpl: gh.fetchImpl, currentVersion: '0.8.0', updatesDir });
    expect(r).toMatchObject({ status: 'needs-installer', version: '1.0.0', url: 'https://example.test/release' });
    expect(u.readCurrent(updatesDir)).toBeNull();
  });

  it('uses the token for a private repo and explains when it is missing', async () => {
    const updatesDir = tmp();
    const gh = fakeGithub(u.buildBundle(makeDist('0.9.0'), { version: '0.9.0', shell: 1 }), { requireToken: true });
    await expect(u.checkForUpdate({ ...base, fetchImpl: gh.fetchImpl, currentVersion: '0.8.0', updatesDir })).rejects.toMatchObject({ code: 'private-or-missing' });
    const ok = await u.checkForUpdate({ ...base, fetchImpl: gh.fetchImpl, token: 'github_pat_x', currentVersion: '0.8.0', updatesDir });
    expect(ok.status).toBe('ready');
    expect(gh.calls.every((c, i) => i < 1 || c.auth === 'Bearer github_pat_x')).toBe(true);
  });

  it('reports a clean error when offline', async () => {
    const fetchImpl = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    await expect(u.checkForUpdate({ ...base, fetchImpl, currentVersion: '0.8.0', updatesDir: tmp() })).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('changelog', () => {
  it('has an entry for the version in package.json (bump both together)', async () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    const { CHANGELOG } = await import('../src/changelog');
    expect(CHANGELOG[0].version).toBe(pkg.version);
    for (const e of CHANGELOG) expect(e.items.length).toBeGreaterThan(0);
  });

  it('shows only what is new since the last version seen', async () => {
    const { entriesToShow } = await import('../src/changelog');
    expect(entriesToShow('0.7.0', '0.8.0').map((e) => e.version)).toEqual(['0.8.0']);
    expect(entriesToShow('0.5.0', '0.8.0').map((e) => e.version)).toEqual(['0.8.0', '0.7.0', '0.6.0']);
    expect(entriesToShow(null, '0.8.0').map((e) => e.version)).toEqual(['0.8.0']); // first ever launch
    expect(entriesToShow('0.8.0', '0.8.0')).toEqual([]);
  });
});
