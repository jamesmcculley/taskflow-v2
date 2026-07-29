import { describe, expect, it } from 'vitest';
import { own } from '../src/utils';

describe('own', () => {
	it('returns own properties only', () => {
		expect(own({ a: 1 }, 'a')).toBe(1);
		expect(own({ a: 1 }, 'b')).toBeUndefined();
	});

	it('does not fall through to Object.prototype', () => {
		// A block ref like ^constructor must not resolve to Function.
		expect(own<unknown>({}, 'constructor')).toBeUndefined();
		expect(own<unknown>({}, 'toString')).toBeUndefined();
		expect(own<unknown>({}, '__proto__')).toBeUndefined();
	});
});
