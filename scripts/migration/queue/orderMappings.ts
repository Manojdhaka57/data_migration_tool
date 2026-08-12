/**
 * The order tables migrate in.
 *
 * Kept out of worker.ts deliberately: importing that module opens a Redis
 * connection, so the rule that decides execution order could not otherwise be
 * tested without infrastructure.
 */

export interface OrderableMapping {
  targetTable: string;
}

/**
 * Sort mappings for execution.
 *
 * `mappingOrder` is a human-chosen sequence of target tables. When it is empty
 * — the default, and what every job did before it existed — mappings are
 * ordered by foreign-key level, which is the behaviour this replaces nothing
 * of.
 *
 * When it is set, three rules apply, in this order:
 *
 *  1. Tables named in `mappingOrder` run in exactly that sequence.
 *  2. Tables NOT named run afterwards, ordered by level. They are never
 *     dropped — adding a mapping and forgetting to re-order still migrates it,
 *     which is the difference between a stale order and a silent data loss.
 *  3. Names in `mappingOrder` matching no mapping are ignored rather than
 *     failing the run: a table can legitimately disappear from a configuration
 *     after the order was chosen.
 *
 * The sort is stable, so mappings at the same level keep their input order.
 */
export function orderMappings<T extends OrderableMapping>(
  mappings: T[],
  levels: Map<string, number>,
  mappingOrder?: string[],
): T[] {
  const rank = new Map<string, number>();
  (mappingOrder ?? []).forEach((name, index) => {
    // First occurrence wins, so a duplicated name cannot reshuffle the rest.
    if (!rank.has(name)) rank.set(name, index);
  });

  return [...mappings].sort((a, b) => {
    const rankA = rank.get(a.targetTable);
    const rankB = rank.get(b.targetTable);
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    return (levels.get(a.targetTable) ?? 0) - (levels.get(b.targetTable) ?? 0);
  });
}

/** How many of the mappings were placed by hand, for logging. */
export function orderSummary<T extends OrderableMapping>(
  mappings: T[],
  mappingOrder?: string[],
): { pinned: number; appended: number } {
  const named = new Set(mappingOrder ?? []);
  const pinned = mappings.filter((m) => named.has(m.targetTable)).length;
  return { pinned, appended: mappings.length - pinned };
}
