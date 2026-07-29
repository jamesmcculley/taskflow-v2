import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)),
		},
	},
});
