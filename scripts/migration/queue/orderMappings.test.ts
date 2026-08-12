import { describe, it, expect } from 'vitest';
import { orderMappings, orderSummary } from './orderMappings';

const m = (targetTable: string) => ({ targetTable });

/** users -> students -> student_courses, plus an unrelated lookup table. */
const LEVELS = new Map<string, number>([
  ['users', 0],
  ['countries', 0],
  ['students', 1],
  ['student_courses', 2],
]);

const MAPPINGS = [m('student_courses'), m('users'), m('countries'), m('students')];

describe('orderMappings', () => {
  it('falls back to foreign-key level when no order is given', () => {
    const names = orderMappings(MAPPINGS, LEVELS).map((x) => x.targetTable);
    // Level 0 first, then 1, then 2. Same-level tables keep input order
    // (the sort is stable), so users precedes countries as it does in MAPPINGS.
    expect(names).toEqual(['users', 'countries', 'students', 'student_courses']);
  });

  it('treats an empty order as "no order", not as "empty result"', () => {
    expect(orderMappings(MAPPINGS, LEVELS, []).map((x) => x.targetTable)).toEqual(
      orderMappings(MAPPINGS, LEVELS).map((x) => x.targetTable),
    );
  });

  it('uses the chosen sequence exactly, even against foreign-key levels', () => {
    const order = ['student_courses', 'students', 'countries', 'users'];
    expect(orderMappings(MAPPINGS, LEVELS, order).map((x) => x.targetTable)).toEqual(order);
  });

  it('appends mappings the order does not name, rather than dropping them', () => {
    // The whole risk of a saved order: a mapping added later is not in it.
    const names = orderMappings(MAPPINGS, LEVELS, ['student_courses']).map((x) => x.targetTable);
    expect(names[0]).toBe('student_courses');
    expect(names).toHaveLength(MAPPINGS.length);
    // The remainder still respects dependency level.
    expect(names.slice(1)).toEqual(['users', 'countries', 'students']);
  });

  it('ignores names in the order that match no mapping', () => {
    const names = orderMappings(MAPPINGS, LEVELS, ['deleted_table', 'students']).map(
      (x) => x.targetTable,
    );
    expect(names).toHaveLength(MAPPINGS.length);
    expect(names[0]).toBe('students');
  });

  it('is not confused by a duplicated name in the order', () => {
    const names = orderMappings(MAPPINGS, LEVELS, ['students', 'users', 'students']).map(
      (x) => x.targetTable,
    );
    expect(names).toEqual(['students', 'users', 'countries', 'student_courses']);
  });

  it('does not mutate the input array', () => {
    const input = [...MAPPINGS];
    orderMappings(input, LEVELS, ['students']);
    expect(input.map((x) => x.targetTable)).toEqual(MAPPINGS.map((x) => x.targetTable));
  });

  it('defaults an unknown table to level 0 instead of dropping it', () => {
    const names = orderMappings([...MAPPINGS, m('orphan')], LEVELS).map((x) => x.targetTable);
    expect(names).toContain('orphan');
    expect(names).toHaveLength(5);
  });
});

describe('orderSummary', () => {
  it('counts what was placed by hand versus appended', () => {
    expect(orderSummary(MAPPINGS, ['students', 'users'])).toEqual({ pinned: 2, appended: 2 });
  });

  it('reports everything as appended when no order is set', () => {
    expect(orderSummary(MAPPINGS)).toEqual({ pinned: 0, appended: 4 });
  });

  it('does not count order entries that match no mapping', () => {
    expect(orderSummary(MAPPINGS, ['students', 'deleted_table'])).toEqual({
      pinned: 1,
      appended: 3,
    });
  });
});
