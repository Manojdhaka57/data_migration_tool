/**
 * The ETL pipeline, drawn.
 *
 * Source DB → Table Mapping → Transformation → Target DB, with batch markers
 * moving between the stages while a migration runs, then a card per table
 * transfer laid out like the reference dashboard's pipeline cards.
 *
 * Every number here traces to a field the backend actually sends. Where a
 * figure is not available it is labelled or omitted rather than estimated:
 *
 *  - The target-side count is ROWS WRITTEN THIS RUN (successRows), not the
 *    total row count of the target table. Those differ, and only the first is
 *    in the live stream.
 *  - The run-wide total grows as each table starts (the worker only counts a
 *    table's rows when it reaches it), so it is shown as "so far".
 *  - The Transformation stage has no timing of its own — transformation happens
 *    inline inside the worker's batch handler. It shows how many transform
 *    rules are configured and pulses as batches pass, and claims nothing more.
 *  - Stat deltas compare against the PREVIOUS RUN and are absent entirely when
 *    there is no previous run.
 */
import { useMemo } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Tooltip, Typography } from '@mui/material';
import {
  Storage as SourceIcon,
  AccountTree as MappingIcon,
  Transform as TransformIcon,
  Dns as TargetIcon,
  East as ArrowIcon,
  TableChart as TableIcon,
  DataUsage as RowsIcon,
  CheckCircle as TablesIcon,
  Speed as RateIcon,
  Timer as TimeIcon,
} from '@mui/icons-material';
import FlowConnector from './FlowConnector';
import { useBatchPulse } from './useBatchPulse';
import {
  IconTile,
  StatusPill,
  StatCard,
  MetricRow,
  type PillStatus,
  type TileTone,
} from '../../../components/ui';
import { runDeltas, formatDelta } from '../runDelta';
import type { TableResult, MigrationResult } from '../migrationResultsSlice';

export interface FlowTable {
  /** Target table name. */
  target: string;
  sourceTable: string;
}

export interface MigrationFlowViewProps {
  running: boolean;
  jobId: string | null;
  progress: number;
  currentTable: string;
  processedRows: number;
  failedRows: number;
  throughput: number;
  eta: number;
  batchIndex: number | null;
  batchRows: number | null;
  batchSize: number | null;
  runTotalRows: number | null;
  /** Per-table results from the live stream, or the last completed run. */
  results: TableResult[];
  /** Full run history — index 0 newest — for previous-run comparisons. */
  history: MigrationResult[];
  /** Every table in the plan, so queued ones are visible before they start. */
  plannedTables: FlowTable[];
  sourceDbType: string;
  targetDbType: string;
  sourceDatabase: string;
  targetDatabase: string;
  /** Column mappings that transform rather than copy. */
  transformRuleCount: number;
  mappedTableCount: number;
}

const compact = (n: number) => n.toLocaleString();

const formatDuration = (ms: number): string => {
  if (!ms || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

function Stage({
  icon,
  tone,
  title,
  subtitle,
  detail,
  active,
}: {
  icon: React.ReactNode;
  tone: TileTone;
  title: string;
  subtitle: string;
  detail: string;
  active: boolean;
}) {
  return (
    <Box
      sx={{
        minWidth: 132,
        px: 2,
        py: 1.75,
        borderRadius: 3,
        textAlign: 'center',
        bgcolor: 'white.main',
        border: 1,
        borderColor: active ? 'primary.300' : 'neutral.200',
        boxShadow: active ? '0 0 0 4px rgba(42, 73, 84,0.08)' : 'none',
        transition: 'border-color .3s ease, box-shadow .3s ease',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
        <IconTile tone={tone} size={36}>
          {icon}
        </IconTile>
      </Box>
      <Typography variant="body2Medium" sx={{ display: 'block', color: 'neutral.800' }}>
        {title}
      </Typography>
      <Typography variant="caption2" sx={{ color: 'neutral.500' }}>
        {subtitle}
      </Typography>
      <Typography variant="caption2" sx={{ display: 'block', color: 'neutral.400', mt: 0.25 }}>
        {detail}
      </Typography>
    </Box>
  );
}

export default function MigrationFlowView(props: MigrationFlowViewProps) {
  const {
    running,
    jobId,
    progress,
    currentTable,
    processedRows,
    failedRows,
    throughput,
    eta,
    batchIndex,
    batchRows,
    batchSize,
    runTotalRows,
    results,
    history,
    plannedTables,
    sourceDbType,
    targetDbType,
    sourceDatabase,
    targetDatabase,
    transformRuleCount,
    mappedTableCount,
  } = props;

  const { pulses, retire } = useBatchPulse({
    processedRows,
    currentTable,
    batchRows,
    batchIndex,
    jobId,
    active: running,
  });

  const resultByTable = useMemo(() => {
    const map = new Map<string, TableResult>();
    for (const result of results) map.set(result.table, result);
    return map;
  }, [results]);

  /** The plan, in order, annotated with whatever the run has reported. */
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const ordered: Array<{ table: FlowTable; result: TableResult | undefined; state: PillStatus }> = [];

    const classify = (target: string, result: TableResult | undefined): PillStatus => {
      if (!result) return 'queued';
      if (running && target === currentTable) return 'running';
      const status = result.status;
      if (status === 'success') return 'completed';
      if (status === 'failed' || status === 'skipped') return status;
      return 'partial';
    };

    for (const table of plannedTables) {
      seen.add(table.target);
      ordered.push({
        table,
        result: resultByTable.get(table.target),
        state: classify(table.target, resultByTable.get(table.target)),
      });
    }

    // A run can touch a table the current plan does not list (an older saved
    // configuration, say). Show it rather than pretending it did not happen.
    for (const result of results) {
      if (seen.has(result.table)) continue;
      ordered.push({
        table: { target: result.table, sourceTable: result.sourceTable },
        result,
        state: classify(result.table, result),
      });
    }
    return ordered;
  }, [plannedTables, resultByTable, results, running, currentTable]);

  const completed = rows.filter((r) => r.state === 'completed').length;
  const failed = rows.filter((r) => r.state === 'failed').length;
  const queued = rows.filter((r) => r.state === 'queued').length;
  const currentIndex = rows.findIndex((r) => r.state === 'running');
  const hasFailures = failed > 0 || failedRows > 0;
  const tone = hasFailures ? 'error' : 'normal';

  // Deltas exist only once there is a previous run to compare with; every one
  // of these can legitimately be null and then no badge renders.
  const deltas = useMemo(() => runDeltas(history), [history]);
  const lastRun = history[0];
  const successRate =
    processedRows + failedRows > 0
      ? (processedRows / (processedRows + failedRows)) * 100
      : lastRun && lastRun.totalRows > 0
        ? (lastRun.totalSuccess / lastRun.totalRows) * 100
        : null;

  const overallStatus: PillStatus = running
    ? 'running'
    : hasFailures
      ? 'failed'
      : results.length > 0
        ? 'completed'
        : 'idle';

  return (
    <Box>
      {/* ------------------------------------------------------- stat row */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
          gap: 2.5,
          mb: 3,
        }}
      >
        <StatCard
          icon={<RowsIcon />}
          tone="indigo"
          value={compact(processedRows)}
          label="Rows migrated"
          delta={formatDelta(deltas.rows)}
          deltaGood={deltas.rows?.good}
        />
        <StatCard
          icon={<TablesIcon />}
          tone="green"
          value={`${completed}/${rows.length}`}
          label="Tables completed"
          delta={formatDelta(deltas.tables)}
          deltaGood={deltas.tables?.good}
        />
        <StatCard
          icon={<RateIcon />}
          tone="blue"
          value={successRate === null ? '—' : `${successRate.toFixed(1)}%`}
          label="Success rate"
          delta={formatDelta(deltas.successRate)}
          deltaGood={deltas.successRate?.good}
        />
        <StatCard
          icon={<TimeIcon />}
          tone="amber"
          value={running ? `${compact(throughput)}/s` : formatDuration(lastRun?.duration ?? 0)}
          label={running ? 'Rows per second' : 'Last run duration'}
          delta={running ? null : formatDelta(deltas.duration)}
          deltaGood={deltas.duration?.good}
        />
      </Box>

      {/* ---------------------------------------------------- the pipeline */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: { xs: 'wrap', md: 'nowrap' },
            }}
          >
            <Stage
              icon={<SourceIcon />}
              tone="blue"
              title={sourceDbType === 'mysql' ? 'MySQL' : 'PostgreSQL'}
              subtitle={sourceDatabase || 'source'}
              detail="Source DB"
              active={running}
            />
            <FlowConnector
              pulses={pulses}
              onPulseEnd={retire}
              batchSize={batchSize}
              active={running}
              tone={tone}
            />
            <Stage
              icon={<MappingIcon />}
              tone="indigo"
              title="Mapping"
              subtitle={`${mappedTableCount} table${mappedTableCount === 1 ? '' : 's'}`}
              detail="Table Mapping"
              active={running}
            />
            <FlowConnector
              pulses={pulses}
              onPulseEnd={retire}
              batchSize={batchSize}
              active={running}
              tone={tone}
              delayMs={120}
            />
            <Tooltip title="Transformations run inside each batch, so they have no separate rate. This is how many column rules are configured.">
              <Box>
                <Stage
                  icon={<TransformIcon />}
                  tone="amber"
                  title="Transform"
                  subtitle={`${transformRuleCount} rule${transformRuleCount === 1 ? '' : 's'}`}
                  detail="Transformation"
                  active={running}
                />
              </Box>
            </Tooltip>
            <FlowConnector
              pulses={pulses}
              onPulseEnd={retire}
              batchSize={batchSize}
              active={running}
              tone={tone}
              delayMs={240}
            />
            <Stage
              icon={<TargetIcon />}
              tone="green"
              title={targetDbType === 'mysql' ? 'MySQL' : 'PostgreSQL'}
              subtitle={targetDatabase || 'target'}
              detail="Target DB"
              active={running}
            />
          </Box>

          {/* ------------------------------------------------ status line */}
          <Box sx={{ mt: 2.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            <StatusPill
              status={overallStatus}
              label={overallStatus === 'failed' && !running ? 'Finished with failures' : undefined}
            />
            {running && currentIndex >= 0 && (
              <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
                table {currentIndex + 1} of {rows.length} ·{' '}
                <Box component="span" sx={{ color: 'neutral.800', fontWeight: 600 }}>
                  {currentTable}
                </Box>
              </Typography>
            )}
            {running && batchIndex !== null && (
              <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
                batch {compact(batchIndex)}
                {batchRows !== null && ` (${compact(batchRows)} rows)`}
              </Typography>
            )}
            {running && (
              <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
                ETA {eta > 0 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : '—'}
              </Typography>
            )}
          </Box>

          <LinearProgress
            variant="determinate"
            value={running ? progress : results.length > 0 ? 100 : 0}
            sx={{
              mt: 1.5,
              height: 8,
              borderRadius: 4,
              bgcolor: 'primary.100',
              '& .MuiLinearProgress-bar': {
                bgcolor: running ? 'primary.main' : hasFailures ? 'error.main' : 'success.main',
                borderRadius: 4,
              },
            }}
          />

          <Box sx={{ mt: 1.25, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Typography variant="caption1" sx={{ color: 'success.main' }}>
              {completed} completed
            </Typography>
            <Typography variant="caption1" sx={{ color: failed > 0 ? 'error.main' : 'neutral.400' }}>
              {failed} failed
            </Typography>
            <Typography variant="caption1" sx={{ color: 'neutral.400' }}>
              {queued} queued
            </Typography>
            <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
              {compact(processedRows)} rows written
              {runTotalRows ? ` of ${compact(runTotalRows)} counted so far` : ''}
            </Typography>
            {failedRows > 0 && (
              <Typography variant="caption1" sx={{ color: 'error.main' }}>
                {compact(failedRows)} rows failed
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* ------------------------------------------- table transfer cards */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1.5 }}>
        <Typography variant="h3Bold" sx={{ color: 'neutral.800' }}>
          Table Transfers
        </Typography>
        {rows.length > 0 && (
          <Chip
            size="small"
            label={`${rows.length} table${rows.length === 1 ? '' : 's'}`}
            sx={{ bgcolor: 'neutral.100', color: 'neutral.600' }}
          />
        )}
        <Typography variant="caption1" sx={{ color: 'neutral.400' }}>
          Records are rows written by this run, not the total size of the target table
        </Typography>
      </Box>

      {rows.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body2" sx={{ color: 'neutral.500' }}>
              No table mappings configured yet.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        /* Two rows at a time; the rest scrolls. A migration can have 155 table
           mappings, and letting that run down the page pushes the pipeline
           diagram — the thing you actually watch — off screen.

           maxHeight is two card heights plus the gap. It is deliberately a few
           pixels short of exact, so a sliver of the third row stays visible and
           signals there is more to scroll. */
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
            gap: 2.5,
            maxHeight: 420,
            overflowY: 'auto',
            // Keeps the scrollbar off the card borders.
            pr: 1,
            // A card scrolled to with keyboard navigation should not be flush
            // against the top edge.
            scrollPaddingTop: 8,
          }}
        >
          {rows.map(({ table, result, state }) => {
            const total = result?.totalRows ?? 0;
            const written = result?.successRows ?? 0;
            const percent = total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;
            const rowSuccessRate =
              result && written + result.failedRows > 0
                ? (written / (written + result.failedRows)) * 100
                : null;

            const tileTone =
              state === 'completed'
                ? 'blue'
                : state === 'failed'
                  ? 'red'
                  : state === 'running'
                    ? 'green'
                    : 'neutral';

            return (
              <Card key={table.target}>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  {/* title row */}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <IconTile tone={tileTone}>
                      <TableIcon />
                    </IconTile>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body1Medium" sx={{ color: 'neutral.800' }} noWrap>
                        {table.target}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                        <Typography variant="caption1" sx={{ color: 'neutral.500', fontFamily: 'monospace' }} noWrap>
                          {table.sourceTable}
                        </Typography>
                        <ArrowIcon sx={{ fontSize: 13, color: 'neutral.400', flexShrink: 0 }} />
                        <Typography variant="caption1" sx={{ color: 'neutral.500', fontFamily: 'monospace' }} noWrap>
                          {table.target}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  {/* status + live flow */}
                  <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <StatusPill status={state} />
                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                      {state === 'running' ? (
                        <FlowConnector
                          pulses={pulses}
                          // Retirement is owned by the header connector; this
                          // one mirrors the same pulse list.
                          onPulseEnd={() => {}}
                          batchSize={batchSize}
                          active
                          tone={tone}
                        />
                      ) : null}
                    </Box>
                    <Typography variant="caption1Medium" sx={{ color: 'neutral.500' }}>
                      {state === 'queued' ? '—' : `${percent}%`}
                    </Typography>
                  </Box>

                  {/* metrics */}
                  <Box sx={{ mt: 2 }}>
                    <MetricRow
                      metrics={[
                        {
                          label: 'Records',
                          value:
                            state === 'queued'
                              ? '—'
                              : total > 0
                                ? `${compact(written)} / ${compact(total)}`
                                : compact(written),
                        },
                        {
                          label: 'Duration',
                          value: result ? formatDuration(result.duration) : '—',
                        },
                        {
                          label: 'Success Rate',
                          value: rowSuccessRate === null ? '—' : `${rowSuccessRate.toFixed(1)}%`,
                          tone:
                            rowSuccessRate === null
                              ? 'default'
                              : rowSuccessRate === 100
                                ? 'success'
                                : rowSuccessRate >= 95
                                  ? 'warning'
                                  : 'error',
                        },
                      ]}
                    />
                  </Box>

                  <LinearProgress
                    variant="determinate"
                    value={state === 'queued' ? 0 : percent}
                    sx={{
                      mt: 1.75,
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'neutral.100',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        bgcolor:
                          state === 'failed'
                            ? 'error.main'
                            : state === 'completed'
                              ? 'info.main'
                              : state === 'running'
                                ? 'primary.main'
                                : 'neutral.300',
                      },
                    }}
                  />

                  {result && result.failedRows > 0 && (
                    <Typography variant="caption2" sx={{ display: 'block', mt: 1, color: 'error.main' }}>
                      {compact(result.failedRows)} rows failed
                      {result.errors[0] ? ` · ${result.errors[0]}` : ''}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
