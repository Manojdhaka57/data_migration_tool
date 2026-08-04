import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Select,
  MenuItem,
  FormControl,
  Switch,
  FormControlLabel,
  Button,
  Chip,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Tooltip,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Storage as DatabaseIcon,
  RestartAlt as ResetIcon,
  ArrowForward as ArrowIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as MigrateIcon,
  Speed as DryRunIcon,
  PlaylistPlay as SequenceIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import { useAppSelector, useAppDispatch } from '../../store';
import { selectTableMappings, setTableConflictStrategy } from '../mapping/mappingSlice';

type DbDialect = 'mysql' | 'postgresql';

interface TableStateRecord {
  status: 'done' | 'partial' | 'failed';
  rows: number;
  updatedAt: string;
}

interface RedisProgress {
  totalRows: number;
  processedRows: number;
  failedRows: number;
  skippedRows: number;
  perTable: Record<string, number>;
  percent: number;
}

interface MigrationExtrasPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colors: any;
  apiBase: string;
  sourceDbType: DbDialect;
  targetDbType: DbDialect;
  onSourceDbTypeChange: (v: DbDialect) => void;
  onTargetDbTypeChange: (v: DbDialect) => void;
  forceReTransfer: boolean;
  onForceChange: (v: boolean) => void;
  activeJobId: string | null;
  running: boolean;
  onMigrateTable: (targetTable: string, dryRun: boolean) => void;
  migratingTable: string | null;
  onMigrateAllSequential: () => void;
  onMigratePending: () => void;
  onStopSequence: () => void;
  sequence: { running: boolean; index: number; total: number; currentTable: string } | null;
}

export default function MigrationExtrasPanel({
  colors,
  apiBase,
  sourceDbType,
  targetDbType,
  onSourceDbTypeChange,
  onTargetDbTypeChange,
  forceReTransfer,
  onForceChange,
  activeJobId,
  running,
  onMigrateTable,
  migratingTable,
  onMigrateAllSequential,
  onMigratePending,
  onStopSequence,
  sequence,
}: MigrationExtrasPanelProps) {
  const dispatch = useAppDispatch();
  const tableMappings = useAppSelector(selectTableMappings);

  const [tableStatus, setTableStatus] = useState<Record<string, TableStateRecord>>({});
  const [redisProgress, setRedisProgress] = useState<RedisProgress | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const statusTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTableStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/table-status`);
      const data = await res.json();
      setTableStatus(data.tables || {});
    } catch {
      // server may be offline — leave previous state
    }
  }, [apiBase]);

  // Load durable table-transfer markers on mount and whenever a run finishes.
  useEffect(() => {
    loadTableStatus();
  }, [loadTableStatus, running]);

  // Poll the explicit Redis progress counters while a job is running.
  useEffect(() => {
    if (statusTimer.current) {
      clearInterval(statusTimer.current);
      statusTimer.current = null;
    }
    if (!running || !activeJobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/migration/${activeJobId}/progress`);
        const data = await res.json();
        setRedisProgress(data);
      } catch {
        // ignore transient errors
      }
    };
    poll();
    statusTimer.current = setInterval(poll, 1000);
    return () => {
      if (statusTimer.current) clearInterval(statusTimer.current);
    };
  }, [apiBase, activeJobId, running]);

  const resetAllStatus = async () => {
    setResetting(true);
    try {
      await fetch(`${apiBase}/table-status/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await loadTableStatus();
    } catch {
      // ignore
    } finally {
      setResetting(false);
    }
  };

  const resetOneStatus = async (table: string) => {
    try {
      await fetch(`${apiBase}/table-status/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table }),
      });
      await loadTableStatus();
    } catch {
      // ignore
    }
  };

  const statusChip = (table: string) => {
    const rec = tableStatus[table];
    if (!rec) {
      return <Chip size="small" label="Not transferred" sx={{ bgcolor: 'rgba(100,116,139,0.15)', color: colors.text.muted, fontWeight: 600 }} />;
    }
    const map = {
      done: { label: `Done · ${rec.rows} rows`, color: colors.accent.success, bg: 'rgba(74,222,128,0.15)' },
      partial: { label: 'Partial (will resume)', color: colors.accent.warning, bg: 'rgba(251,191,36,0.15)' },
      failed: { label: 'Failed (will retry)', color: colors.accent.error, bg: 'rgba(248,113,113,0.15)' },
    } as const;
    const c = map[rec.status];
    return <Chip size="small" label={c.label} sx={{ bgcolor: c.bg, color: c.color, fontWeight: 600 }} />;
  };

  const selectSx = {
    color: colors.text.primary,
    bgcolor: colors.bg.primary,
    '.MuiOutlinedInput-notchedOutline': { borderColor: colors.border },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.accent.primary },
    '.MuiSvgIcon-root': { color: colors.text.secondary },
  };

  const doneCount = Object.values(tableStatus).filter(s => s.status === 'done').length;

  const q = tableFilter.trim().toLowerCase();
  const filteredMappings = q
    ? tableMappings.filter(
        (m) =>
          (m.targetTables[0] || '').toLowerCase().includes(q) ||
          (m.sourceTables[0] || '').toLowerCase().includes(q)
      )
    : tableMappings;

  return (
    <Card sx={{ bgcolor: colors.bg.secondary, border: `1px solid ${colors.border}`, mb: 4, borderRadius: 3 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ color: colors.text.primary, fontWeight: 600, mb: 2 }}>
          Pipeline Settings &amp; Table Status
        </Typography>

        {/* Source → Target dialect + re-transfer controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, bgcolor: colors.bg.primary, borderRadius: 2, border: `1px solid ${colors.border}` }}>
            <DatabaseIcon sx={{ color: colors.accent.primary, fontSize: 20 }} />
            <FormControl size="small">
              <Select
                value={sourceDbType}
                onChange={(e) => onSourceDbTypeChange(e.target.value as DbDialect)}
                disabled={running}
                sx={selectSx}
              >
                <MenuItem value="mysql">MySQL</MenuItem>
                <MenuItem value="postgresql">PostgreSQL</MenuItem>
              </Select>
            </FormControl>
            <ArrowIcon sx={{ color: colors.text.muted, fontSize: 20 }} />
            <FormControl size="small">
              <Select
                value={targetDbType}
                onChange={(e) => onTargetDbTypeChange(e.target.value as DbDialect)}
                disabled={running}
                sx={selectSx}
              >
                <MenuItem value="mysql">MySQL</MenuItem>
                <MenuItem value="postgresql">PostgreSQL</MenuItem>
              </Select>
            </FormControl>
            <Tooltip title="Source and target dialects. Connection credentials still come from the server's .env (SOURCE_DB_* / TARGET_DB_*).">
              <Typography variant="caption" sx={{ color: colors.text.muted, ml: 0.5 }}>source → target</Typography>
            </Tooltip>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={forceReTransfer}
                onChange={(e) => onForceChange(e.target.checked)}
                disabled={running}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': { color: colors.accent.warning },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: colors.accent.warning },
                }}
              />
            }
            label={
              <Tooltip title="Re-transfer tables even if they are already marked done.">
                <Typography variant="body2" sx={{ color: colors.text.primary, fontWeight: 600 }}>Force re-transfer</Typography>
              </Tooltip>
            }
          />

          <Button
            variant="outlined"
            size="small"
            startIcon={resetting ? <CircularProgress size={16} sx={{ color: colors.accent.error }} /> : <ResetIcon />}
            onClick={resetAllStatus}
            disabled={resetting || running}
            sx={{ borderColor: colors.accent.error, color: colors.accent.error, fontWeight: 600, '&:hover': { borderColor: colors.accent.error, bgcolor: 'rgba(248,113,113,0.1)' } }}
          >
            Reset all status
          </Button>

          <Box sx={{ flex: 1 }} />
          <Chip
            size="small"
            label={`${doneCount} table(s) already transferred`}
            sx={{ bgcolor: 'rgba(74,222,128,0.12)', color: colors.accent.success, fontWeight: 600 }}
          />
          <Tooltip title="Refresh table status">
            <IconButton onClick={loadTableStatus} size="small" sx={{ color: colors.text.secondary }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Live Redis progress indicator */}
        {redisProgress && (running || (redisProgress.processedRows > 0)) && (
          <Box sx={{ p: 2, mb: 2, bgcolor: colors.bg.primary, borderRadius: 2, border: `1px solid ${colors.border}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" sx={{ color: colors.text.secondary, fontWeight: 600 }}>
                Live progress (Redis indicator)
              </Typography>
              <Typography variant="body2" sx={{ color: colors.accent.primary, fontWeight: 700 }}>
                {redisProgress.processedRows.toLocaleString()} / {redisProgress.totalRows.toLocaleString()} rows ({redisProgress.percent}%)
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, redisProgress.percent)}
              sx={{ height: 8, borderRadius: 4, bgcolor: colors.border, '& .MuiLinearProgress-bar': { bgcolor: colors.accent.primary } }}
            />
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <Typography variant="caption" sx={{ color: colors.accent.error }}>failed: {redisProgress.failedRows.toLocaleString()}</Typography>
              <Typography variant="caption" sx={{ color: colors.text.muted }}>skipped (duplicates): {redisProgress.skippedRows.toLocaleString()}</Typography>
            </Box>
          </Box>
        )}

        {/* Per-table migration: each table has its own Dry Run / Migrate buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ color: colors.text.secondary, fontWeight: 600 }}>
              Table-wise migration ({tableMappings.length} tables)
            </Typography>
            {sequence?.running ? (
              <>
                <Chip
                  size="small"
                  label={`Running ${sequence.index}/${sequence.total}: ${sequence.currentTable}`}
                  sx={{ bgcolor: 'rgba(56,189,248,0.15)', color: colors.accent.primary, fontWeight: 600 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<StopIcon />}
                  onClick={onStopSequence}
                  sx={{ bgcolor: colors.accent.error, color: '#fff', '&:hover': { bgcolor: '#ef4444' } }}
                >
                  Stop
                </Button>
              </>
            ) : (
              <>
                <Tooltip title="Migrate every table one-by-one in foreign-key dependency order (parents first), in a single click.">
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<SequenceIcon />}
                      onClick={onMigrateAllSequential}
                      disabled={running || !!migratingTable || tableMappings.length === 0}
                      sx={{ bgcolor: colors.accent.secondary, color: colors.bg.primary, fontWeight: 600, '&:hover': { bgcolor: '#9171f0' } }}
                    >
                      Migrate all in sequence
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Migrate only the tables not yet transferred (skips ones already marked done), one-by-one in dependency order.">
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SequenceIcon />}
                      onClick={onMigratePending}
                      disabled={running || !!migratingTable || tableMappings.length === 0}
                      sx={{ borderColor: colors.accent.success, color: colors.accent.success, fontWeight: 600, '&:hover': { borderColor: colors.accent.success, bgcolor: 'rgba(74,222,128,0.1)' } }}
                    >
                      Migrate not-transferred
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </Box>
          <TextField
            size="small"
            placeholder="Filter tables…"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            sx={{
              minWidth: 220,
              '& .MuiOutlinedInput-root': {
                color: colors.text.primary,
                bgcolor: colors.bg.primary,
                '& fieldset': { borderColor: colors.border },
              },
              '& .MuiInputBase-input::placeholder': { color: colors.text.muted },
            }}
          />
        </Box>
        {sequence?.running && (
          <LinearProgress
            variant="determinate"
            value={Math.round((sequence.index / Math.max(1, sequence.total)) * 100)}
            sx={{ height: 6, borderRadius: 3, mb: 1, bgcolor: colors.border, '& .MuiLinearProgress-bar': { bgcolor: colors.accent.secondary } }}
          />
        )}

        <Box sx={{ maxHeight: 420, overflow: 'auto', border: `1px solid ${colors.border}`, borderRadius: 2 }}>
          {tableMappings.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.text.muted, p: 2, textAlign: 'center' }}>
              No table mappings configured yet.
            </Typography>
          ) : filteredMappings.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.text.muted, p: 2, textAlign: 'center' }}>
              No tables match the filter.
            </Typography>
          ) : (
            filteredMappings.map((m) => {
              const targetTable = m.targetTables[0] || '';
              const sourceTable = m.sourceTables[0] || '';
              const strategy = m.conflictStrategy ?? 'skip';
              const busy = migratingTable === targetTable;
              return (
                <Accordion
                  key={m.id}
                  disableGutters
                  sx={{
                    bgcolor: colors.bg.primary,
                    color: colors.text.primary,
                    borderBottom: `1px solid ${colors.border}`,
                    '&:before': { display: 'none' },
                    boxShadow: 'none',
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text.secondary }} />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', minWidth: 160 }}>
                        <span style={{ color: colors.text.secondary }}>{sourceTable}</span>
                        {' → '}
                        <span style={{ fontWeight: 600 }}>{targetTable}</span>
                      </Typography>
                      {statusChip(targetTable)}
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={busy ? <CircularProgress size={14} /> : <DryRunIcon fontSize="small" />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMigrateTable(targetTable, true);
                        }}
                        disabled={running || !!migratingTable || !!sequence?.running}
                        sx={{
                          borderColor: colors.accent.info,
                          color: colors.accent.info,
                          '&:hover': { borderColor: colors.accent.info, bgcolor: 'rgba(96,165,250,0.1)' },
                        }}
                      >
                        Dry Run
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <MigrateIcon fontSize="small" />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMigrateTable(targetTable, false);
                        }}
                        disabled={running || !!migratingTable || !!sequence?.running}
                        sx={{ bgcolor: colors.accent.success, color: colors.bg.primary, '&:hover': { bgcolor: '#22c55e' } }}
                      >
                        Migrate
                      </Button>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ bgcolor: colors.bg.secondary }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{ color: colors.text.muted }}>
                          Duplicates:
                        </Typography>
                        <FormControl size="small">
                          <Select
                            value={strategy}
                            onChange={(e) =>
                              dispatch(setTableConflictStrategy({ id: m.id, conflictStrategy: e.target.value as 'skip' | 'upsert' }))
                            }
                            sx={selectSx}
                          >
                            <MenuItem value="skip">Skip duplicates</MenuItem>
                            <MenuItem value="upsert">Upsert (overwrite)</MenuItem>
                          </Select>
                        </FormControl>
                      </Box>
                      {tableStatus[targetTable] && (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<ResetIcon fontSize="small" />}
                          onClick={() => resetOneStatus(targetTable)}
                          sx={{ color: colors.text.muted }}
                        >
                          Reset this table's status
                        </Button>
                      )}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              );
            })
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
