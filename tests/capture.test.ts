import { describe, expect, it } from 'vitest';
import { parseCapture } from '../src/capture/parser';

// Sat 2026-07-18, noon local.
const REF = new Date(2026, 6, 18, 12, 0, 0);

describe('parseCapture', () => {
	it('parses plain text', () => {
		expect(parseCapture('Buy milk', REF)).toMatchObject({
			title: 'Buy milk',
			scheduled: undefined,
			due: undefined,
			tags: [],
			projectQuery: undefined,
		});
	});

	it('parses a natural-language date as scheduled', () => {
		const p = parseCapture('Call mom tomorrow', REF);
		expect(p.title).toBe('Call mom');
		expect(p.scheduled).toBe('2026-07-19');
	});

	it('parses explicit dates', () => {
		const p = parseCapture('Ship release on 2026-08-01', REF);
		expect(p.scheduled).toBe('2026-08-01');
		expect(p.title).toBe('Ship release');
	});

	it('parses tags', () => {
		const p = parseCapture('Fix the sink #home #urgent', REF);
		expect(p.tags).toEqual(['home', 'urgent']);
		expect(p.title).toBe('Fix the sink');
	});

	it('parses a !due token', () => {
		const p = parseCapture('Pay rent !due 2026-08-01', REF);
		expect(p.due).toBe('2026-08-01');
		expect(p.scheduled).toBeUndefined();
		expect(p.title).toBe('Pay rent');
	});

	it('parses !due with natural language', () => {
		const p = parseCapture('Pay rent !due tomorrow', REF);
		expect(p.due).toBe('2026-07-19');
		expect(p.title).toBe('Pay rent');
	});

	it('parses a >Project token with spaces', () => {
		const p = parseCapture('Buy paint >Home Renovation', REF);
		expect(p.projectQuery).toBe('Home Renovation');
		expect(p.title).toBe('Buy paint');
	});

	it('parses everything combined', () => {
		const p = parseCapture('Buy paint tomorrow #home !due 2026-08-01 >Home Renovation', REF);
		expect(p).toMatchObject({
			title: 'Buy paint',
			scheduled: '2026-07-19',
			due: '2026-08-01',
			tags: ['home'],
			projectQuery: 'Home Renovation',
		});
	});

	it('keeps scheduled and due independent', () => {
		const p = parseCapture('Draft slides tomorrow !due 2026-07-30 #work', REF);
		expect(p.scheduled).toBe('2026-07-19');
		expect(p.due).toBe('2026-07-30');
		expect(p.tags).toEqual(['work']);
	});
});

describe('parseCapture — M7 additions', () => {
	it('parses natural-language recurrence into an org repeater', () => {
		const p = parseCapture('Water plants every 3 days #home', REF);
		expect(p.repeater).toBe('++3d');
		expect(p.title).toBe('Water plants');
		expect(p.tags).toEqual(['home']);
	});

	it('recurrence beats chrono ("every monday" is not a date)', () => {
		const p = parseCapture('Team sync every monday', REF);
		// No org repeater expresses a fixed weekday, so it keeps the rrule text.
		expect(p.ruleText).toBe('every monday');
		expect(p.repeater).toBeUndefined();
		expect(p.title).toBe('Team sync');
	});

	it('trims trailing non-recurrence words', () => {
		const p = parseCapture('every day standup notes', REF);
		expect(p.repeater).toBe('++1d');
		expect(p.title).toBe('standup notes');
	});

	it('parses after-done recurrence as a .+ repeater', () => {
		expect(parseCapture('Clean garage every 2 weeks after done', REF).repeater).toBe('.+2w');
	});

	it('parses priority tokens', () => {
		expect(parseCapture('Ship the fix !!!', REF).priority).toBe(1);
		expect(parseCapture('Ship the fix !! tomorrow', REF).priority).toBe(2);
		expect(parseCapture('Ship it now!', REF).priority).toBeUndefined();
	});

	it('captures a time when the phrase has one', () => {
		const p = parseCapture('Standup tomorrow at 9:30', REF);
		expect(p.scheduled).toBe('2026-07-19');
		expect(p.scheduledTime).toBe('09:30');
		expect(parseCapture('Standup tomorrow', REF).scheduledTime).toBeUndefined();
	});
});

describe('parseCapture — org keywords and cookies', () => {
	it('takes a leading TODO keyword off the front', () => {
		expect(parseCapture('NEXT call the bank', REF)).toMatchObject({
			keyword: 'NEXT',
			title: 'call the bank',
		});
		expect(parseCapture('WAITING on the quote', REF).keyword).toBe('WAITING');
	});

	it('defaults to TODO, and an ordinary capitalised word is not a keyword', () => {
		expect(parseCapture('Buy milk', REF).keyword).toBe('TODO');
		expect(parseCapture('CALL the vet', REF)).toMatchObject({
			keyword: 'TODO',
			title: 'CALL the vet',
		});
	});

	it('accepts an org priority cookie as well as bangs', () => {
		expect(parseCapture('Ship it [#A]', REF).priority).toBe(1);
		expect(parseCapture('Ship it [#c]', REF).priority).toBe(3);
		expect(parseCapture('Ship it !', REF).priority).toBe(3);
	});

	it('gives a repeat something to hang off when no date was typed', () => {
		// Org has no dateless repeater, so the capture is scheduled today.
		expect(parseCapture('Water plants every 3 days', REF).scheduled).toBe('2026-07-18');
	});
});
