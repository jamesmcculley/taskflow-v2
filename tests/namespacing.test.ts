import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// v2 is a fork of v1 and both can be enabled in the same vault. Obsidian's
// registerView THROWS on a duplicate view type, so if v2 ever re-adopts v1's
// 'taskflow-view' the plugin fails to load outright ("Attempting to register an
// existing view type"). These ids are load-bearing, not cosmetic.
//
// Asserted against the source text rather than by importing the module: the
// constants live next to the React view, and importing it would drag the whole
// component tree into a node-environment test for two string literals.
const V1_VIEW_TYPE = 'taskflow-view';
const V1_HOVER_SOURCE = 'taskflow';

const source = readFileSync(
	path.join(__dirname, '..', 'src', 'views', 'TaskFlowView.tsx'),
	'utf8',
);

const declared = (name: string): string => {
	const match = source.match(new RegExp(`export const ${name} = '([^']*)'`));
	if (!match?.[1]) throw new Error(`${name} is no longer declared as a literal in TaskFlowView.tsx`);
	return match[1];
};

describe('view registration ids', () => {
	it('does not reuse v1 view type', () => {
		expect(declared('VIEW_TYPE_TASKFLOW')).not.toBe(V1_VIEW_TYPE);
	});

	it('does not reuse v1 hover source', () => {
		expect(declared('HOVER_SOURCE_TASKFLOW')).not.toBe(V1_HOVER_SOURCE);
	});

	it('namespaces both ids under the v2 plugin id', () => {
		expect(declared('VIEW_TYPE_TASKFLOW')).toMatch(/^taskflow-v2\b/);
		expect(declared('HOVER_SOURCE_TASKFLOW')).toMatch(/^taskflow-v2\b/);
	});
});

// Obsidian merges every enabled plugin's styles.css into one global stylesheet,
// so any selector v2 shares with v1 is won by whichever loaded second while both
// are enabled during a migration. v2's classes, custom properties, and keyframe
// names are therefore all `tf2-`; a stray `taskflow-` is a v1 collision.
describe('css namespace', () => {
	const stylesheet = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
	const sources = readdirSync(path.join(__dirname, '..', 'src'), {
		recursive: true,
		encoding: 'utf8',
	}).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

	it('uses no v1-prefixed identifiers in the stylesheet', () => {
		expect(stylesheet).not.toMatch(/taskflow-/);
	});

	it('defines every rule under the tf2- prefix', () => {
		const unprefixed = [...stylesheet.matchAll(/^\s*(\.[a-zA-Z][\w-]*)/gm)]
			.map((m) => m[1] as string)
			.filter((sel) => !sel.startsWith('.tf2-') && !sel.startsWith('.is-'));
		expect(unprefixed).toEqual([]);
	});

	it('applies no v1-prefixed class names from the components', () => {
		// Comments are stripped first: this asserts on applied class names, and
		// prose is free to discuss v1's `taskflow-` era. The registry ids in
		// TaskFlowView.tsx legitimately spell out `taskflow-v2`.
		const offenders = sources.filter((file) => {
			const code = readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/[^\n]*/g, '');
			return /taskflow-(?!v2)/.test(code);
		});
		expect(offenders).toEqual([]);
	});
});
