const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Generates a stable task ID of the form `t-xxxxxx` (6 chars base36). */
export function generateTaskId(existing?: ReadonlySet<string>): string {
	for (;;) {
		const bytes = new Uint8Array(6);
		globalThis.crypto.getRandomValues(bytes);
		let id = 't-';
		for (const b of bytes) id += ALPHABET[b % 36];
		if (!existing?.has(id)) return id;
	}
}
