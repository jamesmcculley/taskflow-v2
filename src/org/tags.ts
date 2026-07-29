/**
 * The tags and properties TaskFlow gives meaning to, beyond org's own syntax.
 *
 * These live here rather than in the indexer so every pure module — the
 * converter, the serializer, the selectors — can reach them without pulling in
 * `obsidian`, which is what keeps those modules unit-testable without mocks.
 */

/**
 * Task-level Someday. v1's encoding of what v2 expresses as the SOMEDAY
 * keyword — still read so migrated and hand-written vaults keep working, but
 * never written (toggleSomeday sets the keyword and clears this).
 */
export const SOMEDAY_TAG = 'someday';

/** Puts a task in Today's evening section — v1's 🌙 flag. */
export const TONIGHT_TAG = 'tonight';

/**
 * Holds an rrule phrase for repeats no org repeater can express
 * ("every 3rd friday", "every weekday"). The completion path falls back to
 * rrule for exactly these.
 */
export const REPEAT_PROPERTY = 'REPEAT';
