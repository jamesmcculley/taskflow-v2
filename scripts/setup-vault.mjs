import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot, resolveVaultPath } from './env.mjs';

// One-command install into TEST_VAULT_PATH. `npm run build` already copies the
// three plugin files (see copyToVault in esbuild.config.mjs), so this covers
// only the parts that were still done by hand:
//
//   1. seeding v2's data.json from v1's, so manual order / completedAt / the
//      History log / saved filters survive the switch (task IDs are unchanged
//      by the migration, so they all still resolve — see loadPersisted)
//   2. optionally flipping the plugin on in community-plugins.json, so a fresh
//      vault doesn't need a trip through the Settings UI
//
// Never overwrites an existing v2 data.json: after the first run that file is
// v2's own state, not something to re-seed from v1.

const V1_ID = 'taskflow';
const V2_ID = 'taskflow-v2';
const FILES = ['main.js', 'manifest.json', 'styles.css'];

const enable = process.argv.includes('--enable');
const vault = resolveVaultPath();
const pluginsDir = path.join(vault, '.obsidian', 'plugins');
const v2Dir = path.join(pluginsDir, V2_ID);

// Obsidian rewrites .obsidian/*.json on its own schedule, so editing config
// underneath a running instance can be silently clobbered on quit.
function obsidianIsRunning() {
	try {
		execFileSync('pgrep', ['-x', 'Obsidian'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

mkdirSync(v2Dir, { recursive: true });

const missing = FILES.filter((f) => !existsSync(path.join(repoRoot, f)));
if (missing.length > 0) {
	console.error(`not built yet (missing ${missing.join(', ')}) — run \`npm run build\` first`);
	process.exit(1);
}
for (const name of FILES) {
	copyFileSync(path.join(repoRoot, name), path.join(v2Dir, name));
}
console.log(`installed ${FILES.join(', ')} -> ${v2Dir}`);

const v1Data = path.join(pluginsDir, V1_ID, 'data.json');
const v2Data = path.join(v2Dir, 'data.json');
if (existsSync(v2Data)) {
	console.log('data.json: already present, left alone');
} else if (existsSync(v1Data)) {
	copyFileSync(v1Data, v2Data);
	console.log(`data.json: seeded from v1 (${path.relative(vault, v1Data)})`);
} else {
	console.log('data.json: no v1 index found, starting fresh');
}

const listPath = path.join(vault, '.obsidian', 'community-plugins.json');
const enabled = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : [];
if (enabled.includes(V2_ID)) {
	console.log(`${V2_ID}: already enabled`);
} else if (!enable) {
	console.log(`${V2_ID}: not enabled — pass --enable, or toggle it in Settings`);
} else if (obsidianIsRunning()) {
	console.error(`${V2_ID}: Obsidian is running — quit it first, or enable in Settings instead`);
	process.exit(1);
} else {
	writeFileSync(listPath, `${JSON.stringify([...enabled, V2_ID], null, 2)}\n`);
	console.log(`${V2_ID}: enabled in community-plugins.json`);
}

// Obsidian caches the plugin manifest list at launch, so a folder that appeared
// while it was open is invisible (or stale) until a full restart. Once the
// plugin is loaded, later rebuilds only need the sidebar's reload button.
console.log(
	existsSync(v2Data) && enabled.includes(V2_ID)
		? 'done — reload the plugin from the sidebar footer to pick this build up'
		: 'done — fully quit and reopen Obsidian (it caches plugin manifests at launch)',
);
