'use strict';
// Self-update for the desktop app. The app is a static web bundle inside a thin Electron shell, so an
// "update" is just a newer copy of that bundle published on GitHub Releases as `app-update.json`.
// It needs no code signing and works on Mac, Windows and the portable .exe. A new installer is only
// needed if the native shell itself changes (the release says so via `shell`).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BUNDLE_BYTES = 40 * 1024 * 1024;
const SAFE_PATH = /^(?!.*\.\.)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1 / 0 / 1; unparseable versions compare equal (and are therefore never applied). */
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Build the update document from a built `dist/` folder (used by scripts/make-update.mjs). */
function buildBundle(distDir, { version, shell, notes = '' }) {
  const files = {};
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else {
        const data = fs.readFileSync(full);
        files[rel] = { sha256: sha256(data), data: data.toString('base64') };
      }
    }
  };
  walk(distDir, '');
  return { format: 1, version, shell, notes, files };
}

/** Validate an update document and return its decoded files. Throws on anything suspicious. */
function validateBundle(bundle) {
  if (!bundle || bundle.format !== 1 || !parseVersion(bundle.version) || typeof bundle.files !== 'object') {
    throw new Error('not a valid update file');
  }
  const out = new Map();
  let total = 0;
  for (const [name, entry] of Object.entries(bundle.files)) {
    if (!SAFE_PATH.test(name)) throw new Error(`unsafe file name in update: ${name}`);
    const data = Buffer.from(String(entry && entry.data), 'base64');
    total += data.length;
    if (total > MAX_BUNDLE_BYTES) throw new Error('update is too large');
    if (sha256(data) !== entry.sha256) throw new Error(`checksum mismatch for ${name}`);
    out.set(name, data);
  }
  if (!out.has('index.html')) throw new Error('update has no index.html');
  return out;
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

function installBundle(bundle, updatesDir) {
  const files = validateBundle(bundle);
  fs.mkdirSync(updatesDir, { recursive: true });
  const dest = path.join(updatesDir, bundle.version);
  const tmp = path.join(updatesDir, `.installing-${bundle.version}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [name, data] of files) {
    const target = path.join(tmp, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  writeJsonAtomic(path.join(updatesDir, 'current.json'), { version: bundle.version, shell: bundle.shell || 1, dir: dest });
  // keep only the newest two copies
  const versions = fs.readdirSync(updatesDir).filter((d) => parseVersion(d)).sort(compareVersions).reverse();
  for (const old of versions.slice(2)) fs.rmSync(path.join(updatesDir, old), { recursive: true, force: true });
  return dest;
}

function readCurrent(updatesDir) {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(updatesDir, 'current.json'), 'utf8'));
    if (parseVersion(cur.version) && cur.dir && fs.existsSync(path.join(cur.dir, 'index.html'))) return cur;
  } catch { /* none */ }
  return null;
}

function clearCurrent(updatesDir, badVersion) {
  fs.rmSync(path.join(updatesDir, 'current.json'), { force: true });
  if (badVersion) {
    const file = path.join(updatesDir, 'bad.json');
    let bad = [];
    try { bad = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none */ }
    if (!bad.includes(badVersion)) bad.push(badVersion);
    fs.mkdirSync(updatesDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bad));
  }
}

function readBad(updatesDir) {
  try { return JSON.parse(fs.readFileSync(path.join(updatesDir, 'bad.json'), 'utf8')); } catch { return []; }
}

function headers(token, accept) {
  const h = { Accept: accept, 'User-Agent': 'self-drive-test-bench', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

class UpdateError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function request(fetchImpl, url, token, accept) {
  let res;
  try { res = await fetchImpl(url, { headers: headers(token, accept), redirect: 'follow' }); }
  catch (e) { throw new UpdateError(`could not reach GitHub (${e.message})`, 'offline'); }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new UpdateError(`GitHub returned ${res.status}`, token ? 'denied' : 'private-or-missing');
  }
  if (!res.ok) throw new UpdateError(`GitHub returned ${res.status}`, 'http');
  return res;
}

/**
 * Look for a newer app bundle on the latest GitHub release and, if there is one, download and install it.
 * Returns {status: 'up-to-date' | 'ready' | 'needs-installer', ...}; throws UpdateError otherwise.
 */
async function checkForUpdate({ fetchImpl = fetch, apiBase = 'https://api.github.com', repo, token, currentVersion, shellVersion, updatesDir, skip = [] }) {
  const rel = await (await request(fetchImpl, `${apiBase}/repos/${repo}/releases/latest`, token, 'application/vnd.github+json')).json();
  const asset = (rel.assets || []).find((a) => a.name === 'app-update.json');
  if (!asset) throw new UpdateError('the latest release has no app-update.json', 'no-asset');
  const raw = Buffer.from(await (await request(fetchImpl, asset.url, token, 'application/octet-stream')).arrayBuffer());
  if (raw.length > MAX_BUNDLE_BYTES * 2) throw new UpdateError('update is too large', 'too-large');
  let bundle;
  try { bundle = JSON.parse(raw.toString('utf8')); } catch { throw new UpdateError('update file is not valid JSON', 'bad-update'); }
  if (!parseVersion(bundle.version)) throw new UpdateError('update has no version', 'bad-update');

  if (compareVersions(bundle.version, currentVersion) <= 0 || skip.includes(bundle.version)) {
    return { status: 'up-to-date', version: currentVersion };
  }
  if ((bundle.shell || 1) > shellVersion) {
    return { status: 'needs-installer', version: bundle.version, url: rel.html_url, notes: bundle.notes };
  }
  try { installBundle(bundle, updatesDir); } catch (e) { throw new UpdateError(e.message, 'bad-update'); }
  return { status: 'ready', version: bundle.version, notes: bundle.notes };
}

module.exports = { compareVersions, parseVersion, sha256, buildBundle, validateBundle, installBundle, readCurrent, clearCurrent, readBad, checkForUpdate, UpdateError };
