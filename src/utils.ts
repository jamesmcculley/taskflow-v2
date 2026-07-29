/**
 * Own-property lookup for records keyed by user-controlled strings (block IDs
 * come from markdown, so keys like "constructor" must not fall through to
 * Object.prototype).
 */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
	return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
