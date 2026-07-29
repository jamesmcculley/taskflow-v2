import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser — KEY=VALUE lines, # comments. Avoids a dotenv dependency. */
export function readEnv() {
	const envPath = path.join(repoRoot, '.env');
	const env = {};
	if (existsSync(envPath)) {
		for (const line of readFileSync(envPath, 'utf8').split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
			if (m && !line.trimStart().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
	return env;
}

export function resolveVaultPath() {
	const env = readEnv();
	const raw = env.TEST_VAULT_PATH ?? process.env.TEST_VAULT_PATH;
	if (!raw) {
		console.error(
			'TEST_VAULT_PATH is not set. Copy .env.example to .env and point it at a vault.',
		);
		process.exit(1);
	}
	return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}
