import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, resolveVaultPath } from './env.mjs';

// Copies the built plugin into the test vault (real files, not symlinks, so
// Obsidian's watcher + the Hot Reload plugin pick up changes). The esbuild
// config does this automatically on every build; this script is the manual
// one-off for a fresh vault.
const vault = resolveVaultPath();
const pluginDir = path.join(vault, '.obsidian', 'plugins', 'taskflow-v2');
mkdirSync(pluginDir, { recursive: true });

for (const name of ['main.js', 'manifest.json', 'styles.css']) {
	const src = path.join(repoRoot, name);
	const dest = path.join(pluginDir, name);
	if (!existsSync(src)) {
		console.warn(`skip ${name} (not built yet — run \`npm run build\` or \`npm run dev\`)`);
		continue;
	}
	try {
		if (lstatSync(dest).isSymbolicLink()) rmSync(dest);
	} catch {
		/* dest doesn't exist */
	}
	copyFileSync(src, dest);
	console.log(`copied ${name} -> ${dest}`);
}
