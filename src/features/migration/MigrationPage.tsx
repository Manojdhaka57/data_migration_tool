import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Tooltip,
  IconButton,
  Tabs,
  Tab,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  Checkbox,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Snackbar,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import {
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Storage as DatabaseIcon,
  Schedule as TimeIcon,
  TableChart as TableIcon,
  DataObject as RowIcon,
  Speed as SpeedIcon,
  LinkOff as DisconnectedIcon,
  Link as ConnectedIcon,
  SelectAll as SelectAllIcon,
  FilterList as FilterListIcon,
  ExpandMore as ExpandMoreIcon,
  CompareArrows as CompareArrowsIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useAppSelector, useAppDispatch } from '../../store';
import { selectTableMappings } from '../mapping/mappingSlice';
import { selectCustomDependencies } from '../migrationOrder/migrationOrderSlice';
import { 
  selectMigrationResults, 
  selectSelectedResult,
  setResults,
  setSelectedResult,
  type TableResult,
} from './migrationResultsSlice';
import type { TableMapping as FrontendTableMapping } from '../../types';
import MigrationExtrasPanel from './MigrationExtrasPanel';

const API_BASE = 'http://localhost:9005/api';

interface ConnectionStatus {
  success: boolean;
  message: string;
  tables?: number;
}

interface MigrationStatus {
  running: boolean;
  progress: number;
  currentTable: string;
  results: TableResult[];
}

interface DBTable {
  name: string;
  rowCount: number;
}

interface TablesModalData {
  open: boolean;
  type: 'source' | 'target' | null;
  tables: DBTable[];
  totalTables: number;
  totalRows: number;
  loading: boolean;
}

// Transform frontend TableMapping format to server format
function transformMappingForServer(frontendMappings: FrontendTableMapping[]): any[] {
  return frontendMappings.map(fm => {
    // Get primary source and target tables (use first one)
    const sourceTable = fm.sourceTables[0] || '';
    const targetTable = fm.targetTables[0] || '';
    
    const hasJoins = Array.isArray(fm.joins) && fm.joins.length > 0;
    // Transform column mappings
    const columnMappings = fm.columnMappings.map(cm => {
      // With joins, sources are qualified "table.column" so they resolve in the joined query.
      const directSource = typeof cm.source === 'string'
        ? cm.source
        : (hasJoins && cm.source?.table ? `${cm.source.table}.${cm.source.column}` : (cm.source?.column || ''));
      // TRANSFORM/CONCAT keep their input column in sourceColumns (not `source`).
      // Surface the first one as `source` so the backend engine reads the right value.
      const firstSrc = cm.sourceColumns && cm.sourceColumns.length > 0 ? cm.sourceColumns[0] : undefined;
      const firstSourceCol = !firstSrc
        ? ''
        : (typeof firstSrc === 'string'
            ? firstSrc
            : (hasJoins && firstSrc.table ? `${firstSrc.table}.${firstSrc.column}` : (firstSrc.column || '')));
      const isTransform = cm.mappingType === 'TRANSFORM' || cm.mappingType === 'CONCAT';
      const targetCol = typeof cm.target === 'string' ? cm.target : cm.target?.column || '';
      // CUSTOM (raw SQL) and BUILD_JSON transforms are evaluated in the source query as
      // an aliased column; point `source` at that alias so the backend reads the result.
      const isCustom =
        cm.mappingType === 'TRANSFORM' &&
        (cm.transformation?.type === 'CUSTOM' || cm.transformation?.type === 'BUILD_JSON');
      const exprAlias = `__expr_${targetCol}`;

      const serverMapping: any = {
        source: isCustom ? exprAlias : (isTransform && firstSourceCol ? firstSourceCol : directSource),
        target: targetCol,
        mappingType: cm.mappingType || 'DIRECT',
      };

      if (cm.constantValue !== undefined) {
        serverMapping.constantValue = cm.constantValue;
      }
      // Carry the transformation rule (e.g. UPPER) — without it a TRANSFORM column
      // would silently fall back to a plain copy.
      if (cm.transformation) {
        serverMapping.transformation = cm.transformation;
      }
      if (cm.convertDateToEpoch === true) {
        serverMapping.convertDateToEpoch = true;
      }
      if (cm.convertTinyintToBoolean === true) {
        serverMapping.convertTinyintToBoolean = true;
      }
      if (cm.zeroToNull === true) {
        serverMapping.zeroToNull = true;
      }
      if (cm.encrypt === true) {
        serverMapping.encrypt = true;
      }
      if (cm.useGroupMin === true) {
        serverMapping.useGroupMin = true;
      }

      return serverMapping;
    });
    
    return {
      sourceTable,
      targetTable,
      columnMappings,
      conflictStrategy: fm.conflictStrategy ?? 'skip',
      ...(fm.conflictKeyColumns && fm.conflictKeyColumns.length > 0 && {
        conflictKeyColumns: fm.conflictKeyColumns,
      }),
      ...(fm.rowFilters && fm.rowFilters.length > 0 && {
        rowFilters: fm.rowFilters,
      }),
      ...(hasJoins && { joins: fm.joins }),
      ...(fm.groupByColumns && fm.groupByColumns.length > 0 && {
        groupByColumns: fm.groupByColumns,
      }),
      ...(fm.groupByMode && { groupByMode: fm.groupByMode }),
      ...(fm.groupMinColumns && fm.groupMinColumns.length > 0 && {
        groupMinColumns: fm.groupMinColumns,
      }),
      ...(fm.orderBy && fm.orderBy.length > 0 && {
        orderBy: fm.orderBy,
      }),
      ...(fm.autoIdColumn && { autoIdColumn: fm.autoIdColumn }),
    };
  });
}

export default function MigrationPage() {
  const dispatch = useAppDispatch();
  const tableMappings = useAppSelector(selectTableMappings);
  // Collapse duplicate mappings for the same source→target pair, keeping the richest
  // (most column mappings). Without this, an old auto-generated mapping that shares a
  // target with the user's custom mapping can be the one the migration runs.
  const migrationMappings = useMemo(() => {
    const byPair = new Map<string, typeof tableMappings[number]>();
    for (const m of tableMappings) {
      const key = `${m.sourceTables?.[0] || ''}->${m.targetTables?.[0] || ''}`;
      const existing = byPair.get(key);
      if (!existing || m.columnMappings.length >= existing.columnMappings.length) {
        byPair.set(key, m);
      }
    }
    return Array.from(byPair.values());
  }, [tableMappings]);
  const customDependencies = useAppSelector(selectCustomDependencies);
  const recentResults = useAppSelector(selectMigrationResults);
  const selectedResult = useAppSelector(selectSelectedResult);
  
  const [activeTab, setActiveTab] = useState(0);
  const [sourceConnection, setSourceConnection] = useState<ConnectionStatus | null>(null);
  const [targetConnection, setTargetConnection] = useState<ConnectionStatus | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createTablesLoading, setCreateTablesLoading] = useState(false);
  const [createTablesSnackbar, setCreateTablesSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'success' });
  const [serverOnline, setServerOnline] = useState(false);
  const [tablesModal, setTablesModal] = useState<TablesModalData>({
    open: false,
    type: null,
    tables: [],
    totalTables: 0,
    totalRows: 0,
    loading: false,
  });
  const [tableSearch, setTableSearch] = useState('');
  const [tableSelectionSearch, setTableSelectionSearch] = useState('');
  const [tableWiseMode, setTableWiseMode] = useState(false);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [tableSelectionDialog, setTableSelectionDialog] = useState(false);
  const [ddlCheckLoading, setDdlCheckLoading] = useState(false);
  const [ddlCheckDialog, setDdlCheckDialog] = useState(false);
  const [ddlCheckResults, setDdlCheckResults] = useState<Array<{
    sourceTable: string;
    targetTable: string;
    source: { exists: boolean; columns: unknown[]; primaryKeyColumns: string[] };
    target: { exists: boolean; columns: unknown[]; primaryKeyColumns: string[] };
    match: boolean;
    differences: string[];
  }>>([]);

  // Real-time Queue Monitor Metrics
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [throughput, setThroughput] = useState(0);
  const [eta, setEta] = useState(0);
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [processedRows, setProcessedRows] = useState(0);
  const [failedRows, setFailedRows] = useState(0);
  const [useCopy, setUseCopy] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [sourceDbType, setSourceDbType] = useState<'mysql' | 'postgresql'>('mysql');
  const [targetDbType, setTargetDbType] = useState<'mysql' | 'postgresql'>('postgresql');
  const [forceReTransfer, setForceReTransfer] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState('');
  const [perTableActive, setPerTableActive] = useState<string | null>(null);
  const [sequence, setSequence] = useState<{ running: boolean; index: number; total: number; currentTable: string } | null>(null);
  const sequenceCancel = useRef(false);
  
  // Refs to avoid unnecessary re-renders
  const hasSelectedResult = useRef(false);
  const isPolling = useRef(false);
  const wasRunning = useRef(false);

  // WebSockets Live Listener
  useEffect(() => {
    const socket = io('http://localhost:9005');
    
    socket.on('connect', () => {
      console.log('🔌 Connected to migration WebSocket server');
      setServerOnline(true);
    });

    socket.on('disconnect', () => {
      setServerOnline(false);
    });

    socket.on('migration-progress', (data) => {
      if (data.jobId) {
        setActiveJobId(data.jobId);
      }
      setMigrationStatus({
        running: data.progress < 100 && data.currentTable !== 'Completed',
        progress: data.progress,
        currentTable: data.currentTable,
        results: data.results,
      });
      setThroughput(data.throughput || 0);
      setEta(data.eta || 0);
      setMemoryUsage(data.memoryUsage || 0);
      setProcessedRows(data.processedRows || 0);
      setFailedRows(data.failedRows || 0);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Load resolved default dialects from the server (.env) once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/config`);
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg.sourceDbType) setSourceDbType(cfg.sourceDbType);
        if (cfg.targetDbType) setTargetDbType(cfg.targetDbType);
      } catch {
        // server offline — keep defaults
      }
    })();
  }, []);

  // REST API Controllers for Queue Interactions
  const pauseMigration = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`${API_BASE}/migration/${activeJobId}/pause`, { method: 'POST' });
      setIsPaused(true);
    } catch {
      setError('Failed to pause migration');
    }
  };

  const resumeMigration = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`${API_BASE}/migration/${activeJobId}/resume`, { method: 'POST' });
      setIsPaused(false);
    } catch {
      setError('Failed to resume migration');
    }
  };

  const cancelMigration = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`${API_BASE}/migration/${activeJobId}/cancel`, { method: 'POST' });
      setMigrationStatus(null);
      setIsPaused(false);
      setActiveJobId(null);
    } catch {
      setError('Failed to cancel migration');
    }
  };

  const exportCsvReport = () => {
    if (!activeJobId) return;
    window.open(`${API_BASE}/reports/${activeJobId}/csv`);
  };

  // Check server health
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      setServerOnline(res.ok);
      return res.ok;
    } catch {
      setServerOnline(false);
      return false;
    }
  }, []);

  // Test connections - using the combined endpoint for faster loading
  const testConnections = useCallback(async (forceRefresh = false) => {
    try {
      const refreshParam = forceRefresh ? '?refresh=true' : '';
      const res = await fetch(`${API_BASE}/test-connection/both${refreshParam}`);
      const data = await res.json();
      
      setSourceConnection(data.source);
      setTargetConnection(data.target);
    } catch (err) {
      setError('Failed to test connections');
    }
  }, []);

  // Get migration status
  const getStatus = useCallback(async () => {
    if (isPolling.current) return;
    isPolling.current = true;
    
    try {
      const res = await fetch(`${API_BASE}/status`);
      const status = await res.json();
      setMigrationStatus(status);
    } catch {
      // Ignore errors during polling
    } finally {
      isPolling.current = false;
    }
  }, []);

  // Get recent results
  const getResults = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/results`);
      const results = await res.json();
      dispatch(setResults(results));
      
      // Only auto-select first result once
      if (results.length > 0 && !hasSelectedResult.current) {
        dispatch(setSelectedResult(results[0]));
        hasSelectedResult.current = true;
      }
    } catch {
      // Ignore errors
    }
  }, [dispatch]);

  // Fetch tables with row counts
  const fetchTables = useCallback(async (type: 'source' | 'target') => {
    setTablesModal(prev => ({ ...prev, open: true, type, loading: true, tables: [], totalTables: 0, totalRows: 0 }));
    setTableSearch('');
    
    try {
      const res = await fetch(`${API_BASE}/tables/${type}`);
      const data = await res.json();
      
      if (data.success) {
        setTablesModal(prev => ({
          ...prev,
          tables: data.tables,
          totalTables: data.totalTables,
          totalRows: data.totalRows,
          loading: false,
        }));
      } else {
        setTablesModal(prev => ({ ...prev, loading: false }));
        setError(data.error || 'Failed to fetch tables');
      }
    } catch (err) {
      setTablesModal(prev => ({ ...prev, loading: false }));
      setError('Failed to fetch tables');
    }
  }, []);

  // Close tables modal
  const closeTablesModal = useCallback(() => {
    setTablesModal({ open: false, type: null, tables: [], totalTables: 0, totalRows: 0, loading: false });
    setTableSearch('');
  }, []);

  // Handle table selection
  const handleTableToggle = (targetTable: string) => {
    setSelectedTables(prev => {
      const newSet = new Set(prev);
      if (newSet.has(targetTable)) {
        newSet.delete(targetTable);
      } else {
        newSet.add(targetTable);
      }
      // Force React to detect the change by creating a new Set
      return new Set(newSet);
    });
  };

  const handleSelectAllTables = () => {
    const allTargetTables = tableMappings.map(m => m.targetTables[0] || '').filter(Boolean);
    setSelectedTables(new Set(allTargetTables));
  };

  const handleDeselectAllTables = () => {
    setSelectedTables(new Set());
  };

  // Open table selection dialog
  const openTableSelection = () => {
    // Initialize with all tables selected if none selected
    if (selectedTables.size === 0) {
      handleSelectAllTables();
    }
    setTableSelectionSearch('');
    setTableSelectionDialog(true);
  };

  // Run migration
  const runMigration = async (dryRun: boolean) => {
    setLoading(true);
    setError(null);
    dispatch(setSelectedResult(null)); // Clear previous result
    hasSelectedResult.current = false; // Reset to auto-select new result
    
    try {
      const endpoint = dryRun ? '/migrate/dry-run' : '/migrate';
      
      // Filter table mappings if table-wise mode is enabled
      let mappingsToUse = migrationMappings;
      if (tableWiseMode && selectedTables.size > 0) {
        mappingsToUse = migrationMappings.filter(m => {
          const targetTable = m.targetTables[0] || '';
          return selectedTables.has(targetTable);
        });

        if (mappingsToUse.length === 0) {
          setError('Please select at least one table to migrate');
          setLoading(false);
          return;
        }
      }
      
      // Transform table mappings from Redux format to server format
      const serverMappings = transformMappingForServer(mappingsToUse);
      const mappingConfig = {
        tableMappings: serverMappings,
      };
      
      // Send target schema, mapping config, and migration order custom dependencies
      const requestBody: any = {
        useCopy,
        sourceDbType,
        targetDbType,
        force: forceReTransfer,
        ...(encryptionKey ? { encryptionKey } : {}),
      };
      if (serverMappings.length > 0) {
        requestBody.mappingConfig = mappingConfig;
      }
      if (customDependencies.length > 0) {
        requestBody.customDependencies = customDependencies;
      }
      
      const res = await fetch(`${API_BASE}${endpoint}`, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: Object.keys(requestBody).length > 0 ? JSON.stringify(requestBody) : undefined,
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Migration failed');
      }

      if (data.jobId) {
        setActiveJobId(data.jobId);
      }
      
      // Set migration status to running immediately
      setMigrationStatus({
        running: true,
        progress: 0,
        currentTable: 'Initializing queue...',
        results: [],
      });
      
      wasRunning.current = true;
      
      // Switch to the Run tab to show progress
      setActiveTab(0);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setLoading(false);
    }
  };

  // Run migration / dry-run for a single table (from the per-table accordion)
  const runMigrationForTable = async (targetTable: string, dryRun: boolean) => {
    const mapping = migrationMappings.find((m) => (m.targetTables[0] || '') === targetTable);
    if (!mapping) {
      setError(`No mapping found for table ${targetTable}`);
      return;
    }
    setPerTableActive(targetTable);
    setError(null);
    dispatch(setSelectedResult(null));
    hasSelectedResult.current = false;
    try {
      const endpoint = dryRun ? '/migrate/dry-run' : '/migrate';
      const serverMappings = transformMappingForServer([mapping]);
      const requestBody = {
        useCopy,
        sourceDbType,
        targetDbType,
        force: forceReTransfer,
        ...(encryptionKey ? { encryptionKey } : {}),
        mappingConfig: { tableMappings: serverMappings },
      };
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Migration failed');
      if (data.jobId) setActiveJobId(data.jobId);
      setMigrationStatus({
        running: true,
        progress: 0,
        currentTable: `${dryRun ? 'Dry run' : 'Migrating'}: ${targetTable}`,
        results: [],
      });
      wasRunning.current = true;
      setActiveTab(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setPerTableActive(null);
    }
  };

  // Poll one table's job until it finishes (used by the sequential runner).
  const waitForJob = (jobId: string) =>
    new Promise<void>((resolve) => {
      const started = Date.now();
      const poll = async () => {
        if (sequenceCancel.current) return resolve();
        try {
          const res = await fetch(`${API_BASE}/migration/${jobId}/state`);
          const data = await res.json();
          if (['completed', 'failed', 'not_found'].includes(data.state)) return resolve();
        } catch {
          /* transient — keep polling */
        }
        if (Date.now() - started > 1000 * 60 * 60) return resolve(); // 1h safety cap
        window.setTimeout(poll, 1500);
      };
      poll();
    });

  // Migrate mapped tables one at a time, in FK-dependency order, in one click.
  // onlyPending=true skips tables already marked "done" (transfer just the remaining ones).
  const migrateAllSequential = async (onlyPending = false) => {
    let ordered: string[] = [];
    try {
      const res = await fetch(`${API_BASE}/ddl-order/source`);
      const data = await res.json();
      const flat: string[] = res.ok && Array.isArray(data.flat) ? data.flat : [];
      const mapped = new Set(tableMappings.map((m) => m.targetTables[0] || ''));
      ordered = flat.filter((t) => mapped.has(t));
    } catch {
      /* fall back to mapping order below */
    }
    // Append any mapped tables the dependency order didn't include.
    for (const m of tableMappings) {
      const t = m.targetTables[0] || '';
      if (t && !ordered.includes(t)) ordered.push(t);
    }

    // Drop tables already transferred when only the pending ones were requested.
    if (onlyPending) {
      try {
        const sres = await fetch(`${API_BASE}/table-status`);
        const sdata = await sres.json();
        const statuses = sdata.tables || {};
        ordered = ordered.filter((t) => statuses[t]?.status !== 'done');
      } catch {
        /* status unavailable — proceed with all tables */
      }
    }

    if (ordered.length === 0) {
      setError(onlyPending ? 'No pending tables — everything is already transferred.' : 'No tables to migrate');
      return;
    }

    sequenceCancel.current = false;
    setError(null);
    setActiveTab(0);
    for (let i = 0; i < ordered.length; i++) {
      if (sequenceCancel.current) break;
      const targetTable = ordered[i];
      const mapping = migrationMappings.find((m) => (m.targetTables[0] || '') === targetTable);
      if (!mapping) continue;
      setSequence({ running: true, index: i + 1, total: ordered.length, currentTable: targetTable });
      try {
        const serverMappings = transformMappingForServer([mapping]);
        const res = await fetch(`${API_BASE}/migrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            useCopy,
            sourceDbType,
            targetDbType,
            force: forceReTransfer,
            ...(encryptionKey ? { encryptionKey } : {}),
            mappingConfig: { tableMappings: serverMappings },
          }),
        });
        const data = await res.json();
        if (res.ok && data.jobId) {
          setActiveJobId(data.jobId);
          await waitForJob(data.jobId);
        }
      } catch {
        /* keep going to the next table */
      }
    }
    setSequence(null);
    getResults();
  };

  const stopSequence = () => {
    sequenceCancel.current = true;
    setSequence(null);
  };

  // Create tables only (no data migration)
  const createTablesFirst = async () => {
    setCreateTablesLoading(true);
    setError(null);
    setCreateTablesSnackbar(prev => ({ ...prev, open: false }));
    try {
      let mappingsToUse = migrationMappings;
      if (tableWiseMode && selectedTables.size > 0) {
        mappingsToUse = migrationMappings.filter(m => {
          const targetTable = m.targetTables[0] || '';
          return selectedTables.has(targetTable);
        });
      }
      if (mappingsToUse.length === 0) {
        setCreateTablesSnackbar({ open: true, message: 'No table mappings. Add mappings or select tables.', severity: 'error' });
        return;
      }
      const serverMappings = transformMappingForServer(mappingsToUse);
      const requestBody: any = {
        mappingConfig: { tableMappings: serverMappings },
      };

      const res = await fetch(`${API_BASE}/tables/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateTablesSnackbar({ open: true, message: data.error || 'Failed to create tables', severity: 'error' });
        return;
      }
      const created = data.created?.length ?? 0;
      const existed = data.existed?.length ?? 0;
      const errs = data.errors?.length ?? 0;
      let msg = `Created ${created} table(s), ${existed} already existed.`;
      if (errs > 0) msg += ` ${errs} error(s).`;
      setCreateTablesSnackbar({ open: true, message: msg, severity: errs > 0 ? 'info' : 'success' });
      if (targetConnection?.success) testConnections(true);
    } catch (err) {
      setCreateTablesSnackbar({ open: true, message: err instanceof Error ? err.message : 'Failed to create tables', severity: 'error' });
    } finally {
      setCreateTablesLoading(false);
    }
  };

  // DDL check: compare structure of selected tables in source vs target
  const runDdlCheck = async () => {
    let mappingsToCheck = migrationMappings;
    if (tableWiseMode && selectedTables.size > 0) {
      mappingsToCheck = migrationMappings.filter(m => {
        const targetTable = m.targetTables[0] || '';
        return selectedTables.has(targetTable);
      });
    }
    if (mappingsToCheck.length === 0) {
      setError('No tables selected. Add mappings or select tables for DDL check.');
      return;
    }
    setDdlCheckLoading(true);
    setError(null);
    try {
      const body = {
        tableMappings: mappingsToCheck.map(m => ({
          sourceTable: m.sourceTables[0] || '',
          targetTable: m.targetTables[0] || '',
        })),
      };
      const res = await fetch(`${API_BASE}/ddl-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'DDL check failed');
        return;
      }
      setDdlCheckResults(data.results ?? []);
      setDdlCheckDialog(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DDL check failed');
    } finally {
      setDdlCheckLoading(false);
    }
  };

  // REMOVED: an effect here used to POST the whole mapping config to
  // /api/mapping/config on every change to `tableMappings` — i.e. once per
  // keystroke in any mapping field. That endpoint writes
  // src/data/mappingConfig.json, a git-tracked source file, so simply having
  // this page open rewrote the repository's own data (it grew from 127 to 135
  // table mappings that way).
  //
  // It is no longer needed for any purpose: the mapping config travels in the
  // migration request itself, and configurations are now stored in the
  // metadata database with version history. The endpoint still exists for
  // backward compatibility, but nothing in the app calls it.

  // Initial load - only runs once
  useEffect(() => {
    const init = async () => {
      const online = await checkServer();
      if (online) {
        await Promise.all([testConnections(), getResults(), getStatus()]);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling effect - only polls when migration is running or server is offline
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    
    if (serverOnline && migrationStatus?.running) {
      // Poll frequently during migration
      interval = setInterval(() => {
        getStatus();
      }, 1000);
    } else if (!serverOnline) {
      // Check server occasionally
      interval = setInterval(() => {
        checkServer();
      }, 5000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [serverOnline, migrationStatus?.running, getStatus, checkServer]);
  
  // Refresh results when migration completes
  useEffect(() => {
    // Check if migration just completed (was running, now not running)
    if (wasRunning.current && migrationStatus && !migrationStatus.running) {
      // Migration just completed - refresh all data
      console.log('Migration completed - refreshing data...');
      
      // Reset the selected result to auto-select new one
      hasSelectedResult.current = false;
      
      // Refresh results and connections
      getResults();
      testConnections(true);
    }
    
    // Track if migration is running
    wasRunning.current = migrationStatus?.running || false;
  }, [migrationStatus?.running, getResults, testConnections]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <SuccessIcon color="success" fontSize="small" />;
      case 'partial': return <WarningIcon color="warning" fontSize="small" />;
      case 'failed': return <ErrorIcon color="error" fontSize="small" />;
      default: return null;
    }
  };

  // Color palette for consistent styling
  const colors = {
    bg: {
      primary: '#0f172a',      // Dark blue-gray
      secondary: '#1e293b',    // Lighter blue-gray
      card: '#1e3a5f',         // Card background
      cardHover: '#234b73',    // Card hover
    },
    accent: {
      primary: '#38bdf8',      // Sky blue
      secondary: '#a78bfa',    // Purple
      success: '#4ade80',      // Green
      warning: '#fbbf24',      // Amber
      error: '#f87171',        // Red
      info: '#60a5fa',         // Blue
    },
    text: {
      primary: '#f1f5f9',      // Almost white
      secondary: '#94a3b8',    // Gray
      muted: '#64748b',        // Darker gray
    },
    border: '#334155',         // Border color
  };

  if (!serverOnline) {
    return (
      <Box sx={{ p: 4, bgcolor: colors.bg.primary, minHeight: '100vh' }}>
        <Card sx={{ 
          bgcolor: colors.bg.secondary, 
          border: `1px solid ${colors.accent.warning}`,
          maxWidth: 600,
          mx: 'auto',
          mt: 4,
        }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <WarningIcon sx={{ color: colors.accent.warning, fontSize: 40 }} />
              <Typography variant="h5" sx={{ color: colors.text.primary, fontWeight: 600 }}>
                Migration Server Not Running
              </Typography>
            </Box>
            <Typography variant="body1" sx={{ color: colors.text.secondary, mb: 3 }}>
              Start the migration server to use this feature:
            </Typography>
            <Box 
              component="pre" 
              sx={{ 
                bgcolor: colors.bg.primary, 
                color: colors.accent.primary, 
                p: 2.5, 
                borderRadius: 2,
                fontFamily: 'monospace',
                fontSize: 14,
                border: `1px solid ${colors.border}`,
                mb: 3,
              }}
            >
              npm run migrate:server
            </Box>
            <Button 
              variant="contained"
              size="large"
              startIcon={<RefreshIcon />} 
              onClick={checkServer}
              sx={{ 
                bgcolor: colors.accent.primary,
                color: colors.bg.primary,
                fontWeight: 600,
                '&:hover': { bgcolor: '#0ea5e9' },
              }}
            >
              Check Connection
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column',
      height: '100%', 
      bgcolor: colors.bg.primary,
      overflow: 'hidden',
    }}>
      {/* Header - Fixed at top */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        p: 3,
        pb: 2,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        <Box>
          <Typography variant="h4" sx={{ color: colors.text.primary, fontWeight: 700, mb: 0.5 }}>
            🚀 Database Migration
          </Typography>
          <Typography variant="body1" sx={{ color: colors.text.secondary }}>
            Transfer data from source to target database
          </Typography>
        </Box>
        <Chip 
          icon={<ConnectedIcon sx={{ color: `${colors.accent.success} !important` }} />} 
          label="Server Online" 
          sx={{
            bgcolor: 'rgba(74, 222, 128, 0.15)',
            color: colors.accent.success,
            border: `1px solid ${colors.accent.success}`,
            fontWeight: 600,
            px: 1,
          }}
        />
      </Box>

      {/* Scrollable Content Area */}
      <Box sx={{ 
        flex: 1, 
        overflow: 'auto', 
        p: 3,
        '&::-webkit-scrollbar': { width: '8px' },
        '&::-webkit-scrollbar-track': { bgcolor: colors.bg.secondary, borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb': { bgcolor: colors.border, borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb:hover': { bgcolor: colors.text.muted },
      }}>
        {error && (
          <Alert 
            severity="error" 
            sx={{ 
              mb: 3, 
              bgcolor: 'rgba(248, 113, 113, 0.15)',
              color: colors.accent.error,
              border: `1px solid ${colors.accent.error}`,
              '& .MuiAlert-icon': { color: colors.accent.error },
            }} 
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {/* Connection Status Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ 
            bgcolor: colors.bg.secondary, 
            border: `1px solid ${colors.border}`,
            borderRadius: 3,
            transition: 'all 0.2s',
            '&:hover': { borderColor: colors.accent.primary },
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                <Box sx={{ 
                  bgcolor: 'rgba(56, 189, 248, 0.15)', 
                  p: 1.5, 
                  borderRadius: 2,
                  display: 'flex',
                }}>
                  <DatabaseIcon sx={{ color: colors.accent.primary, fontSize: 32 }} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="overline" sx={{ color: colors.text.muted, letterSpacing: 1 }}>
                    Source Database
                  </Typography>
                  <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 600, mt: 0.5 }}>
                    {sourceConnection?.success ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ConnectedIcon sx={{ color: colors.accent.success }} fontSize="small" />
                        <span>Connected</span>
                        <Chip 
                          label={`${sourceConnection.tables} tables`} 
                          size="small"
                          sx={{ 
                            bgcolor: 'rgba(56, 189, 248, 0.2)', 
                            color: colors.accent.primary,
                            fontWeight: 600,
                            ml: 1,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.3)' },
                          }}
                          onClick={() => fetchTables('source')}
                          icon={<ViewIcon sx={{ fontSize: 16 }} />}
                        />
                      </Box>
                    ) : sourceConnection ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: colors.accent.error }}>
                        <DisconnectedIcon fontSize="small" />
                        <span style={{ fontSize: 14 }}>{sourceConnection.message}</span>
                      </Box>
                    ) : (
                      <span style={{ color: colors.text.muted }}>Checking...</span>
                    )}
                  </Typography>
                </Box>
                {sourceConnection?.success && (
                  <Tooltip title="View all tables">
                    <IconButton 
                      onClick={() => fetchTables('source')}
                      sx={{ 
                        color: colors.accent.primary,
                        bgcolor: 'rgba(56, 189, 248, 0.1)',
                        '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.2)' },
                      }}
                    >
                      <ViewIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ 
            bgcolor: colors.bg.secondary, 
            border: `1px solid ${colors.border}`,
            borderRadius: 3,
            transition: 'all 0.2s',
            '&:hover': { borderColor: colors.accent.secondary },
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                <Box sx={{ 
                  bgcolor: 'rgba(167, 139, 250, 0.15)', 
                  p: 1.5, 
                  borderRadius: 2,
                  display: 'flex',
                }}>
                  <DatabaseIcon sx={{ color: colors.accent.secondary, fontSize: 32 }} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="overline" sx={{ color: colors.text.muted, letterSpacing: 1 }}>
                    Target Database
                  </Typography>
                  <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 600, mt: 0.5 }}>
                    {targetConnection?.success ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ConnectedIcon sx={{ color: colors.accent.success }} fontSize="small" />
                        <span>Connected</span>
                        <Chip 
                          label={`${targetConnection.tables} tables`} 
                          size="small"
                          sx={{ 
                            bgcolor: 'rgba(167, 139, 250, 0.2)', 
                            color: colors.accent.secondary,
                            fontWeight: 600,
                            ml: 1,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(167, 139, 250, 0.3)' },
                          }}
                          onClick={() => fetchTables('target')}
                          icon={<ViewIcon sx={{ fontSize: 16 }} />}
                        />
                      </Box>
                    ) : targetConnection ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: colors.accent.error }}>
                        <DisconnectedIcon fontSize="small" />
                        <span style={{ fontSize: 14 }}>{targetConnection.message}</span>
                      </Box>
                    ) : (
                      <span style={{ color: colors.text.muted }}>Checking...</span>
                    )}
                  </Typography>
                </Box>
                {targetConnection?.success && (
                  <Tooltip title="View all tables">
                    <IconButton 
                      onClick={() => fetchTables('target')}
                      sx={{ 
                        color: colors.accent.secondary,
                        bgcolor: 'rgba(167, 139, 250, 0.1)',
                        '&:hover': { bgcolor: 'rgba(167, 139, 250, 0.2)' },
                      }}
                    >
                      <ViewIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Real-time Queue Performance Dashboard */}
      {migrationStatus?.running && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ bgcolor: colors.bg.secondary, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ bgcolor: 'rgba(56, 189, 248, 0.15)', p: 1, borderRadius: 2, display: 'flex' }}>
                    <SpeedIcon sx={{ color: colors.accent.primary, fontSize: 24 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>Throughput</Typography>
                    <Typography variant="body1" sx={{ color: colors.text.primary, fontWeight: 700 }}>
                      {throughput.toLocaleString()} rows/sec
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ bgcolor: colors.bg.secondary, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ bgcolor: 'rgba(251, 191, 36, 0.15)', p: 1, borderRadius: 2, display: 'flex' }}>
                    <TimeIcon sx={{ color: colors.accent.warning, fontSize: 24 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>ETA</Typography>
                    <Typography variant="body1" sx={{ color: colors.text.primary, fontWeight: 700 }}>
                      {eta > 0 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : 'Calculating...'}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ bgcolor: colors.bg.secondary, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ bgcolor: 'rgba(248, 113, 113, 0.15)', p: 1, borderRadius: 2, display: 'flex' }}>
                    <ErrorIcon sx={{ color: colors.accent.error, fontSize: 24 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>Failed Records</Typography>
                    <Typography variant="body1" sx={{ color: colors.text.primary, fontWeight: 700 }}>
                      {failedRows.toLocaleString()} rows
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ bgcolor: colors.bg.secondary, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ bgcolor: 'rgba(167, 139, 250, 0.15)', p: 1, borderRadius: 2, display: 'flex' }}>
                    <DatabaseIcon sx={{ color: colors.accent.secondary, fontSize: 24 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>Heap Memory</Typography>
                    <Typography variant="body1" sx={{ color: colors.text.primary, fontWeight: 700 }}>
                      {memoryUsage.toFixed(1)} MB
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Encryption key — used only for columns flagged "Encrypt"; not saved anywhere. */}
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          type="password"
          label="Encryption key (for columns flagged 🔒 Encrypt)"
          placeholder="Enter passphrase — required if any column is marked Encrypt"
          value={encryptionKey}
          onChange={(e) => setEncryptionKey(e.target.value)}
          autoComplete="off"
          helperText="AES-256-CBC. Kept in memory only (not stored in mappings/localStorage). Sent with the migrate request."
        />
      </Box>

      {/* Pipeline settings: source/target dialect, force/reset, per-table dedup + transfer status */}
      <MigrationExtrasPanel
        colors={colors}
        apiBase={API_BASE}
        sourceDbType={sourceDbType}
        targetDbType={targetDbType}
        onSourceDbTypeChange={setSourceDbType}
        onTargetDbTypeChange={setTargetDbType}
        forceReTransfer={forceReTransfer}
        onForceChange={setForceReTransfer}
        activeJobId={activeJobId}
        running={migrationStatus?.running ?? false}
        onMigrateTable={runMigrationForTable}
        migratingTable={perTableActive}
        onMigrateAllSequential={() => migrateAllSequential(false)}
        onMigratePending={() => migrateAllSequential(true)}
        onStopSequence={stopSequence}
        sequence={sequence}
      />

      {/* Migration Controls */}
      <Card sx={{
        bgcolor: colors.bg.secondary,
        border: `1px solid ${colors.border}`,
        mb: 4,
        borderRadius: 3,
      }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ color: colors.text.primary, fontWeight: 600, mb: 2 }}>
            Migration Controls
          </Typography>
          
          {/* Options block */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box sx={{ p: 2, bgcolor: colors.bg.primary, borderRadius: 2, border: `1px solid ${colors.border}`, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: tableWiseMode ? 1.5 : 0 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={tableWiseMode}
                        onChange={(e) => {
                          setTableWiseMode(e.target.checked);
                          if (!e.target.checked) {
                            setSelectedTables(new Set());
                          }
                        }}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': { color: colors.accent.primary },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: colors.accent.primary },
                        }}
                      />
                    }
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FilterListIcon sx={{ color: colors.accent.primary, fontSize: 20 }} />
                        <Typography variant="body2" sx={{ color: colors.text.primary, fontWeight: 600 }}>
                          Table-wise Migration
                        </Typography>
                      </Box>
                    }
                  />
                  {tableWiseMode && (
                    <Chip
                      label={`${selectedTables.size} of ${tableMappings.length} selected`}
                      size="small"
                      sx={{
                        bgcolor: selectedTables.size > 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                        color: selectedTables.size > 0 ? colors.accent.primary : colors.text.muted,
                        border: `1px solid ${selectedTables.size > 0 ? colors.accent.primary : colors.border}`,
                        fontWeight: 600,
                      }}
                    />
                  )}
                </Box>
                {tableWiseMode && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<TableIcon />}
                      onClick={openTableSelection}
                      sx={{
                        borderColor: colors.accent.primary,
                        color: colors.accent.primary,
                        fontWeight: 600,
                        '&:hover': {
                          borderColor: colors.accent.primary,
                          bgcolor: 'rgba(56, 189, 248, 0.1)',
                        },
                      }}
                    >
                      Select Tables
                    </Button>
                    {selectedTables.size > 0 && (
                      <>
                        <Button
                          variant="text"
                          size="small"
                          onClick={handleSelectAllTables}
                          sx={{ color: colors.text.secondary, fontWeight: 500, '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.1)' } }}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="text"
                          size="small"
                          onClick={handleDeselectAllTables}
                          sx={{ color: colors.text.secondary, fontWeight: 500, '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.1)' } }}
                        >
                          Clear All
                        </Button>
                      </>
                    )}
                  </Box>
                )}
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box sx={{ p: 2, bgcolor: colors.bg.primary, borderRadius: 2, border: `1px solid ${colors.border}`, height: '100%', display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={useCopy}
                      onChange={(e) => setUseCopy(e.target.checked)}
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': { color: colors.accent.primary },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: colors.accent.primary },
                      }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ color: colors.text.primary, fontWeight: 600 }}>
                        PostgreSQL COPY Mode
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>
                        Low memory footprint fast streaming inserts (recommened for large tables)
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            </Grid>
          </Grid>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            {!migrationStatus?.running ? (
              <>
                <Tooltip title="Create missing target tables from schema (no data transfer)">
                  <span>
                    <Button
                      variant="outlined"
                      size="large"
                      startIcon={createTablesLoading ? <CircularProgress size={20} sx={{ color: colors.accent.secondary }} /> : <TableIcon />}
                      onClick={createTablesFirst}
                      disabled={createTablesLoading || !targetConnection?.success || tableMappings.length === 0 || (tableWiseMode && selectedTables.size === 0)}
                      sx={{
                        borderColor: colors.accent.secondary,
                        color: colors.accent.secondary,
                        fontWeight: 600,
                        px: 3,
                        '&:hover': { borderColor: colors.accent.secondary, bgcolor: 'rgba(167, 139, 250, 0.1)' },
                        '&:disabled': { borderColor: colors.text.muted, color: colors.text.muted },
                      }}
                    >
                      Create tables first
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Compare table structure (columns, PK, FK) between source and target for selected tables">
                  <span>
                    <Button
                      variant="outlined"
                      size="large"
                      startIcon={ddlCheckLoading ? <CircularProgress size={20} sx={{ color: colors.accent.warning }} /> : <CompareArrowsIcon />}
                      onClick={runDdlCheck}
                      disabled={ddlCheckLoading || !sourceConnection?.success || !targetConnection?.success || tableMappings.length === 0 || (tableWiseMode && selectedTables.size === 0)}
                      sx={{
                        borderColor: colors.accent.warning ?? '#f59e0b',
                        color: colors.accent.warning ?? '#f59e0b',
                        fontWeight: 600,
                        px: 3,
                        '&:hover': { borderColor: colors.accent.warning ?? '#f59e0b', bgcolor: 'rgba(245, 158, 11, 0.1)' },
                        '&:disabled': { borderColor: colors.text.muted, color: colors.text.muted },
                      }}
                    >
                      DDL Check
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<SpeedIcon />}
                  onClick={() => runMigration(true)}
                  disabled={loading || !sourceConnection?.success || (tableWiseMode && selectedTables.size === 0)}
                  sx={{ 
                    borderColor: colors.accent.info, 
                    color: colors.accent.info,
                    fontWeight: 600,
                    px: 3,
                    '&:hover': { borderColor: colors.accent.info, bgcolor: 'rgba(96, 165, 250, 0.1)' },
                    '&:disabled': { borderColor: colors.text.muted, color: colors.text.muted },
                  }}
                >
                  Dry Run
                </Button>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayIcon />}
                  onClick={() => runMigration(false)}
                  disabled={loading || !sourceConnection?.success || !targetConnection?.success || (tableWiseMode && selectedTables.size === 0)}
                  sx={{ 
                    bgcolor: colors.accent.success, 
                    color: colors.bg.primary,
                    fontWeight: 600,
                    px: 3,
                    '&:hover': { bgcolor: '#22c55e' },
                    '&:disabled': { bgcolor: colors.text.muted, color: colors.bg.primary },
                  }}
                >
                  Run Migration
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={isPaused ? <PlayIcon /> : <PauseIcon />}
                  onClick={isPaused ? resumeMigration : pauseMigration}
                  sx={{
                    borderColor: colors.accent.warning,
                    color: colors.accent.warning,
                    fontWeight: 600,
                    px: 3,
                    '&:hover': { borderColor: colors.accent.warning, bgcolor: 'rgba(251, 191, 36, 0.1)' },
                  }}
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<StopIcon />}
                  onClick={cancelMigration}
                  sx={{
                    bgcolor: colors.accent.error,
                    color: 'white',
                    fontWeight: 600,
                    px: 3,
                    '&:hover': { bgcolor: '#ef4444' },
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
            
            {activeJobId && (
              <Button
                variant="outlined"
                size="large"
                startIcon={<DownloadIcon />}
                onClick={exportCsvReport}
                sx={{
                  borderColor: colors.accent.primary,
                  color: colors.accent.primary,
                  fontWeight: 600,
                  px: 3,
                  '&:hover': { borderColor: colors.accent.primary, bgcolor: 'rgba(56, 189, 248, 0.1)' },
                }}
              >
                Export CSV Report
              </Button>
            )}

            <Tooltip title="Refresh connections">
              <IconButton 
                onClick={() => { testConnections(true); getResults(); }} 
                sx={{ 
                  color: colors.text.secondary,
                  '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.1)' },
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            
            {/* Migration Status - Always Visible */}
            <Box sx={{ flex: 1, minWidth: 300 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ color: colors.text.secondary }}>
                  {migrationStatus?.running ? (
                    <>
                      {isPaused ? '⏸️ Paused: ' : '🔄 Migrating: '}
                      <span style={{ color: colors.accent.primary, fontWeight: 600 }}>{migrationStatus.currentTable}</span>
                    </>
                  ) : recentResults.length > 0 ? (
                    <>
                      ✅ Last run: <span style={{ color: colors.accent.success, fontWeight: 600 }}>
                        {recentResults[0]?.totalSuccess} rows migrated
                      </span>
                    </>
                  ) : (
                    <>
                      ⏸️ Status: <span style={{ color: colors.text.muted, fontWeight: 600 }}>Ready to migrate</span>
                    </>
                  )}
                </Typography>
                <Typography variant="body2" sx={{ 
                  color: migrationStatus?.running ? colors.accent.primary : colors.accent.success, 
                  fontWeight: 700 
                }}>
                  {migrationStatus?.running ? `${migrationStatus.progress}%` : (recentResults.length > 0 ? 'Complete' : 'Idle')}
                </Typography>
              </Box>
              <LinearProgress 
                variant="determinate" 
                value={migrationStatus?.running ? migrationStatus.progress : (recentResults.length > 0 ? 100 : 0)} 
                sx={{ 
                  height: 10, 
                  borderRadius: 5,
                  bgcolor: 'rgba(56, 189, 248, 0.2)',
                  '& .MuiLinearProgress-bar': { 
                    bgcolor: migrationStatus?.running 
                      ? colors.accent.primary 
                      : (recentResults.length > 0 ? colors.accent.success : colors.text.muted),
                    borderRadius: 5,
                    transition: 'all 0.3s ease',
                  },
                }}
              />
              {/* Show last migration time if available */}
              {!migrationStatus?.running && recentResults.length > 0 && (
                <Typography variant="caption" sx={{ color: colors.text.muted, mt: 0.5, display: 'block' }}>
                  {new Date(recentResults[0].timestamp).toLocaleString()}
                </Typography>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: colors.border, mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, v) => {
            setActiveTab(v);
            // Refresh data when switching tabs
            if (v === 1) {
              // History tab - refresh results
              getResults();
            } else {
              // Run tab - refresh status
              getStatus();
            }
          }}
          sx={{
            '& .MuiTab-root': { 
              color: colors.text.muted,
              fontWeight: 600,
              textTransform: 'none',
              fontSize: 15,
            },
            '& .Mui-selected': { color: colors.accent.primary },
            '& .MuiTabs-indicator': { bgcolor: colors.accent.primary, height: 3, borderRadius: 2 },
          }}
        >
          <Tab label="Live Results" />
          <Tab label="History" />
        </Tabs>
      </Box>

      {/* Live Results Tab */}
      {activeTab === 0 && (
        <Box>
          {/* Show current migration results OR last migration results */}
          {(migrationStatus?.results && migrationStatus.results.length > 0) || (recentResults.length > 0 && recentResults[0]?.results) ? (
            (() => {
              // Get results to display
              const resultsToShow = migrationStatus?.results && migrationStatus.results.length > 0 
                ? migrationStatus.results 
                : recentResults[0]?.results || [];
              
              // Group results by level
              const groupedByLevel = resultsToShow.reduce((acc, result) => {
                const level = result.level ?? 0;
                if (!acc[level]) acc[level] = [];
                acc[level].push(result);
                return acc;
              }, {} as Record<number, TableResult[]>);
              
              const levels = Object.keys(groupedByLevel).map(Number).sort((a, b) => a - b);
              
              // Calculate level stats
              const getLevelStats = (results: TableResult[]) => ({
                tables: results.length,
                totalRows: results.reduce((sum, r) => sum + r.totalRows, 0),
                successRows: results.reduce((sum, r) => sum + r.successRows, 0),
                failedRows: results.reduce((sum, r) => sum + r.failedRows, 0),
                skippedRows: results.reduce((sum, r) => sum + (r.skippedRows || 0), 0),
                duration: results.reduce((sum, r) => sum + r.duration, 0),
                hasErrors: results.some(r => r.errors?.length > 0),
                allSuccess: results.every(r => r.status === 'success' || r.status === 'skipped'),
              });

              return (
                <>
                  {/* Header showing which results we're displaying */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                    <Typography variant="subtitle1" sx={{ color: colors.text.secondary, fontWeight: 600 }}>
                      {migrationStatus?.running ? (
                        <>🔄 Live Migration Progress</>
                      ) : migrationStatus?.results && migrationStatus.results.length > 0 ? (
                        <>✅ Migration Completed</>
                      ) : (
                        <>📋 Last Migration Results ({recentResults[0] && new Date(recentResults[0].timestamp).toLocaleString()})</>
                      )}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Chip 
                        label={`${levels.length} Levels`}
                        size="small"
                        sx={{ bgcolor: colors.bg.card, color: colors.text.secondary, border: `1px solid ${colors.border}` }}
                      />
                      <Chip 
                        label={`${resultsToShow.length} Tables`}
                        size="small"
                        sx={{ bgcolor: colors.bg.card, color: colors.text.secondary, border: `1px solid ${colors.border}` }}
                      />
                      {!migrationStatus?.running && recentResults[0] && (
                        <Chip 
                          label={recentResults[0]?.dryRun ? 'Dry Run' : 'Migration'}
                          size="small"
                          sx={{ 
                            bgcolor: recentResults[0]?.dryRun ? 'rgba(96, 165, 250, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                            color: recentResults[0]?.dryRun ? colors.accent.info : colors.accent.success,
                            border: `1px solid ${recentResults[0]?.dryRun ? colors.accent.info : colors.accent.success}`,
                            fontWeight: 600,
                          }}
                        />
                      )}
                    </Box>
                  </Box>

                  {/* Level Accordions */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {levels.map((level) => {
                      const levelResults = groupedByLevel[level];
                      const stats = getLevelStats(levelResults);
                      
                      return (
                        <Accordion
                          key={level}
                          defaultExpanded={level === 0}
                          sx={{
                            bgcolor: colors.bg.secondary,
                            border: `1px solid ${stats.hasErrors ? colors.accent.error : stats.allSuccess ? colors.accent.success : colors.border}`,
                            borderRadius: 2,
                            overflow: 'hidden',
                            '&:before': {
                              display: 'none',
                            },
                            '&.Mui-expanded': {
                              margin: 0,
                            },
                          }}
                        >
                          <AccordionSummary
                            expandIcon={<ExpandMoreIcon sx={{ color: colors.text.secondary }} />}
                            sx={{
                              px: 3,
                              py: 2,
                              bgcolor: stats.hasErrors 
                                ? 'rgba(248, 113, 113, 0.1)' 
                                : stats.allSuccess 
                                  ? 'rgba(74, 222, 128, 0.1)' 
                                  : colors.bg.card,
                              borderBottom: `1px solid ${colors.border}`,
                              '&:hover': {
                                bgcolor: stats.hasErrors 
                                  ? 'rgba(248, 113, 113, 0.15)' 
                                  : stats.allSuccess 
                                    ? 'rgba(74, 222, 128, 0.15)' 
                                    : colors.bg.cardHover,
                              },
                              '&.Mui-expanded': {
                                borderBottom: `1px solid ${colors.border}`,
                              },
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', pr: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Chip 
                                  label={`Level ${level + 1}`}
                                  sx={{ 
                                    bgcolor: colors.accent.primary,
                                    color: 'white',
                                    fontWeight: 700,
                                    fontSize: '0.9rem',
                                  }}
                                />
                                <Typography sx={{ color: colors.text.secondary, fontWeight: 500 }}>
                                  {stats.tables} table{stats.tables !== 1 ? 's' : ''}
                                </Typography>
                              </Box>
                              
                              {/* Level Stats Summary */}
                              <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                <Box sx={{ textAlign: 'center' }}>
                                  <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 700, lineHeight: 1 }}>
                                    {stats.totalRows.toLocaleString()}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: colors.text.muted }}>Total Rows</Typography>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                  <Typography variant="h6" sx={{ color: colors.accent.success, fontWeight: 700, lineHeight: 1 }}>
                                    {stats.successRows.toLocaleString()}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: colors.text.muted }}>Success</Typography>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                  <Typography variant="h6" sx={{ color: stats.failedRows > 0 ? colors.accent.error : colors.text.muted, fontWeight: 700, lineHeight: 1 }}>
                                    {stats.failedRows.toLocaleString()}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: colors.text.muted }}>Failed</Typography>
                                </Box>
                                {stats.skippedRows > 0 && (
                                  <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h6" sx={{ color: colors.accent.warning, fontWeight: 700, lineHeight: 1 }}>
                                      {stats.skippedRows.toLocaleString()}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: colors.text.muted }}>Skipped</Typography>
                                  </Box>
                                )}
                                <Box sx={{ textAlign: 'center' }}>
                                  <Typography variant="h6" sx={{ color: colors.accent.info, fontWeight: 700, lineHeight: 1 }}>
                                    {formatDuration(stats.duration)}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: colors.text.muted }}>Duration</Typography>
                                </Box>
                              </Box>
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails sx={{ p: 0, bgcolor: colors.bg.secondary }}>
                            <TableContainer>
                              <Table size="small" stickyHeader>
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }}>Status</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }}>Source → Target</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }} align="right">Rows</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }} align="right">Success</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }} align="right">Failed</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }} align="right">Skipped</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }} align="right">Duration</TableCell>
                                    <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600, py: 1.5 }}>Messages</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {levelResults.map((result: TableResult, idx: number) => (
                                    <TableRow 
                                      key={idx}
                                      sx={{ 
                                        '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.05)' },
                                        bgcolor: result.status === 'failed' ? 'rgba(248, 113, 113, 0.08)' : 'transparent',
                                        borderBottom: `1px solid ${colors.border}`,
                                      }}
                                    >
                                      <TableCell sx={{ py: 1.5 }}>
                                        <Chip 
                                          icon={getStatusIcon(result.status) || undefined}
                                          label={result.status}
                                          size="small"
                                          sx={{
                                            bgcolor: result.status === 'success' ? 'rgba(74, 222, 128, 0.15)' :
                                                     result.status === 'partial' ? 'rgba(251, 191, 36, 0.15)' :
                                                     result.status === 'failed' ? 'rgba(248, 113, 113, 0.15)' :
                                                     result.status === 'skipped' ? 'rgba(148, 163, 184, 0.15)' : 'transparent',
                                            color: result.status === 'success' ? colors.accent.success :
                                                   result.status === 'partial' ? colors.accent.warning :
                                                   result.status === 'failed' ? colors.accent.error : colors.text.muted,
                                            border: `1px solid ${result.status === 'success' ? colors.accent.success :
                                                                 result.status === 'partial' ? colors.accent.warning :
                                                                 result.status === 'failed' ? colors.accent.error : colors.border}`,
                                            fontWeight: 600,
                                            textTransform: 'capitalize',
                                          }}
                                        />
                                      </TableCell>
                                      <TableCell sx={{ color: colors.text.primary, py: 1.5 }}>
                                        <span style={{ color: colors.accent.primary }}>{result.sourceTable}</span>
                                        <span style={{ color: colors.text.muted, margin: '0 8px' }}>→</span>
                                        <span style={{ color: colors.accent.secondary }}>{result.table}</span>
                                      </TableCell>
                                      <TableCell align="right" sx={{ color: colors.text.secondary, py: 1.5, fontWeight: 500 }}>
                                        {result.totalRows.toLocaleString()}
                                      </TableCell>
                                      <TableCell align="right" sx={{ color: colors.accent.success, py: 1.5, fontWeight: 600 }}>
                                        {result.successRows.toLocaleString()}
                                      </TableCell>
                                      <TableCell align="right" sx={{ color: result.failedRows > 0 ? colors.accent.error : colors.text.muted, py: 1.5, fontWeight: 600 }}>
                                        {result.failedRows.toLocaleString()}
                                      </TableCell>
                                      <TableCell align="right" sx={{ color: result.skippedRows && result.skippedRows > 0 ? colors.accent.warning : colors.text.muted, py: 1.5, fontWeight: 600 }}>
                                        {result.skippedRows ? result.skippedRows.toLocaleString() : '0'}
                                      </TableCell>
                                      <TableCell align="right" sx={{ color: colors.text.muted, py: 1.5 }}>
                                        {formatDuration(result.duration)}
                                      </TableCell>
                                      <TableCell sx={{ py: 1.5, maxWidth: 400 }}>
                                        <Box>
                                          {/* Show skipped rows details */}
                                          {result.skippedRows && result.skippedRows > 0 && result.skippedRowsDetails && result.skippedRowsDetails.length > 0 && (
                                            <Box sx={{ mb: result.errors && result.errors.length > 0 ? 1 : 0 }}>
                                              <Typography 
                                                variant="caption" 
                                                sx={{ 
                                                  color: colors.accent.warning, 
                                                  fontWeight: 600,
                                                  display: 'block',
                                                  mb: 0.5,
                                                }}
                                              >
                                                ⚠️ {result.skippedRows} row(s) skipped
                                              </Typography>
                                              <Tooltip 
                                                title={
                                                  <Box sx={{ maxWidth: 500 }}>
                                                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                                                      Skipped Rows Details ({result.skippedRowsDetails.length} shown):
                                                    </Typography>
                                                    {result.skippedRowsDetails.map((detail, i: number) => (
                                                      <Typography key={i} variant="caption" sx={{ display: 'block', mb: 0.5, wordBreak: 'break-word' }}>
                                                        {i + 1}. {detail.reason}
                                                      </Typography>
                                                    ))}
                                                    {result.skippedRows > result.skippedRowsDetails.length && (
                                                      <Typography variant="caption" sx={{ display: 'block', mt: 1, fontStyle: 'italic', color: colors.text.muted }}>
                                                        ... and {result.skippedRows - result.skippedRowsDetails.length} more
                                                      </Typography>
                                                    )}
                                                  </Box>
                                                }
                                                arrow
                                                placement="left"
                                              >
                                                <Chip 
                                                  label={`View ${result.skippedRowsDetails.length} skipped row${result.skippedRowsDetails.length !== 1 ? 's' : ''}`}
                                                  size="small"
                                                  sx={{
                                                    bgcolor: 'rgba(251, 191, 36, 0.15)',
                                                    color: colors.accent.warning,
                                                    border: `1px solid ${colors.accent.warning}`,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    fontSize: '0.7rem',
                                                  }}
                                                />
                                              </Tooltip>
                                            </Box>
                                          )}
                                          
                                          {/* Show errors */}
                                          {result.errors && result.errors.length > 0 ? (
                                            <Box>
                                              {/* Show primary error reason directly for failed tables */}
                                              {result.status === 'failed' && result.errors[0] && (
                                                <Typography 
                                                  variant="caption" 
                                                  sx={{ 
                                                    color: colors.accent.error, 
                                                    fontWeight: 600,
                                                    display: 'block',
                                                    mb: 0.5,
                                                    wordBreak: 'break-word',
                                                  }}
                                                >
                                                  ❌ {result.errors[0]}
                                                </Typography>
                                              )}
                                              
                                              {/* Show error count chip with tooltip for all errors */}
                                              <Tooltip 
                                                title={
                                                  <Box sx={{ maxWidth: 500 }}>
                                                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                                                      Error Details ({result.errors.length}):
                                                    </Typography>
                                                    {result.errors.map((err: string, i: number) => (
                                                      <Typography key={i} variant="caption" sx={{ display: 'block', mb: 0.5, wordBreak: 'break-word' }}>
                                                        {i + 1}. {err}
                                                      </Typography>
                                                    ))}
                                                  </Box>
                                                }
                                                arrow
                                                placement="left"
                                              >
                                                <Chip 
                                                  label={result.errors.length > 1 ? `${result.errors.length} errors` : 'View error'}
                                                  size="small"
                                                  sx={{
                                                    bgcolor: result.status === 'failed' 
                                                      ? 'rgba(248, 113, 113, 0.2)' 
                                                      : 'rgba(251, 191, 36, 0.15)',
                                                    color: result.status === 'failed' 
                                                      ? colors.accent.error 
                                                      : colors.accent.warning,
                                                    border: `1px solid ${result.status === 'failed' ? colors.accent.error : colors.accent.warning}`,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    fontSize: '0.7rem',
                                                  }}
                                                />
                                              </Tooltip>
                                            </Box>
                                          ) : result.status === 'skipped' ? (
                                            <Typography variant="caption" sx={{ color: colors.text.muted }}>
                                              ⏭️ No data to migrate
                                            </Typography>
                                          ) : !result.skippedRows || result.skippedRows === 0 ? (
                                            <Typography variant="caption" sx={{ color: colors.accent.success }}>
                                              ✓ OK
                                            </Typography>
                                          ) : null}
                                        </Box>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </AccordionDetails>
                        </Accordion>
                      );
                    })}
                  </Box>
                </>
              );
            })()
          ) : (
            <Card sx={{ 
              bgcolor: 'rgba(56, 189, 248, 0.1)', 
              border: `1px solid ${colors.accent.primary}`,
              borderRadius: 3,
            }}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
                <SpeedIcon sx={{ color: colors.accent.primary, fontSize: 32 }} />
                <Box>
                  <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 600 }}>
                    Ready to Migrate
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.text.secondary }}>
                    Click "Dry Run" to preview or "Run Migration" to start transferring data.
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          )}
        </Box>
      )}

      {/* History Tab */}
      {activeTab === 1 && (
        <Grid container spacing={3} sx={{ }}>
          <Grid size={{ xs: 12, md: 4 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="subtitle1" sx={{ color: colors.text.secondary, mb: 2, fontWeight: 600, flexShrink: 0 }}>
              Recent Migrations ({recentResults.length})
            </Typography>
            <Box sx={{ 
              flex: 1, 
              overflow: 'auto', 
              pr: 1,
              '&::-webkit-scrollbar': { width: '6px' },
              '&::-webkit-scrollbar-track': { bgcolor: colors.bg.secondary, borderRadius: '3px' },
              '&::-webkit-scrollbar-thumb': { bgcolor: colors.border, borderRadius: '3px' },
              '&::-webkit-scrollbar-thumb:hover': { bgcolor: colors.text.muted },
            }}>
              {recentResults.length === 0 ? (
                <Card sx={{ 
                  bgcolor: colors.bg.secondary, 
                  border: `1px solid ${colors.border}`,
                  borderRadius: 2,
                }}>
                  <CardContent sx={{ textAlign: 'center', py: 4 }}>
                    <Typography sx={{ color: colors.text.muted }}>No migration history</Typography>
                  </CardContent>
                </Card>
              ) : recentResults.map((result, idx) => (
              <Card 
                key={idx}
                onClick={() => dispatch(setSelectedResult(result))}
                sx={{ 
                  bgcolor: selectedResult === result ? colors.bg.card : colors.bg.secondary,
                  border: `1px solid ${selectedResult === result ? colors.accent.primary : colors.border}`,
                  mb: 1.5,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  borderRadius: 2,
                  '&:hover': { 
                    borderColor: colors.accent.primary,
                    bgcolor: colors.bg.card,
                  },
                }}
              >
                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Chip 
                        label={result.dryRun ? '🔍 Dry Run' : '🚀 Migration'}
                        size="small"
                        sx={{ 
                          mb: 1,
                          bgcolor: result.dryRun ? 'rgba(96, 165, 250, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                          color: result.dryRun ? colors.accent.info : colors.accent.success,
                          fontWeight: 600,
                          border: `1px solid ${result.dryRun ? colors.accent.info : colors.accent.success}`,
                        }}
                      />
                      <Typography variant="body2" sx={{ color: colors.text.muted }}>
                        {new Date(result.timestamp).toLocaleString()}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 700, lineHeight: 1.2, mb: 0.5 }}>
                        <span style={{ color: colors.accent.success }}>{result.totalSuccess}</span>
                        {' / '}
                        <span style={{ color: colors.accent.error }}>{result.totalFailed}</span>
                        {' / '}
                        <span style={{ color: colors.accent.warning }}>{result.totalSkipped || 0}</span>
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>
                        / {result.totalRows} rows
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.text.muted, fontSize: '0.65rem', display: 'block', mt: 0.5 }}>
                        Success / Failed / Skipped
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            ))}
            </Box>
          </Grid>
          
          <Grid size={{ xs: 12, md: 8 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selectedResult && (
              <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {/* Summary Cards */}
                <Grid container spacing={2} sx={{ mb: 3, flexShrink: 0 }}>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Card sx={{ 
                      bgcolor: colors.bg.secondary, 
                      border: `1px solid ${colors.border}`,
                      borderRadius: 2,
                    }}>
                      <CardContent sx={{ textAlign: 'center', py: 2.5 }}>
                        <Box sx={{ bgcolor: 'rgba(56, 189, 248, 0.15)', p: 1, borderRadius: 2, display: 'inline-flex', mb: 1 }}>
                          <TableIcon sx={{ color: colors.accent.primary, fontSize: 28 }} />
                        </Box>
                        <Typography variant="h4" sx={{ color: colors.text.primary, fontWeight: 700 }}>
                          {selectedResult.totalTables}
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.text.muted }}>
                          Total Tables
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Card sx={{ 
                      bgcolor: colors.bg.secondary, 
                      border: `1px solid ${colors.border}`,
                      borderRadius: 2,
                    }}>
                      <CardContent sx={{ textAlign: 'center', py: 2.5 }}>
                        <Box sx={{ bgcolor: 'rgba(74, 222, 128, 0.15)', p: 1, borderRadius: 2, display: 'inline-flex', mb: 1 }}>
                          <SuccessIcon sx={{ color: colors.accent.success, fontSize: 28 }} />
                        </Box>
                        <Typography variant="h4" sx={{ color: colors.accent.success, fontWeight: 700 }}>
                          {selectedResult.successTables}
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.text.muted }}>
                          Success Tables
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Card sx={{ 
                      bgcolor: colors.bg.secondary, 
                      border: `1px solid ${colors.border}`,
                      borderRadius: 2,
                    }}>
                      <CardContent sx={{ textAlign: 'center', py: 2.5 }}>
                        <Box sx={{ bgcolor: 'rgba(167, 139, 250, 0.15)', p: 1, borderRadius: 2, display: 'inline-flex', mb: 1 }}>
                          <RowIcon sx={{ color: colors.accent.secondary, fontSize: 28 }} />
                        </Box>
                        <Typography variant="h5" sx={{ color: colors.text.primary, fontWeight: 700, lineHeight: 1.2, mb: 0.5 }}>
                          <span style={{ color: colors.accent.success }}>{selectedResult.totalSuccess.toLocaleString()}</span>
                          {' / '}
                          <span style={{ color: colors.accent.error }}>{selectedResult.totalFailed.toLocaleString()}</span>
                          {' / '}
                          <span style={{ color: colors.accent.warning }}>{(selectedResult.totalSkipped || 0).toLocaleString()}</span>
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.text.muted, display: 'block' }}>
                          / {selectedResult.totalRows.toLocaleString()} rows
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.text.muted, fontSize: '0.65rem', display: 'block', mt: 0.5 }}>
                          Success / Failed / Skipped
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Card sx={{ 
                      bgcolor: colors.bg.secondary, 
                      border: `1px solid ${colors.border}`,
                      borderRadius: 2,
                    }}>
                      <CardContent sx={{ textAlign: 'center', py: 2.5 }}>
                        <Box sx={{ bgcolor: 'rgba(251, 191, 36, 0.15)', p: 1, borderRadius: 2, display: 'inline-flex', mb: 1 }}>
                          <TimeIcon sx={{ color: colors.accent.warning, fontSize: 28 }} />
                        </Box>
                        <Typography variant="h4" sx={{ color: colors.text.primary, fontWeight: 700 }}>
                          {formatDuration(selectedResult.duration)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.text.muted }}>
                          Duration
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                {/* Results Table */}
                <Card sx={{ 
                  bgcolor: colors.bg.secondary, 
                  border: `1px solid ${colors.border}`,
                  borderRadius: 2,
                  overflow: 'hidden',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}>
                  <CardContent sx={{ p: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <TableContainer sx={{ 
                      flex: 1,
                      overflow: 'auto',
                      '&::-webkit-scrollbar': { width: '6px', height: '6px' },
                      '&::-webkit-scrollbar-track': { bgcolor: colors.bg.secondary, borderRadius: '3px' },
                      '&::-webkit-scrollbar-thumb': { bgcolor: colors.border, borderRadius: '3px' },
                      '&::-webkit-scrollbar-thumb:hover': { bgcolor: colors.text.muted },
                    }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }}>Status</TableCell>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }}>Table</TableCell>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }} align="right">Total</TableCell>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }} align="right">Success</TableCell>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }} align="right">Failed</TableCell>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }} align="right">Skipped</TableCell>
                            <TableCell sx={{ bgcolor: colors.bg.primary, color: colors.text.secondary, fontWeight: 600 }}>Errors</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {selectedResult.results.map((result, idx) => (
                            <TableRow 
                              key={idx}
                              sx={{ 
                                bgcolor: result.status === 'failed' ? 'rgba(248, 113, 113, 0.08)' : 'transparent',
                                '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.05)' },
                                borderBottom: `1px solid ${colors.border}`,
                              }}
                            >
                              <TableCell sx={{ py: 1.5 }}>
                                {getStatusIcon(result.status)}
                              </TableCell>
                              <TableCell sx={{ color: colors.text.primary, py: 1.5, fontWeight: 500 }}>
                                {result.table}
                              </TableCell>
                              <TableCell align="right" sx={{ color: colors.text.secondary, py: 1.5 }}>
                                {result.totalRows}
                              </TableCell>
                              <TableCell align="right" sx={{ color: colors.accent.success, py: 1.5, fontWeight: 600 }}>
                                {result.successRows}
                              </TableCell>
                              <TableCell align="right" sx={{ color: result.failedRows > 0 ? colors.accent.error : colors.text.muted, py: 1.5, fontWeight: 600 }}>
                                {result.failedRows}
                              </TableCell>
                              <TableCell align="right" sx={{ color: result.skippedRows && result.skippedRows > 0 ? colors.accent.warning : colors.text.muted, py: 1.5, fontWeight: 600 }}>
                                {result.skippedRows || 0}
                              </TableCell>
                              <TableCell sx={{ py: 1.5, maxWidth: 400 }}>
                                <Box>
                                  {/* Show skipped rows details */}
                                  {result.skippedRows && result.skippedRows > 0 && result.skippedRowsDetails && result.skippedRowsDetails.length > 0 && (
                                    <Box sx={{ mb: result.errors && result.errors.length > 0 ? 1 : 0 }}>
                                      <Typography 
                                        variant="caption" 
                                        sx={{ 
                                          color: colors.accent.warning, 
                                          fontWeight: 600,
                                          display: 'block',
                                          mb: 0.5,
                                        }}
                                      >
                                        ⚠️ {result.skippedRows} row(s) skipped
                                      </Typography>
                                      <Tooltip 
                                        title={
                                          <Box sx={{ maxWidth: 500 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                                              Skipped Rows Details ({result.skippedRowsDetails.length} shown):
                                            </Typography>
                                            {result.skippedRowsDetails.map((detail, i: number) => (
                                              <Typography key={i} variant="caption" sx={{ display: 'block', mb: 0.5, wordBreak: 'break-word' }}>
                                                {i + 1}. {detail.reason}
                                              </Typography>
                                            ))}
                                            {result.skippedRows > result.skippedRowsDetails.length && (
                                              <Typography variant="caption" sx={{ display: 'block', mt: 1, fontStyle: 'italic', color: colors.text.muted }}>
                                                ... and {result.skippedRows - result.skippedRowsDetails.length} more
                                              </Typography>
                                            )}
                                          </Box>
                                        }
                                        arrow
                                        placement="left"
                                      >
                                        <Chip 
                                          label={`View ${result.skippedRowsDetails.length} skipped row${result.skippedRowsDetails.length !== 1 ? 's' : ''}`}
                                          size="small"
                                          sx={{
                                            bgcolor: 'rgba(251, 191, 36, 0.15)',
                                            color: colors.accent.warning,
                                            border: `1px solid ${colors.accent.warning}`,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            fontSize: '0.7rem',
                                          }}
                                        />
                                      </Tooltip>
                                    </Box>
                                  )}
                                  
                                  {/* Show errors */}
                                  {result.errors.length > 0 ? (
                                    <Box>
                                      {/* Show primary error reason directly for failed tables */}
                                      {result.status === 'failed' && result.errors[0] && (
                                        <Typography 
                                          variant="caption" 
                                          sx={{ 
                                            color: colors.accent.error, 
                                            fontWeight: 600,
                                            display: 'block',
                                            mb: 0.5,
                                            wordBreak: 'break-word',
                                          }}
                                        >
                                          ❌ {result.errors[0]}
                                        </Typography>
                                      )}
                                      
                                      {/* Show error count chip with tooltip for all errors */}
                                      <Tooltip 
                                        title={
                                          <Box sx={{ maxWidth: 500 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                                              Error Details ({result.errors.length}):
                                            </Typography>
                                            {result.errors.map((err: string, i: number) => (
                                              <Typography key={i} variant="caption" sx={{ display: 'block', mb: 0.5, wordBreak: 'break-word' }}>
                                                {i + 1}. {err}
                                              </Typography>
                                            ))}
                                          </Box>
                                        }
                                        arrow
                                        placement="left"
                                      >
                                        <Chip 
                                          label={result.errors.length > 1 ? `${result.errors.length} errors` : 'View error'}
                                          size="small"
                                          sx={{
                                            bgcolor: result.status === 'failed' 
                                              ? 'rgba(248, 113, 113, 0.2)' 
                                              : 'rgba(251, 191, 36, 0.15)',
                                            color: result.status === 'failed' 
                                              ? colors.accent.error 
                                              : colors.accent.warning,
                                            border: `1px solid ${result.status === 'failed' ? colors.accent.error : colors.accent.warning}`,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            fontSize: '0.7rem',
                                          }}
                                        />
                                      </Tooltip>
                                    </Box>
                                  ) : result.status === 'skipped' ? (
                                    <Typography variant="caption" sx={{ color: colors.text.muted }}>
                                      ⏭️ No data
                                    </Typography>
                                  ) : !result.skippedRows || result.skippedRows === 0 ? (
                                    <Typography variant="caption" sx={{ color: colors.accent.success }}>
                                      ✓ OK
                                    </Typography>
                                  ) : null}
                                </Box>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </CardContent>
                </Card>
              </Box>
            )}
          </Grid>
        </Grid>
      )}
      </Box>

      {/* Tables Modal */}
      <Dialog 
        open={tablesModal.open} 
        onClose={closeTablesModal}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: colors.bg.primary,
            backgroundImage: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: 3,
            maxHeight: '80vh',
          }
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          py: 2,
        }}>
          <Box sx={{ 
            bgcolor: tablesModal.type === 'source' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(167, 139, 250, 0.15)',
            p: 1,
            borderRadius: 2,
            display: 'flex',
          }}>
            <DatabaseIcon sx={{ 
              color: tablesModal.type === 'source' ? colors.accent.primary : colors.accent.secondary,
              fontSize: 28,
            }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 600 }}>
              {tablesModal.type === 'source' ? 'Source' : 'Target'} Database Tables
            </Typography>
            <Typography variant="body2" sx={{ color: colors.text.muted }}>
              {tablesModal.totalTables} tables • {tablesModal.totalRows.toLocaleString()} total rows
            </Typography>
          </Box>
          <IconButton onClick={closeTablesModal} sx={{ color: colors.text.muted }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ p: 0 }}>
          {tablesModal.loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 8 }}>
              <CircularProgress sx={{ color: colors.accent.primary }} />
            </Box>
          ) : (
            <>
              {/* Search */}
              <Box sx={{ p: 2, borderBottom: `1px solid ${colors.border}` }}>
                <TextField
                  size="small"
                  placeholder="Search tables..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: colors.bg.secondary,
                      color: colors.text.primary,
                      '& fieldset': { borderColor: colors.border },
                      '&:hover fieldset': { borderColor: colors.accent.primary },
                    },
                    '& .MuiInputBase-input::placeholder': { color: colors.text.muted },
                  }}
                />
              </Box>
              
              {/* Tables List */}
              <TableContainer sx={{ 
                maxHeight: 400,
                '&::-webkit-scrollbar': { width: '6px' },
                '&::-webkit-scrollbar-track': { bgcolor: colors.bg.secondary },
                '&::-webkit-scrollbar-thumb': { bgcolor: colors.border, borderRadius: '3px' },
              }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ 
                        bgcolor: colors.bg.card, 
                        color: colors.text.secondary, 
                        fontWeight: 600,
                        borderBottom: `1px solid ${colors.border}`,
                      }}>
                        #
                      </TableCell>
                      <TableCell sx={{ 
                        bgcolor: colors.bg.card, 
                        color: colors.text.secondary, 
                        fontWeight: 600,
                        borderBottom: `1px solid ${colors.border}`,
                      }}>
                        Table Name
                      </TableCell>
                      <TableCell sx={{ 
                        bgcolor: colors.bg.card, 
                        color: colors.text.secondary, 
                        fontWeight: 600,
                        borderBottom: `1px solid ${colors.border}`,
                      }} align="right">
                        Row Count
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tablesModal.tables
                      .filter(t => !tableSearch || t.name.toLowerCase().includes(tableSearch.toLowerCase()))
                      .map((table, idx) => (
                        <TableRow 
                          key={table.name}
                          sx={{ 
                            '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.05)' },
                            borderBottom: `1px solid ${colors.border}`,
                          }}
                        >
                          <TableCell sx={{ color: colors.text.muted, py: 1.5 }}>
                            {idx + 1}
                          </TableCell>
                          <TableCell sx={{ py: 1.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <TableIcon sx={{ 
                                fontSize: 18, 
                                color: tablesModal.type === 'source' ? colors.accent.primary : colors.accent.secondary,
                              }} />
                              <Typography sx={{ 
                                color: colors.text.primary, 
                                fontWeight: 500,
                                fontFamily: 'monospace',
                              }}>
                                {table.name}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="right" sx={{ py: 1.5 }}>
                            <Chip 
                              label={table.rowCount.toLocaleString()}
                              size="small"
                              sx={{
                                bgcolor: table.rowCount > 0 
                                  ? 'rgba(74, 222, 128, 0.15)' 
                                  : 'rgba(148, 163, 184, 0.15)',
                                color: table.rowCount > 0 
                                  ? colors.accent.success 
                                  : colors.text.muted,
                                fontWeight: 600,
                                fontFamily: 'monospace',
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </DialogContent>
        
        <DialogActions sx={{ 
          borderTop: `1px solid ${colors.border}`, 
          p: 2,
          justifyContent: 'space-between',
        }}>
          <Typography variant="body2" sx={{ color: colors.text.muted }}>
            {tablesModal.tables.filter(t => !tableSearch || t.name.toLowerCase().includes(tableSearch.toLowerCase())).length} tables shown
          </Typography>
          <Button 
            onClick={closeTablesModal}
            sx={{ 
              color: colors.text.primary,
              bgcolor: colors.bg.secondary,
              '&:hover': { bgcolor: colors.bg.card },
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Table Selection Dialog for Table-wise Migration */}
      <Dialog 
        open={tableSelectionDialog} 
        onClose={() => setTableSelectionDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: colors.bg.primary,
            backgroundImage: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: 3,
            maxHeight: '80vh',
          }
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 2,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ 
              bgcolor: 'rgba(56, 189, 248, 0.15)',
              p: 1,
              borderRadius: 2,
              display: 'flex',
            }}>
              <FilterListIcon sx={{ color: colors.accent.primary, fontSize: 28 }} />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ color: colors.text.primary, fontWeight: 600 }}>
                Select Tables to Migrate
              </Typography>
              <Typography variant="caption" sx={{ color: colors.text.muted }}>
                Choose which tables to include in this migration
              </Typography>
            </Box>
          </Box>
          <IconButton
            onClick={() => setTableSelectionDialog(false)}
            sx={{
              color: colors.text.secondary,
              '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.1)' },
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ p: 0 }}>
          {/* Search and Actions */}
          <Box sx={{ p: 2, borderBottom: `1px solid ${colors.border}` }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search tables..."
              value={tableSelectionSearch}
              onChange={(e) => setTableSelectionSearch(e.target.value)}
              sx={{
                mb: 1.5,
                '& .MuiOutlinedInput-root': {
                  bgcolor: colors.bg.secondary,
                  color: colors.text.primary,
                  '& fieldset': { borderColor: colors.border },
                  '&:hover fieldset': { borderColor: colors.accent.primary },
                  '&.Mui-focused fieldset': { borderColor: colors.accent.primary },
                },
                '& .MuiInputBase-input::placeholder': {
                  color: colors.text.muted,
                  opacity: 1,
                },
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                variant="text"
                size="small"
                startIcon={<SelectAllIcon />}
                onClick={handleSelectAllTables}
                sx={{
                  color: colors.accent.primary,
                  fontWeight: 600,
                  '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.1)' },
                }}
              >
                Select All
              </Button>
              <Button
                variant="text"
                size="small"
                onClick={handleDeselectAllTables}
                sx={{
                  color: colors.text.secondary,
                  fontWeight: 500,
                  '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.1)' },
                }}
              >
                Clear All
              </Button>
              <Box sx={{ flex: 1 }} />
              <Chip
                label={`${selectedTables.size} selected`}
                size="small"
                sx={{
                  bgcolor: selectedTables.size > 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                  color: selectedTables.size > 0 ? colors.accent.primary : colors.text.muted,
                  border: `1px solid ${selectedTables.size > 0 ? colors.accent.primary : colors.border}`,
                  fontWeight: 600,
                }}
              />
            </Box>
          </Box>

          {/* Table List */}
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: colors.bg.secondary, color: colors.text.secondary, fontWeight: 600, width: 50 }}>
                    <Checkbox
                      checked={tableMappings.length > 0 && tableMappings.every(m => {
                        const targetTable = m.targetTables[0] || '';
                        return selectedTables.has(targetTable);
                      })}
                      indeterminate={
                        tableMappings.some(m => {
                          const targetTable = m.targetTables[0] || '';
                          return selectedTables.has(targetTable);
                        }) && !tableMappings.every(m => {
                          const targetTable = m.targetTables[0] || '';
                          return selectedTables.has(targetTable);
                        })
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleSelectAllTables();
                        } else {
                          handleDeselectAllTables();
                        }
                      }}
                      sx={{
                        color: colors.accent.primary,
                        '&.Mui-checked': { color: colors.accent.primary },
                        '&.MuiCheckbox-indeterminate': { color: colors.accent.primary },
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ bgcolor: colors.bg.secondary, color: colors.text.secondary, fontWeight: 600 }}>Source Table</TableCell>
                  <TableCell sx={{ bgcolor: colors.bg.secondary, color: colors.text.secondary, fontWeight: 600 }}>Target Table</TableCell>
                  <TableCell sx={{ bgcolor: colors.bg.secondary, color: colors.text.secondary, fontWeight: 600 }} align="right">Columns</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tableMappings
                  .filter(m => {
                    const searchTerm = tableSelectionSearch.toLowerCase();
                    const sourceTable = m.sourceTables[0] || '';
                    const targetTable = m.targetTables[0] || '';
                    return !tableSelectionSearch || 
                      sourceTable.toLowerCase().includes(searchTerm) || 
                      targetTable.toLowerCase().includes(searchTerm);
                  })
                  .map((mapping, idx) => {
                    const targetTable = mapping.targetTables[0] || '';
                    const sourceTable = mapping.sourceTables[0] || '';
                    const isSelected = selectedTables.has(targetTable);
                    
                    return (
                      <TableRow
                        key={`table-${targetTable}-${idx}`}
                        onClick={(e) => {
                          // Don't toggle if clicking on the checkbox or its container
                          const target = e.target as HTMLElement;
                          if (
                            target.closest('input[type="checkbox"]') ||
                            target.closest('.MuiCheckbox-root') ||
                            target.closest('td')?.querySelector('input[type="checkbox"]')
                          ) {
                            return;
                          }
                          handleTableToggle(targetTable);
                        }}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                          '&:hover': { bgcolor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.05)' },
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        <TableCell 
                          sx={{ py: 1.5, cursor: 'default' }}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <Checkbox
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newValue = !isSelected;
                              setSelectedTables(prev => {
                                const newSet = new Set(prev);
                                if (newValue) {
                                  newSet.add(targetTable);
                                } else {
                                  newSet.delete(targetTable);
                                }
                                return new Set(newSet);
                              });
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            inputProps={{
                              'aria-label': `Select ${targetTable}`,
                            }}
                            sx={{
                              color: colors.accent.primary,
                              '&.Mui-checked': { color: colors.accent.primary },
                              pointerEvents: 'auto',
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ py: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TableIcon sx={{ fontSize: 18, color: colors.accent.primary }} />
                            <Typography sx={{ 
                              color: colors.text.primary, 
                              fontWeight: 500,
                              fontFamily: 'monospace',
                            }}>
                              {sourceTable}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ py: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TableIcon sx={{ fontSize: 18, color: colors.accent.secondary }} />
                            <Typography sx={{ 
                              color: colors.text.primary, 
                              fontWeight: 500,
                              fontFamily: 'monospace',
                            }}>
                              {targetTable}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right" sx={{ py: 1.5 }}>
                          <Chip
                            label={mapping.columnMappings.length}
                            size="small"
                            sx={{
                              bgcolor: 'rgba(148, 163, 184, 0.15)',
                              color: colors.text.secondary,
                              fontWeight: 600,
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        
        <DialogActions sx={{ 
          borderTop: `1px solid ${colors.border}`, 
          p: 2,
          justifyContent: 'space-between',
        }}>
          <Typography variant="body2" sx={{ color: colors.text.muted }}>
            {tableMappings.filter(m => {
              const searchTerm = tableSelectionSearch.toLowerCase();
              const sourceTable = m.sourceTables[0] || '';
              const targetTable = m.targetTables[0] || '';
              return !tableSelectionSearch || 
                sourceTable.toLowerCase().includes(searchTerm) || 
                targetTable.toLowerCase().includes(searchTerm);
            }).length} tables shown
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button 
              onClick={() => setTableSelectionDialog(false)}
              sx={{ 
                color: colors.text.secondary,
                '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.1)' },
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (selectedTables.size === 0) {
                  setError('Please select at least one table');
                  return;
                }
                setTableSelectionDialog(false);
              }}
              variant="contained"
              sx={{ 
                bgcolor: colors.accent.primary,
                color: colors.bg.primary,
                fontWeight: 600,
                '&:hover': { bgcolor: '#0ea5e9' },
              }}
            >
              Confirm ({selectedTables.size})
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* DDL Check Results Dialog */}
      <Dialog
        open={ddlCheckDialog}
        onClose={() => setDdlCheckDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: colors.bg?.secondary ?? '#1e293b',
            color: colors.text?.primary ?? '#f1f5f9',
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: colors.border ?? 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CompareArrowsIcon sx={{ color: colors.accent?.warning ?? '#f59e0b' }} />
          DDL Check Results
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {ddlCheckResults.length === 0 ? (
            <Typography variant="body2" sx={{ color: colors.text?.muted ?? 'text.secondary' }}>
              No results to show.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {ddlCheckResults.map((r, idx) => (
                <Accordion
                  key={idx}
                  defaultExpanded={!r.match}
                  sx={{
                    bgcolor: colors.bg?.primary ?? 'background.paper',
                    border: 1,
                    borderColor: r.match ? (colors.accent?.success ?? '#22c55e') : (colors.accent?.warning ?? '#f59e0b'),
                    borderRadius: 2,
                    '&:before': { display: 'none' },
                    '& .MuiAccordionSummary-content': { my: 1 },
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text?.primary }} />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: colors.text?.primary }}>
                        {r.sourceTable}
                      </Typography>
                      <Typography variant="body2" sx={{ color: colors.text?.muted }}>→</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: colors.text?.primary }}>
                        {r.targetTable}
                      </Typography>
                      {r.source.exists && r.target.exists ? (
                        <Chip
                          label={r.match ? 'Match' : `${r.differences?.length ?? 0} difference(s)`}
                          size="small"
                          sx={{
                            bgcolor: r.match ? (colors.accent?.success ?? '#22c55e') : (colors.accent?.warning ?? '#f59e0b'),
                            color: '#fff',
                            fontWeight: 600,
                          }}
                        />
                      ) : (
                        <Chip
                          label={!r.source.exists ? 'Source missing' : 'Target missing'}
                          size="small"
                          color="error"
                          sx={{ fontWeight: 600 }}
                        />
                      )}
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    {r.differences && r.differences.length > 0 ? (
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {r.differences.map((diff, i) => (
                          <Typography key={i} component="li" variant="body2" sx={{ color: colors.accent?.warning ?? '#f59e0b', mb: 0.5 }}>
                            {diff}
                          </Typography>
                        ))}
                      </Box>
                    ) : r.source.exists && r.target.exists && r.match ? (
                      <Typography variant="body2" sx={{ color: colors.accent?.success ?? '#22c55e' }}>
                        Source and target structures match (columns, primary key, foreign keys).
                      </Typography>
                    ) : null}
                    <Box sx={{ display: 'flex', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
                      <Typography variant="caption" sx={{ color: colors.text?.muted }}>
                        Source: {r.source.exists ? `${r.source.columns?.length ?? 0} columns, PK: [${(r.source.primaryKeyColumns ?? []).join(', ')}]` : 'table not found'}
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.text?.muted }}>
                        Target: {r.target.exists ? `${r.target.columns?.length ?? 0} columns, PK: [${(r.target.primaryKeyColumns ?? []).join(', ')}]` : 'table not found'}
                      </Typography>
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: colors.border ?? 'divider', p: 2 }}>
          <Button onClick={() => setDdlCheckDialog(false)} sx={{ color: colors.text?.muted ?? 'text.secondary' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={createTablesSnackbar.open}
        autoHideDuration={6000}
        onClose={() => setCreateTablesSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setCreateTablesSnackbar(prev => ({ ...prev, open: false }))}
          severity={createTablesSnackbar.severity}
          variant="filled"
        >
          {createTablesSnackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
