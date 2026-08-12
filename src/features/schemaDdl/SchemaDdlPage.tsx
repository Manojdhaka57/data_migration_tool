import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  Alert,
  Chip,
  CircularProgress,
  Tabs,
  Tab,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import {
  Code as CodeIcon,
  CloudDownload as FetchIcon,
  CloudUpload as ApplyIcon,
  FormatListNumbered as OrderIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Link as ConnectedIcon,
  ContentCopy as CopyIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { API_BASE_URL } from '../../api/config';
const API_BASE = API_BASE_URL;

// DDL is read directly from the database by the server (GET /api/ddl/source, GET /api/ddl/target).
// The frontend only fetches and displays the response; it does not generate or create any DDL.

interface ConnectionStatus {
  source?: { success: boolean; message: string; tables?: number };
  target?: { success: boolean; message: string; tables?: number };
}

export interface DdlTableEntry {
  name: string;
  ddl: string;
}

export interface DdlResponse {
  database: string;
  tables: DdlTableEntry[];
}

interface ApplyResult {
  success: boolean;
  targetDb: string;
  targetDbType: string;
  droppedTables?: string[];
  createdTables: string[];
  addedColumns: string[];
  addedConstraints: string[];
  fixedIdentity?: string[];
  fixedDefaults?: string[];
  missingRefTables: string[];
  unchangedTables: string[];
  errors: string[];
}

interface ApplyOrderLevel {
  level: number;
  tables: string[];
}

export default function SchemaDdlPage() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [sourceDdl, setSourceDdl] = useState<DdlResponse | null>(null);
  const [targetDdl, setTargetDdl] = useState<DdlResponse | null>(null);
  const [fetchLoading, setFetchLoading] = useState<'source' | 'target' | 'both' | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [ddlTab, setDdlTab] = useState<'source' | 'target'>('source');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyingTable, setApplyingTable] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recreateMode, setRecreateMode] = useState(false);
  const [applyOrder, setApplyOrder] = useState<ApplyOrderLevel[] | null>(null);
  const [orderType, setOrderType] = useState<'source' | 'target' | null>(null);
  const [orderLoading, setOrderLoading] = useState<'source' | 'target' | null>(null);

  const testConnection = async () => {
    setConnectionLoading(true);
    setConnectionStatus(null);
    try {
      const res = await fetch(`${API_BASE}/test-connection/both`);
      const data = await res.json();
      if (res.ok && data.source != null && data.target != null) {
        setConnectionStatus({ source: data.source, target: data.target });
      } else {
        setConnectionStatus({
          source: { success: false, message: 'Invalid response' },
          target: { success: false, message: 'Invalid response' },
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      setConnectionStatus({
        source: { success: false, message },
        target: { success: false, message },
      });
    } finally {
      setConnectionLoading(false);
    }
  };

  const fetchSourceDdl = async () => {
    setFetchLoading('source');
    setFetchError(null);
    setSourceDdl(null);
    try {
      const res = await fetch(`${API_BASE}/ddl/source`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch source DDL');
      setSourceDdl(data);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch source DDL');
    } finally {
      setFetchLoading(null);
    }
  };

  const fetchTargetDdl = async () => {
    setFetchLoading('target');
    setFetchError(null);
    setTargetDdl(null);
    try {
      const res = await fetch(`${API_BASE}/ddl/target`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch target DDL');
      setTargetDdl(data);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch target DDL');
    } finally {
      setFetchLoading(null);
    }
  };

  const fetchBoth = async () => {
    setFetchLoading('both');
    setFetchError(null);
    setSourceDdl(null);
    setTargetDdl(null);
    try {
      const [sourceRes, targetRes] = await Promise.all([
        fetch(`${API_BASE}/ddl/source`),
        fetch(`${API_BASE}/ddl/target`),
      ]);
      const sourceData = await sourceRes.json();
      const targetData = await targetRes.json();
      if (!sourceRes.ok) throw new Error(sourceData.error || 'Failed to fetch source DDL');
      if (!targetRes.ok) throw new Error(targetData.error || 'Failed to fetch target DDL');
      setSourceDdl(sourceData);
      setTargetDdl(targetData);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch DDL');
    } finally {
      setFetchLoading(null);
    }
  };

  // Apply source schema to the target DB: create missing tables + add missing columns.
  const applyToTarget = async (tables?: string[], recreate = false) => {
    if (tables && tables.length === 1) setApplyingTable(tables[0]);
    else setApplyLoading(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const res = await fetch(`${API_BASE}/ddl/apply-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(tables ? { tables } : {}), ...(recreate ? { recreate: true } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply schema to target');
      setApplyResult(data);
      fetchTargetDdl(); // refresh target DDL so the new tables/columns show
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply schema to target');
    } finally {
      setApplyLoading(false);
      setApplyingTable(null);
    }
  };

  // Fetch the FK-dependency order for source or target so the user knows which tables to copy first.
  const fetchApplyOrder = async (type: 'source' | 'target') => {
    setOrderLoading(type);
    setApplyError(null);
    try {
      const res = await fetch(`${API_BASE}/ddl-order/${type}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to compute copy order');
      setApplyOrder(data.order || []);
      setOrderType(type);
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : 'Failed to compute copy order');
    } finally {
      setOrderLoading(null);
    }
  };

  const copyTableDdl = async (ddl: string) => {
    try {
      await navigator.clipboard.writeText(ddl);
      setCopyFeedback('Copied');
      setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      setCopyFeedback('Copy failed');
      setTimeout(() => setCopyFeedback(null), 1500);
    }
  };

  const copyAllDdl = async () => {
    const data = ddlTab === 'source' ? sourceDdl : targetDdl;
    if (!data?.tables?.length) return;
    const full = data.tables.map((t) => t.ddl).join('\n\n');
    try {
      await navigator.clipboard.writeText(full);
      setCopyFeedback('All DDL copied');
      setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      setCopyFeedback('Copy failed');
      setTimeout(() => setCopyFeedback(null), 1500);
    }
  };

  const hasAnyDdl = sourceDdl != null || targetDdl != null;
  const currentData = ddlTab === 'source' ? sourceDdl : targetDdl;
  const tables = currentData?.tables ?? [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'neutral.100', overflow: 'auto' }}>
      <Paper
        elevation={0}
        sx={{
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: 'neutral.200',
          bgcolor: 'white.main',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <CodeIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Box>
            <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
              Schema DDL
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.500' }}>
              DDL is read directly from the database by the server (pg_dump / SHOW CREATE TABLE). This page only displays it—nothing is generated in the browser.
            </Typography>
          </Box>
        </Box>
      </Paper>

      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 960, mx: 'auto', width: '100%' }}>
        <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
              Connection & fetch
            </Typography>
            <Button
              variant="outlined"
              startIcon={connectionLoading ? <CircularProgress size={18} /> : <ConnectedIcon />}
              onClick={testConnection}
              disabled={connectionLoading}
              sx={{ mb: 2, mr: 1 }}
            >
              Test connection
            </Button>
            <Button
              variant="contained"
              startIcon={fetchLoading === 'source' ? <CircularProgress size={18} color="inherit" /> : <FetchIcon />}
              onClick={fetchSourceDdl}
              disabled={!!fetchLoading}
              sx={{ mr: 1, mb: 1 }}
            >
              Fetch source DDL
            </Button>
            <Button
              variant="contained"
              startIcon={fetchLoading === 'target' ? <CircularProgress size={18} color="inherit" /> : <FetchIcon />}
              onClick={fetchTargetDdl}
              disabled={!!fetchLoading}
              sx={{ mr: 1, mb: 1, bgcolor: 'secondary.main' }}
            >
              Fetch target DDL
            </Button>
            <Button
              variant="outlined"
              startIcon={fetchLoading === 'both' ? <CircularProgress size={18} /> : <FetchIcon />}
              onClick={fetchBoth}
              disabled={!!fetchLoading}
              sx={{ mb: 1 }}
            >
              Fetch both
            </Button>
            <Button
              variant="contained"
              color="warning"
              startIcon={applyLoading ? <CircularProgress size={18} color="inherit" /> : <ApplyIcon />}
              onClick={() => setConfirmOpen(true)}
              disabled={!!fetchLoading || applyLoading || !!applyingTable}
              sx={{ mb: 1, ml: 1 }}
            >
              Apply source schema → target DB
            </Button>
            <Button
              variant="outlined"
              startIcon={orderLoading === 'source' ? <CircularProgress size={18} /> : <OrderIcon />}
              onClick={() => fetchApplyOrder('source')}
              disabled={!!orderLoading}
              sx={{ mb: 1, ml: 1 }}
            >
              Source copy order
            </Button>
            <Button
              variant="outlined"
              startIcon={orderLoading === 'target' ? <CircularProgress size={18} /> : <OrderIcon />}
              onClick={() => fetchApplyOrder('target')}
              disabled={!!orderLoading}
              sx={{ mb: 1, ml: 1, borderColor: 'secondary.main', color: 'secondary.main' }}
            >
              Target copy order
            </Button>
            <Typography variant="caption" sx={{ display: 'block', color: 'neutral.500', mt: 0.5 }}>
              Creates missing tables and adds missing columns in the target database. Never drops or alters existing columns.
            </Typography>
            {applyError && (
              <Alert severity="error" sx={{ mt: 2 }} onClose={() => setApplyError(null)}>
                {applyError}
              </Alert>
            )}
            {applyResult && (
              <Alert
                severity={applyResult.errors.length ? 'warning' : 'success'}
                sx={{ mt: 2 }}
                onClose={() => setApplyResult(null)}
              >
                Applied to {applyResult.targetDb} ({applyResult.targetDbType?.toUpperCase()}):{' '}
                {applyResult.droppedTables && applyResult.droppedTables.length > 0 && (
                  <><b>{applyResult.droppedTables.length}</b> table(s) dropped, </>
                )}
                <b>{applyResult.createdTables.length}</b> table(s) created,{' '}
                <b>{applyResult.addedColumns.length}</b> column(s) added,{' '}
                <b>{applyResult.addedConstraints.length}</b> foreign key(s) added,{' '}
                <b>{applyResult.fixedIdentity?.length ?? 0}</b> identity column(s) fixed,{' '}
                <b>{applyResult.fixedDefaults?.length ?? 0}</b> default(s) restored,{' '}
                {applyResult.unchangedTables.length} unchanged.
                {applyResult.missingRefTables.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      ⚠️ Apply these referenced tables first, then apply again to add their foreign keys:{' '}
                      {applyResult.missingRefTables.join(', ')}
                    </Typography>
                  </Box>
                )}
                {applyResult.errors.length > 0 && (
                  <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                    {applyResult.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>
                        <Typography variant="caption">{e}</Typography>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>
            )}
            {connectionStatus && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {connectionStatus.source?.success ? (
                    <SuccessIcon sx={{ color: 'success.main', fontSize: 20 }} />
                  ) : (
                    <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                  )}
                  <Typography variant="body2">
                    Source: {connectionStatus.source?.message}
                    {connectionStatus.source?.tables != null && ` (${connectionStatus.source.tables} tables)`}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {connectionStatus.target?.success ? (
                    <SuccessIcon sx={{ color: 'success.main', fontSize: 20 }} />
                  ) : (
                    <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                  )}
                  <Typography variant="body2">
                    Target: {connectionStatus.target?.message}
                    {connectionStatus.target?.tables != null && ` (${connectionStatus.target.tables} tables)`}
                  </Typography>
                </Box>
              </Box>
            )}
            {fetchError && (
              <Alert severity="error" sx={{ mt: 2 }} onClose={() => setFetchError(null)}>
                {fetchError}
              </Alert>
            )}
          </CardContent>
        </Card>

        {applyOrder && (
          <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {orderType === 'target' ? 'Target' : 'Source'} table order (by foreign-key dependencies)
                </Typography>
                {orderType === 'source' && (
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    startIcon={applyLoading ? <CircularProgress size={16} color="inherit" /> : <ApplyIcon />}
                    onClick={() => setConfirmOpen(true)}
                    disabled={applyLoading || !!applyingTable}
                  >
                    Apply all in order
                  </Button>
                )}
              </Box>
              <Typography variant="body2" sx={{ color: 'neutral.600', mb: 2 }}>
                {orderType === 'source'
                  ? 'Copy top to bottom — each level only references tables in the levels above it. Click a table to copy just it, or use “Apply all in order”.'
                  : 'Existing dependency order of the target database (read-only, for reference).'}
              </Typography>
              {applyOrder.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'neutral.500' }}>
                  No tables found.
                </Typography>
              ) : (
                applyOrder.map((lvl) => (
                  <Box key={lvl.level} sx={{ mb: 1.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
                      Level {lvl.level}
                      {lvl.level === 0 ? ' — copy first (no dependencies)' : ` — references level ${lvl.level - 1} and below`}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                      {lvl.tables.map((name) =>
                        orderType === 'source' ? (
                          <Button
                            key={name}
                            size="small"
                            variant="outlined"
                            startIcon={
                              applyingTable === name ? <CircularProgress size={14} /> : <ApplyIcon fontSize="small" />
                            }
                            onClick={() => applyToTarget([name])}
                            disabled={!!applyingTable || applyLoading}
                            sx={{ textTransform: 'none', fontFamily: 'monospace' }}
                          >
                            {name}
                          </Button>
                        ) : (
                          <Chip key={name} label={name} size="small" sx={{ fontFamily: 'monospace' }} />
                        )
                      )}
                    </Box>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {hasAnyDdl && (
          <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  DDL by table (read from database)
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {copyFeedback && (
                    <Typography variant="caption" sx={{ color: 'success.main' }}>
                      {copyFeedback}
                    </Typography>
                  )}
                  <Button size="small" startIcon={<CopyIcon />} onClick={copyAllDdl} disabled={!tables.length}>
                    Copy all
                  </Button>
                </Box>
              </Box>
              <Tabs
                value={ddlTab}
                onChange={(_, v: 'source' | 'target') => setDdlTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
              >
                <Tab label="Source DDL" value="source" disabled={!sourceDdl} />
                <Tab label="Target DDL" value="target" disabled={!targetDdl} />
              </Tabs>
              {currentData && (
                <Typography variant="body2" sx={{ color: 'neutral.600', mb: 2 }}>
                  Database: {currentData.database} · {tables.length} table{tables.length !== 1 ? 's' : ''}
                </Typography>
              )}
              {tables.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'neutral.500' }}>
                  No tables in this database. Nothing to create.
                </Typography>
              ) : (
                <Box>
                  {tables.map((t) => (
                    <Accordion key={t.name} defaultExpanded={false} sx={{ '&:before': { display: 'none' } }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                          <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                            {t.name}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyTableDdl(t.ddl);
                            }}
                            title="Copy this table DDL"
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                          {ddlTab === 'source' && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="warning"
                              startIcon={
                                applyingTable === t.name ? <CircularProgress size={14} /> : <ApplyIcon fontSize="small" />
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                applyToTarget([t.name]);
                              }}
                              disabled={!!applyingTable || applyLoading}
                              sx={{ ml: 'auto' }}
                            >
                              Apply to target
                            </Button>
                          )}
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 0, bgcolor: 'grey.900' }}>
                        <Box
                          component="pre"
                          sx={{
                            p: 2,
                            color: 'grey.100',
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            whiteSpace: 'pre',
                            overflow: 'auto',
                            maxHeight: 400,
                          }}
                        >
                          {t.ddl}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        )}
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Apply source schema to target database?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This writes to the <b>target</b> database. It will <b>create missing tables</b> and{' '}
            <b>add missing columns</b> (mapped to the target dialect). Existing tables and columns are{' '}
            <b>never dropped or altered</b>; new columns are added as nullable.
          </Typography>
          <FormControlLabel
            sx={{ mt: 1.5, alignItems: 'flex-start' }}
            control={
              <Checkbox
                checked={recreateMode}
                onChange={(e) => setRecreateMode(e.target.checked)}
                color="error"
                sx={{ pt: 0 }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: recreateMode ? 'error.main' : 'text.secondary' }}>
                <b>Drop &amp; recreate (exact match)</b> — DROP each target table first, then recreate it
                from the source. This <b>permanently deletes all existing data</b> in those target tables.
              </Typography>
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={recreateMode ? 'error' : 'warning'}
            startIcon={<ApplyIcon />}
            onClick={() => {
              setConfirmOpen(false);
              applyToTarget(undefined, recreateMode);
            }}
          >
            {recreateMode ? 'Drop & Recreate' : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
