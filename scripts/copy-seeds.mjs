import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, resolveVaultPath } from './env.mjs';

const vault = resolveVaultPath();
// `npm run seed:v1` copies the pre-migration fixtures instead, so the
// v1 -> v2 migration can be exercised against a realistic vault.
const which = process.argv[2] === 'v1' ? 'seed-v1' : 'seed';
const seedDir = path.join(repoRoot, 'test-vault', which);
if (!existsSync(seedDir)) {
	console.error(`Seed directory not found: ${seedDir}`);
	process.exit(1);
}
mkdirSync(vault, { recursive: true });
cpSync(seedDir, vault, { recursive: true, force: true });
console.log(`Copied seeds from ${seedDir} -> ${vault}`);
