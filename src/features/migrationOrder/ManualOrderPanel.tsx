/**
 * Choose the exact sequence tables migrate in.
 *
 * Until now the order was always foreign-key level then alphabetical, and a
 * human-chosen sequence could not be expressed at all — which mattered because
 * foreign keys do not describe every real ordering constraint (lookup tables
 * that must land first, a table whose trigger populates another, a load you
 * want to start with the small tables to fail fast).
 *
 * The order lives in runOptionsSlice, is saved into the configuration snapshot,
 * and is honoured by the worker. An empty order means "derive from foreign
 * keys", exactly as before, so nothing changes for anyone who never opens this.
 */
import { useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Switch,
  FormControlLabel,
  IconButton,
  Tooltip,
  Alert,
  Chip,
} from '@mui/material';
import {
  ArrowUpward as UpIcon,
  ArrowDownward as DownIcon,
  VerticalAlignTop as TopIcon,
  Restore as ResetIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { selectTableMappings } from '../mapping/mappingSlice';
import { selectMappingOrder } from '../migration/runOptionsSlice';
import { setMappingOrder, clearMappingOrder } from '../migration/runOptionsSlice';
import { selectDependencies } from './migrationOrderSlice';

/** A table listed in the order but not mapped is rejected on save. */
function mappedTargetTables(tableMappings: { targetTables: string[] }[]): string[] {
  const seen = new Set<string>();
  for (const mapping of tableMappings) {
    const target = mapping.targetTables?.[0];
    if (target) seen.add(target);
  }
  return Array.from(seen);
}

export default function ManualOrderPanel() {
  const dispatch = useAppDispatch();
  const tableMappings = useAppSelector(selectTableMappings);
  const dependencies = useAppSelector(selectDependencies);
  const mappingOrder = useAppSelector(selectMappingOrder);

  /** Only mapped target tables can be ordered — the rest never migrate. */
  const candidates = useMemo(() => mappedTargetTables(tableMappings), [tableMappings]);

  const levelOf = useMemo(() => {
    const levels = new Map<string, number>();
    for (const dep of dependencies) levels.set(dep.tableName, dep.level);
    return levels;
  }, [dependencies]);

  /** What the worker would do on its own: level, then name. */
  const derivedOrder = useMemo(
    () =>
      [...candidates].sort((a, b) => {
        const levelA = levelOf.get(a) ?? 0;
        const levelB = levelOf.get(b) ?? 0;
        return levelA !== levelB ? levelA - levelB : a.localeCompare(b);
      }),
    [candidates, levelOf],
  );

  const enabled = mappingOrder.length > 0;

  /**
   * What will actually run. Mappings added since the order was set are not in
   * it, and the worker appends them by dependency level — shown here so the
   * list on screen is the real sequence, not a stale one.
   */
  const effectiveOrder = useMemo(() => {
    if (!enabled) return derivedOrder;
    const pinned = mappingOrder.filter((name) => candidates.includes(name));
    const rest = derivedOrder.filter((name) => !pinned.includes(name));
    return [...pinned, ...rest];
  }, [enabled, mappingOrder, candidates, derivedOrder]);

  const pinnedCount = enabled ? mappingOrder.filter((n) => candidates.includes(n)).length : 0;
  const appendedCount = effectiveOrder.length - pinnedCount;

  /**
   * Foreign keys the chosen sequence contradicts.
   *
   * This is the one real hazard of ordering by hand: putting a child before the
   * parent it references makes the insert fail, or silently orphans rows when
   * constraints are not enforced. Named rather than blocked — there are valid
   * reasons to do it, and refusing outright would make the feature useless.
   */
  const violations = useMemo(() => {
    if (!enabled) return [];
    const position = new Map(effectiveOrder.map((name, index) => [name, index]));
    const found: Array<{ table: string; needs: string }> = [];
    for (const dep of dependencies) {
      const here = position.get(dep.tableName);
      if (here === undefined) continue;
      for (const parent of dep.dependsOn) {
        const there = position.get(parent);
        if (there !== undefined && there > here) {
          found.push({ table: dep.tableName, needs: parent });
        }
      }
    }
    return found;
  }, [enabled, effectiveOrder, dependencies]);

  const commit = (next: string[]) => dispatch(setMappingOrder(next));

  const move = (index: number, delta: number) => {
    const next = [...effectiveOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const moveToTop = (index: number) => {
    const next = [...effectiveOrder];
    const [item] = next.splice(index, 1);
    commit([item, ...next]);
  };

  if (candidates.length === 0) {
    return (
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2, border: 1, borderColor: 'neutral.200' }}>
        <Typography variant="body2Medium" sx={{ mb: 0.5 }}>
          Migration order
        </Typography>
        <Typography variant="caption" sx={{ color: 'neutral.500' }}>
          No table mappings yet — configure mappings first, then the order can be set here.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2, mb: 3, borderRadius: 2, border: 1, borderColor: 'neutral.200' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1,
        }}
      >
        <Box>
          <Typography variant="body2Medium">Migration order</Typography>
          <Typography variant="caption" sx={{ color: 'neutral.500' }}>
            {enabled
              ? `Manual order — ${pinnedCount} table(s) in a chosen sequence` +
                (appendedCount > 0 ? `, ${appendedCount} appended by dependency level` : '')
              : `Derived from foreign keys — ${derivedOrder.length} table(s), level then name`}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {enabled && (
            <Button
              size="small"
              startIcon={<ResetIcon fontSize="small" />}
              onClick={() => dispatch(clearMappingOrder())}
              sx={{ textTransform: 'none' }}
            >
              Reset to dependency order
            </Button>
          )}
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={enabled}
                onChange={(e) =>
                  // Turning it on seeds from the derived order, so the first
                  // state is the one that already works rather than a blank one.
                  e.target.checked ? commit(derivedOrder) : dispatch(clearMappingOrder())
                }
              />
            }
            label={<Typography variant="caption">Set order manually</Typography>}
            sx={{ mr: 0 }}
          />
        </Box>
      </Box>

      {violations.length > 0 && (
        <Alert
          severity="warning"
          icon={<WarningIcon fontSize="small" />}
          sx={{ mb: 1.5, py: 0.25 }}
        >
          <Typography variant="caption">
            {violations.length} table(s) are ordered before something they reference — e.g.{' '}
            <strong>{violations[0].table}</strong> runs before <strong>{violations[0].needs}</strong>.
            Inserts may fail on the foreign key. Fix the order, or add the rows in a way that does
            not need the parent first.
          </Typography>
        </Alert>
      )}

      <Box
        sx={{
          maxHeight: 320,
          overflow: 'auto',
          border: 1,
          borderColor: 'neutral.200',
          borderRadius: 1,
        }}
      >
        {effectiveOrder.map((table, index) => {
          const isPinned = enabled && mappingOrder.includes(table);
          const violates = violations.some((v) => v.table === table);
          return (
            <Box
              key={table}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.5,
                borderBottom: index === effectiveOrder.length - 1 ? 0 : 1,
                borderColor: 'neutral.100',
                bgcolor: violates ? 'warning.50' : undefined,
              }}
            >
              <Typography
                variant="caption"
                sx={{ width: 28, color: 'neutral.400', fontVariantNumeric: 'tabular-nums' }}
              >
                {index + 1}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace' }}>
                {table}
              </Typography>
              <Chip
                label={`L${levelOf.get(table) ?? 0}`}
                size="small"
                variant="outlined"
                sx={{ height: 18, fontSize: 10 }}
              />
              {enabled && !isPinned && (
                <Tooltip title="Added since the order was set — the worker appends it by dependency level">
                  <Chip label="appended" size="small" sx={{ height: 18, fontSize: 10 }} />
                </Tooltip>
              )}
              {enabled && (
                <Box sx={{ display: 'flex' }}>
                  <IconButton size="small" disabled={index === 0} onClick={() => moveToTop(index)}>
                    <TopIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton size="small" disabled={index === 0} onClick={() => move(index, -1)}>
                    <UpIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={index === effectiveOrder.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <DownIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'neutral.500' }}>
        {enabled
          ? 'Saved with the configuration and used by every run. Press “Save changes” in the header to keep it.'
          : 'Turn on to pin a sequence. Off means the order is recalculated from foreign keys on every run.'}
      </Typography>
    </Paper>
  );
}
