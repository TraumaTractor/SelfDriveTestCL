// Packs the built web app (dist/) into one self-update file: release/app-update.json
// Run after `npm run build`. In CI on a tag, refuses to build if the tag and package.json disagree.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { buildBundle } = require('../electron/updater.cjs');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const ref = process.env.GITHUB_REF_NAME;
if (ref && /^v\d/.test(ref) && ref !== `v${pkg.version}`) {
  console.error(`Tag ${ref} does not match package.json version ${pkg.version}`);
  process.exit(1);
}

const bundle = buildBundle(new URL('../dist', import.meta.url).pathname, {
  version: pkg.version,
  shell: pkg.shellVersion ?? 1,
  notes: process.env.UPDATE_NOTES ?? '',
});
mkdirSync(new URL('../release', import.meta.url), { recursive: true });
const out = new URL('../release/app-update.json', import.meta.url);
writeFileSync(out, JSON.stringify(bundle));
console.log(`app-update.json: v${bundle.version}, shell ${bundle.shell}, ${Object.keys(bundle.files).length} files`);
