import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Chip,
  Divider,
  Tabs,
  Tab,
  IconButton,
} from '@mui/material';
import {
  CloudDownload as FetchIcon,
  Storage as DatabaseIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Update as UpdateIcon,
  Link as ConnectedIcon,
  ContentCopy as CopyIcon,
  Sync as RefreshIcon,
} from '@mui/icons-material';
import { useAppDispatch } from '../../store';
import { setSchema as setSourceSchema } from '../sourceSchema/sourceSchemaSlice';
import { setSchema as setTargetSchema } from '../targetSchema/targetSchemaSlice';
import { refreshSchemaFromDatabase, type RefreshResult } from './refreshSchema';
import { schemaToText } from '../../utils/schemaToText';
import type { DatabaseSchema } from '../../types';
import { API_BASE_URL } from '../../api/config';

const API_BASE = API_BASE_URL;

interface ConnectionStatus {
  source?: { success: boolean; message: string; tables?: number };
  target?: { success: boolean; message: string; tables?: number };
}

export default function ReadSchemaPage() {
  const dispatch = useAppDispatch();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [sourceSchema, setSourceSchemaState] = useState<DatabaseSchema | null>(null);
  const [targetSchema, setTargetSchemaState] = useState<DatabaseSchema | null>(null);
  const [fetchLoading, setFetchLoading] = useState<'source' | 'target' | 'both' | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);
  const [schemaTextTab, setSchemaTextTab] = useState<'source' | 'target'>('source');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  /**
   * Read both databases, apply the result, and store it as a snapshot — the
   * whole loop in one action, because doing it in three steps is how people end
   * up looking at a schema that no longer matches the database.
   */
  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    setRefreshError(null);
    try {
      const result = await dispatch(refreshSchemaFromDatabase()).unwrap();
      setRefreshResult(result);
      // Show what was just applied in the panes below, reusing the schema the
      // thunk already read rather than fetching it a second time.
      for (const role of result.refreshed) {
        if (role.role === 'source') setSourceSchemaState(role.schema);
        else setTargetSchemaState(role.schema);
      }
    } catch (err) {
      setRefreshError(typeof err === 'string' ? err : 'Could not refresh from the database.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopySchemaText = async () => {
    const text = schemaTextTab === 'source' && sourceSchema
      ? schemaToText(sourceSchema)
      : schemaTextTab === 'target' && targetSchema
        ? schemaToText(targetSchema)
        : '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Copied to clipboard');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('Copy failed');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  const testConnection = async () => {
    setConnectionLoading(true);
    setConnectionStatus(null);
    try {
      const res = await fetch(`${API_BASE}/test-connection/both`);
      const data = await res.json();
      if (res.ok && data.source != null && data.target != null) {
        setConnectionStatus({ source: data.source, target: data.target });
      } else {
        setConnectionStatus({ source: { success: false, message: 'Invalid response' }, target: { success: false, message: 'Invalid response' } });
      }
    } catch (err: any) {
      setConnectionStatus({
        source: { success: false, message: err?.message || 'Network error' },
        target: { success: false, message: err?.message || 'Network error' },
      });
    } finally {
      setConnectionLoading(false);
    }
  };

  const fetchSourceSchema = async () => {
    setFetchLoading('source');
    setFetchError(null);
    setSourceSchemaState(null);
    try {
      const res = await fetch(`${API_BASE}/schema/source`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch source schema');
      setSourceSchemaState(data);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch source schema');
    } finally {
      setFetchLoading(null);
    }
  };

  const fetchTargetSchema = async () => {
    setFetchLoading('target');
    setFetchError(null);
    setTargetSchemaState(null);
    try {
      const res = await fetch(`${API_BASE}/schema/target`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch target schema');
      setTargetSchemaState(data);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch target schema');
    } finally {
      setFetchLoading(null);
    }
  };

  const fetchBoth = async () => {
    setFetchLoading('both');
    setFetchError(null);
    setSourceSchemaState(null);
    setTargetSchemaState(null);
    try {
      const [sourceRes, targetRes] = await Promise.all([
        fetch(`${API_BASE}/schema/source`),
        fetch(`${API_BASE}/schema/target`),
      ]);
      const sourceData = await sourceRes.json();
      const targetData = await targetRes.json();
      if (!sourceRes.ok) throw new Error(sourceData.error || 'Failed to fetch source schema');
      if (!targetRes.ok) throw new Error(targetData.error || 'Failed to fetch target schema');
      setSourceSchemaState(sourceData);
      setTargetSchemaState(targetData);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch schemas');
    } finally {
      setFetchLoading(null);
    }
  };

  const updateToSource = () => {
    if (!sourceSchema) return;
    setUpdateSuccess(null);
    dispatch(setSourceSchema(sourceSchema));
    setUpdateSuccess('Source schema updated. View or edit it on the Schema page.');
  };

  const updateToTarget = () => {
    if (!targetSchema) return;
    setUpdateSuccess(null);
    dispatch(setTargetSchema(targetSchema));
    setUpdateSuccess('Target schema updated. View or edit it on the Schema page.');
  };

  const updateBoth = () => {
    if (!sourceSchema && !targetSchema) return;
    setUpdateSuccess(null);
    if (sourceSchema) dispatch(setSourceSchema(sourceSchema));
    if (targetSchema) dispatch(setTargetSchema(targetSchema));
    setUpdateSuccess('Source and target schema updated. View or edit them on the Schema page.');
  };

  const hasFetchedAny = sourceSchema != null || targetSchema != null;
  const hasBoth = sourceSchema != null && targetSchema != null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'neutral.100', overflow: 'auto' }}>
      {/* Header */}
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
          <DatabaseIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Box>
            <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
              Read Schema from Database
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.500' }}>
              Fetch schema from source and target databases, then update the app schema
            </Typography>
          </Box>
        </Box>
      </Paper>

      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 900, mx: 'auto', width: '100%' }}>
        {/* One-click refresh: read, apply, and store the live schema */}
        <Card variant="outlined" sx={{ borderColor: 'primary.200', bgcolor: 'primary.50' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              Refresh schema from database
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.600', mb: 2 }}>
              Reads both databases, applies the result to the app, and stores it as a schema
              snapshot so a saved configuration can pin exactly what it was built against. Use this
              whenever the database has changed — it is the fastest way to tell whether what you are
              looking at is still real.
            </Typography>
            <Button
              variant="contained"
              startIcon={refreshing ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
              onClick={handleRefresh}
              disabled={refreshing || !!fetchLoading}
            >
              {refreshing ? 'Reading databases…' : 'Refresh from database'}
            </Button>

            {refreshError && (
              <Alert severity="error" sx={{ mt: 2 }} onClose={() => setRefreshError(null)}>
                {refreshError}
              </Alert>
            )}

            {refreshResult && (
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {refreshResult.refreshed.map((role) => {
                  const delta = role.tablesAfter - role.tablesBefore;
                  return (
                    <Alert
                      key={role.role}
                      severity={delta === 0 ? 'success' : 'info'}
                      icon={<SuccessIcon fontSize="small" />}
                    >
                      <Typography variant="body2">
                        <strong>{role.role === 'source' ? 'Source' : 'Target'}</strong> ·{' '}
                        {role.database} — {role.tablesAfter} tables, {role.columnsAfter} columns
                        {delta !== 0 && (
                          <>
                            {' '}
                            (<strong>
                              {delta > 0 ? '+' : ''}
                              {delta}
                            </strong>{' '}
                            vs what was loaded)
                          </>
                        )}
                        {role.snapshotId !== null && (
                          <>
                            {' '}
                            · snapshot #{role.snapshotId}
                            {role.deduped && ' (identical to the one already stored)'}
                          </>
                        )}
                      </Typography>
                    </Alert>
                  );
                })}
                {refreshResult.failed.map((failure) => (
                  <Alert key={failure.role} severity="error">
                    <Typography variant="body2">
                      <strong>{failure.role}</strong> — {failure.error}
                    </Typography>
                  </Alert>
                ))}
                {refreshResult.warnings.map((warning) => (
                  <Alert key={warning} severity="warning">
                    <Typography variant="body2">{warning}</Typography>
                  </Alert>
                ))}
                <Typography variant="caption" sx={{ color: 'neutral.500' }}>
                  The app now uses this schema. To keep it, press “Save changes” in the header — that
                  writes a new configuration version pinned to these snapshots.
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>

        {/* Test connection */}
        <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
              Connection status
            </Typography>
            <Button
              variant="outlined"
              startIcon={connectionLoading ? <CircularProgress size={18} /> : <ConnectedIcon />}
              onClick={testConnection}
              disabled={connectionLoading}
              sx={{ mb: 2 }}
            >
              Test connection (source & target)
            </Button>
            {connectionStatus && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
          </CardContent>
        </Card>

        {/* Fetch schema */}
        <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
              Fetch schema from database
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.600', mb: 2 }}>
              Read the current schema from your source (MySQL/PostgreSQL) and target (PostgreSQL) databases. Then update the app to use these schemas.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Button
                variant="contained"
                startIcon={fetchLoading === 'source' ? <CircularProgress size={18} color="inherit" /> : <FetchIcon />}
                onClick={fetchSourceSchema}
                disabled={!!fetchLoading}
                sx={{ bgcolor: 'primary.main' }}
              >
                Fetch source schema
              </Button>
              <Button
                variant="contained"
                startIcon={fetchLoading === 'target' ? <CircularProgress size={18} color="inherit" /> : <FetchIcon />}
                onClick={fetchTargetSchema}
                disabled={!!fetchLoading}
                sx={{ bgcolor: 'secondary.main' }}
              >
                Fetch target schema
              </Button>
              <Button
                variant="outlined"
                startIcon={fetchLoading === 'both' ? <CircularProgress size={18} /> : <FetchIcon />}
                onClick={fetchBoth}
                disabled={!!fetchLoading}
              >
                Fetch both
              </Button>
            </Box>
            {fetchError && (
              <Alert severity="error" sx={{ mt: 2 }} onClose={() => setFetchError(null)}>
                {fetchError}
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Fetched schema summary */}
        {(sourceSchema != null || targetSchema != null) && (
          <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                Fetched schema
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sourceSchema && (
                  <Box>
                    <Chip label="Source" size="small" sx={{ mb: 1, bgcolor: 'primary.100', color: 'primary.main' }} />
                    <Typography variant="body2" sx={{ color: 'neutral.600' }}>
                      Database: {sourceSchema.database} · {sourceSchema.tables.length} tables
                    </Typography>
                    <List dense sx={{ maxHeight: 200, overflow: 'auto', bgcolor: 'neutral.100', borderRadius: 1, mt: 0.5 }}>
                      {sourceSchema.tables.slice(0, 20).map((t) => (
                        <ListItem key={t.name}>
                          <ListItemText primary={t.name} secondary={`${t.columns.length} columns`} primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }} />
                        </ListItem>
                      ))}
                      {sourceSchema.tables.length > 20 && (
                        <ListItem>
                          <ListItemText primary={`... and ${sourceSchema.tables.length - 20} more tables`} primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} />
                        </ListItem>
                      )}
                    </List>
                  </Box>
                )}
                {sourceSchema && targetSchema && <Divider />}
                {targetSchema && (
                  <Box>
                    <Chip label="Target" size="small" sx={{ mb: 1, bgcolor: 'secondary.100', color: 'secondary.main' }} />
                    <Typography variant="body2" sx={{ color: 'neutral.600' }}>
                      Database: {targetSchema.database} · {targetSchema.tables.length} tables
                    </Typography>
                    <List dense sx={{  overflow: 'auto', bgcolor: 'neutral.100', borderRadius: 1, mt: 0.5 }}>
                      {targetSchema.tables.slice(0, 20).map((t) => (
                        <ListItem key={t.name}>
                          <ListItemText primary={t.name} secondary={`${t.columns.length} columns`} primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }} />
                        </ListItem>
                      ))}
                      {targetSchema.tables.length > 20 && (
                        <ListItem>
                          <ListItemText primary={`... and ${targetSchema.tables.length - 20} more tables`} primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} />
                        </ListItem>
                      )}
                    </List>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Schema in text format */}
        {(sourceSchema != null || targetSchema != null) && (
          <Card variant="outlined" sx={{ borderColor: 'neutral.200' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Schema in text format
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {copyFeedback && (
                    <Typography variant="caption" sx={{ color: 'success.main' }}>{copyFeedback}</Typography>
                  )}
                  <IconButton
                    size="small"
                    onClick={handleCopySchemaText}
                    title="Copy to clipboard"
                    disabled={
                      (schemaTextTab === 'source' && !sourceSchema) ||
                      (schemaTextTab === 'target' && !targetSchema)
                    }
                  >
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              <Tabs
                value={schemaTextTab}
                onChange={(_, v: 'source' | 'target') => setSchemaTextTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
              >
                <Tab label="Source (MySQL/PostgreSQL)" value="source" disabled={!sourceSchema} />
                <Tab label="Target (PostgreSQL)" value="target" disabled={!targetSchema} />
              </Tabs>
              <Box
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: 'neutral.100',
                  borderRadius: 1,
                  overflow: 'auto',
                  maxHeight: 420,
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {schemaTextTab === 'source' && sourceSchema && schemaToText(sourceSchema)}
                {schemaTextTab === 'target' && targetSchema && schemaToText(targetSchema)}
                {((schemaTextTab === 'source' && !sourceSchema) || (schemaTextTab === 'target' && !targetSchema)) &&
                  'No schema loaded for this tab.'}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Update schema to source or target */}
        {hasFetchedAny && (
          <Card variant="outlined" sx={{ borderColor: 'success.200', bgcolor: 'success.100' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                Update app schema
              </Typography>
              <Typography variant="body2" sx={{ color: 'neutral.600', mb: 2 }}>
                Apply the fetched schema to the app as source, target, or both. The Schema page and mappings will use this data.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<UpdateIcon />}
                  onClick={updateToSource}
                  disabled={!sourceSchema}
                  sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}
                >
                  Update to source
                </Button>
                <Button
                  variant="contained"
                  startIcon={<UpdateIcon />}
                  onClick={updateToTarget}
                  disabled={!targetSchema}
                  sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.dark' } }}
                >
                  Update to target
                </Button>
                {hasBoth && (
                  <Button
                    variant="outlined"
                    startIcon={<UpdateIcon />}
                    onClick={updateBoth}
                    sx={{ borderColor: 'success.main', color: 'success.dark', '&:hover': { borderColor: 'success.dark', bgcolor: 'success.100' } }}
                  >
                    Update both
                  </Button>
                )}
              </Box>
              {updateSuccess && (
                <Alert severity="success" sx={{ mt: 2 }} onClose={() => setUpdateSuccess(null)}>
                  {updateSuccess}
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </Box>
    </Box>
  );
}
