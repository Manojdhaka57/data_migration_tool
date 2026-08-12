import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Switch,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
  Divider,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Save as SaveIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowRight as CollapseIcon,
  Archive as ArchiveIcon,
  Unarchive as RestoreIcon,
  ContentCopy as CloneIcon,
  Visibility as InspectIcon,
  Storage as DbIcon,
  PlayCircleOutline as ApplyIcon,
  CheckCircle as ActiveIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { selectAuth, selectCan } from '../auth/authSlice';
import { selectTableMappings, getPersistedMappings } from '../mapping/mappingSlice';
import { applyConfiguration, type AppliedSummary } from './applyConfiguration';
import { getActiveConfiguration } from './activeConfiguration';
import { selectConfigurationSaveState } from './configurationSlice';
import { errorMessage, isApiError } from '../../api/errors';
import {
  listConfigurations,
  listVersions,
  getResolved,
  createConfiguration,
  archiveConfiguration,
  restoreConfiguration,
  cloneConfiguration,
  type ConfigurationRecord,
  type VersionSummary,
  type ResolvedConfiguration,
} from '../../api/endpoints/configurations';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Who saved something, rendered the same way everywhere. */
function SavedBy({ who, highlight }: { who: string | null; highlight: boolean }) {
  const name = who ?? 'unknown';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Avatar
        sx={{
          width: 22,
          height: 22,
          fontSize: 11,
          bgcolor: highlight ? 'primary.main' : 'neutral.300',
          color: highlight ? 'white.main' : 'neutral.700',
        }}
      >
        {name.charAt(0).toUpperCase()}
      </Avatar>
      <Typography variant="caption1Medium" sx={{ color: highlight ? 'primary.main' : 'neutral.700' }}>
        {name}
      </Typography>
      {highlight && <Chip label="you" size="small" sx={{ height: 18, fontSize: 10 }} />}
    </Box>
  );
}

export default function ConfigurationsPage() {
  const dispatch = useAppDispatch();
  const { user, appDbConfigured, appDbReachable, ready } = useAppSelector(selectAuth);
  const canWrite = useAppSelector(selectCan('operator'));
  const tableMappings = useAppSelector(selectTableMappings);

  const { lastSave } = useAppSelector(selectConfigurationSaveState);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<AppliedSummary | null>(null);
  const [activeId, setActiveId] = useState<number | null>(
    () => getActiveConfiguration()?.configurationId ?? null,
  );

  const [rows, setRows] = useState<ConfigurationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [includeArchived, setIncludeArchived] = useState(false);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [versions, setVersions] = useState<Record<number, VersionSummary[]>>({});
  const [inspecting, setInspecting] = useState<ResolvedConfiguration | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const currentUser = user?.username ?? null;
  const isAdmin = user?.role === 'admin';

  /**
   * Load a configuration version into the editor.
   *
   * Applying REPLACES what is currently loaded, so if this browser holds
   * mappings that are not in the target version, say so first — that is
   * exactly how unsaved work disappears without anyone noticing.
   */
  const apply = async (configurationId: number, name: string, version?: number) => {
    const draft = getPersistedMappings();
    if (draft && draft.length > 0) {
      const confirmed = window.confirm(
        `Apply “${name}”${version ? ` version ${version}` : ''}?\n\n` +
          `This replaces what is currently loaded, including ${draft.length} table ` +
          `mapping(s) held in this browser.\n\n` +
          `If those are unsaved changes, cancel and save them as a new version first.`,
      );
      if (!confirmed) return;
    }

    const key = `${configurationId}:${version ?? 'current'}`;
    setApplying(key);
    setError(null);
    setApplied(null);
    try {
      const summary = await dispatch(applyConfiguration({ configurationId, version })).unwrap();
      setApplied(summary);
      setActiveId(configurationId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApplying(null);
    }
  };


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listConfigurations(includeArchived));
    } catch (err) {
      setError(
        isApiError(err) && err.code === 'APP_DB_NOT_CONFIGURED'
          ? 'The metadata database is not configured, so there are no saved configurations to show.'
          : errorMessage(err),
      );
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    if (ready && appDbConfigured) void load();
  }, [ready, appDbConfigured, load]);

  /**
   * A version was saved from the header, so this list is stale — the version
   * number, "last saved" time and version history all moved. Refetch, and drop
   * any cached version list so an expanded row reloads too.
   */
  useEffect(() => {
    if (!lastSave?.created) return;
    setVersions({});
    void load();
  }, [lastSave, load]);

  // "Saved by me" means either the original author or the author of the most
  // recent version — editing someone else's configuration is still your work.
  const visible = useMemo(() => {
    if (scope === 'all' || !currentUser) return rows;
    return rows.filter((r) => r.created_by === currentUser || r.updated_by === currentUser);
  }, [rows, scope, currentUser]);

  const mineCount = useMemo(
    () =>
      currentUser
        ? rows.filter((r) => r.created_by === currentUser || r.updated_by === currentUser).length
        : 0,
    [rows, currentUser],
  );

  const toggleExpand = async (id: number) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!versions[id]) {
      try {
        setVersions((v) => ({ ...v, [id]: [] }));
        const list = await listVersions(id);
        setVersions((v) => ({ ...v, [id]: list }));
      } catch (err) {
        setError(errorMessage(err));
      }
    }
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!ready) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  // Without the metadata database there is nowhere for configurations to live.
  // Explain the setup rather than showing an empty table that looks like a bug.
  if (!appDbConfigured || !appDbReachable) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info" icon={<DbIcon />}>
          <Typography variant="body2Medium" sx={{ display: 'block', mb: 0.5 }}>
            Saved configurations need the metadata database
          </Typography>
          <Typography variant="caption1" sx={{ color: 'neutral.600' }}>
            Set <code>APP_DB_HOST</code> and <code>APP_DB_NAME</code> in <code>.env</code>, then run{' '}
            <code>npm run appdb:up</code> and restart the migration server.
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto', bgcolor: 'neutral.100' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {isAdmin ? (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_, v) => v && setScope(v)}
            sx={{ bgcolor: 'white.main' }}
          >
            <ToggleButton value="mine" sx={{ textTransform: 'none', px: 2 }}>
              Saved by me ({mineCount})
            </ToggleButton>
            <ToggleButton value="all" sx={{ textTransform: 'none', px: 2 }}>
              Everyone ({rows.length})
            </ToggleButton>
          </ToggleButtonGroup>
        ) : (
          // Non-admins are only sent their own configurations by the server, so
          // an "Everyone" tab would be a button that changes nothing.
          <Chip
            label={`Your configurations (${rows.length})`}
            size="small"
            sx={{ bgcolor: 'white.main' }}
          />
        )}

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
          }
          label={<Typography variant="caption1">Include archived</Typography>}
        />

        <Box sx={{ flex: 1 }} />

        <Tooltip title="Reload">
          <IconButton size="small" onClick={() => void load()} disabled={loading}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip
          title={
            canWrite
              ? 'Save the mappings currently in the editor as a new configuration'
              : 'Requires the operator role'
          }
        >
          <span>
            <Button
              variant="contained"
              size="small"
              startIcon={<SaveIcon fontSize="small" />}
              disabled={!canWrite || tableMappings.length === 0}
              onClick={() => setSaveOpen(true)}
              sx={{ textTransform: 'none' }}
            >
              Save current mappings ({tableMappings.length})
            </Button>
          </span>
        </Tooltip>
      </Box>

      {isAdmin && scope === 'all' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="caption1">
            You are an admin, so this includes configurations saved by other users. Everyone else
            sees only their own.
          </Typography>
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* What an Apply actually restored — stated, not assumed. */}
      {applied && (
        <Alert
          severity={applied.dropped.length ? 'warning' : 'success'}
          sx={{ mb: 2 }}
          onClose={() => setApplied(null)}
        >
          <Typography variant="body2Medium" sx={{ display: 'block', mb: 0.5 }}>
            Applied “{applied.name}” version {applied.version}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: applied.warnings.length ? 1 : 0 }}>
            <Chip size="small" variant="outlined" label={`${applied.tableMappings} table mappings`} />
            <Chip size="small" variant="outlined" label={`${applied.columnMappings} column mappings`} />
            <Chip
              size="small"
              variant="outlined"
              label={`source schema ${applied.sourceSchemaTables ?? '—'} tables`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`target schema ${applied.targetSchemaTables ?? '—'} tables`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={
                applied.selectedTables > 0
                  ? `${applied.selectedTables} tables selected`
                  : 'all tables'
              }
            />
            <Chip
              size="small"
              variant="outlined"
              label={applied.hasMappingOrder ? 'manual order' : 'order from foreign keys'}
            />
          </Box>
          {applied.dropped.map((d) => (
            <Typography key={d.index} variant="caption1" sx={{ display: 'block' }}>
              mapping #{d.index} cannot run: {d.reason}
            </Typography>
          ))}
          {applied.warnings.slice(0, 5).map((w, i) => (
            <Typography key={i} variant="caption1" sx={{ display: 'block', color: 'neutral.600' }}>
              {w}
            </Typography>
          ))}
        </Alert>
      )}

      <TableContainer component={Paper} elevation={0} sx={{ border: 1, borderColor: 'neutral.200' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'neutral.50' }}>
              <TableCell sx={{ width: 40 }} />
              <TableCell>Name</TableCell>
              <TableCell>Saved by</TableCell>
              <TableCell>Last saved</TableCell>
              <TableCell align="center">Version</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={22} />
                </TableCell>
              </TableRow>
            )}

            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 5 }}>
                  <Typography variant="body2" sx={{ color: 'neutral.500' }}>
                    {scope === 'mine' && rows.length > 0
                      ? 'You have not saved any configurations yet — switch to “Everyone” to see the rest.'
                      : 'No saved configurations yet. Build mappings, then use “Save current mappings”.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              visible.map((row) => {
                const isMine = row.created_by === currentUser || row.updated_by === currentUser;
                const open = expanded === row.id;
                return [
                  <TableRow key={row.id} hover sx={{ '& > *': { borderBottom: open ? 0 : undefined } }}>
                    <TableCell>
                      <IconButton size="small" onClick={() => void toggleExpand(row.id)}>
                        {open ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography variant="body2Medium" sx={{ color: 'neutral.800' }}>
                          {row.name}
                        </Typography>
                        {activeId === row.id && (
                          <Tooltip title="Currently loaded in the app">
                            <ActiveIcon sx={{ fontSize: 15, color: 'success.main' }} />
                          </Tooltip>
                        )}
                      </Box>
                      {row.description && (
                        <Typography variant="caption2" sx={{ color: 'neutral.500' }}>
                          {row.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <SavedBy who={row.updated_by ?? row.created_by} highlight={isMine} />
                      {row.updated_by && row.created_by && row.updated_by !== row.created_by && (
                        <Typography variant="caption2" sx={{ color: 'neutral.400', ml: 3.75 }}>
                          created by {row.created_by}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption1" sx={{ color: 'neutral.600' }}>
                        {formatWhen(row.updated_at)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={`v${row.current_version}`} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={row.status.toLowerCase()}
                        size="small"
                        color={row.status === 'ACTIVE' ? 'success' : 'default'}
                        variant={row.status === 'ACTIVE' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Load this configuration into the app — schemas, mappings, order and run options">
                        <span>
                          <Button
                            size="small"
                            variant={activeId === row.id ? 'outlined' : 'contained'}
                            startIcon={
                              applying === `${row.id}:current` ? (
                                <CircularProgress size={13} color="inherit" />
                              ) : (
                                <ApplyIcon fontSize="small" />
                              )
                            }
                            disabled={applying !== null || row.status === 'ARCHIVED'}
                            onClick={() => void apply(row.id, row.name)}
                            sx={{ textTransform: 'none', mr: 1 }}
                          >
                            {activeId === row.id ? 'Re-apply' : 'Apply'}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Show what would actually run">
                        <IconButton
                          size="small"
                          onClick={async () => {
                            try {
                              setInspecting(await getResolved(row.id));
                            } catch (err) {
                              setError(errorMessage(err));
                            }
                          }}
                        >
                          <InspectIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={canWrite ? 'Clone' : 'Requires the operator role'}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!canWrite}
                            onClick={() =>
                              void run(
                                () =>
                                  cloneConfiguration(row.id, {
                                    name: `${row.name} (copy ${new Date().toISOString().slice(11, 19)})`,
                                  }),
                                `Cloned “${row.name}”.`,
                              )
                            }
                          >
                            <CloneIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      {row.status === 'ACTIVE' ? (
                        <Tooltip title={canWrite ? 'Archive (never deleted)' : 'Requires the operator role'}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={!canWrite}
                              onClick={() =>
                                void run(
                                  () => archiveConfiguration(row.id),
                                  `Archived “${row.name}”. Its versions are kept.`,
                                )
                              }
                            >
                              <ArchiveIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title={canWrite ? 'Restore' : 'Requires the operator role'}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={!canWrite}
                              onClick={() =>
                                void run(() => restoreConfiguration(row.id), `Restored “${row.name}”.`)
                              }
                            >
                              <RestoreIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>,

                  <TableRow key={`${row.id}-versions`}>
                    <TableCell colSpan={7} sx={{ py: 0, borderBottom: open ? 1 : 0, borderColor: 'neutral.200' }}>
                      <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ py: 2, pl: 6, pr: 2 }}>
                          <Typography variant="caption1Bold" sx={{ color: 'neutral.700' }}>
                            Version history
                          </Typography>
                          <Typography variant="caption2" sx={{ display: 'block', color: 'neutral.400', mb: 1 }}>
                            Versions are append-only — saving never overwrites an earlier one.
                          </Typography>
                          {(versions[row.id] ?? []).length === 0 ? (
                            <Typography variant="caption1" sx={{ color: 'neutral.400' }}>
                              Loading…
                            </Typography>
                          ) : (
                            <Table size="small">
                              <TableBody>
                                {versions[row.id].map((v) => (
                                  <TableRow key={v.id}>
                                    <TableCell sx={{ width: 70, border: 0 }}>
                                      <Chip label={`v${v.version}`} size="small" variant="outlined" />
                                    </TableCell>
                                    <TableCell sx={{ width: 220, border: 0 }}>
                                      <SavedBy who={v.created_by} highlight={v.created_by === currentUser} />
                                    </TableCell>
                                    <TableCell sx={{ width: 180, border: 0 }}>
                                      <Typography variant="caption1" sx={{ color: 'neutral.600' }}>
                                        {formatWhen(v.created_at)}
                                      </Typography>
                                    </TableCell>
                                    <TableCell sx={{ border: 0 }}>
                                      <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
                                        {v.note ?? '—'}
                                      </Typography>
                                    </TableCell>
                                    <TableCell sx={{ border: 0, width: 130 }} align="right">
                                      {/* Applying an old version is how you go
                                          back to it — the version itself is
                                          never modified. */}
                                      <Button
                                        size="small"
                                        variant="text"
                                        startIcon={
                                          applying === `${row.id}:${v.version}` ? (
                                            <CircularProgress size={12} color="inherit" />
                                          ) : (
                                            <ApplyIcon sx={{ fontSize: 15 }} />
                                          )
                                        }
                                        disabled={applying !== null}
                                        onClick={() => void apply(row.id, row.name, v.version)}
                                        sx={{ textTransform: 'none', fontSize: 12 }}
                                      >
                                        Apply v{v.version}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>,
                ];
              })}
          </TableBody>
        </Table>
      </TableContainer>

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        mappingCount={tableMappings.length}
        onSaved={(message) => {
          setSaveOpen(false);
          setNotice(message);
          void load();
        }}
        onError={setError}
        buildConfiguration={() => ({ version: 1, tableMappings })}
      />

      <ResolvedDialog resolved={inspecting} onClose={() => setInspecting(null)} />
    </Box>
  );
}

// --------------------------------------------------------------- dialogs ---

function SaveDialog({
  open,
  onClose,
  mappingCount,
  onSaved,
  onError,
  buildConfiguration,
}: {
  open: boolean;
  onClose: () => void;
  mappingCount: number;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  buildConfiguration: () => unknown;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createConfiguration({
        name: name.trim(),
        description: description.trim() || undefined,
        note: note.trim() || undefined,
        configuration: buildConfiguration(),
      });
      setName('');
      setDescription('');
      setNote('');
      onSaved(`Saved “${name.trim()}” as version 1.`);
    } catch (err) {
      onError(
        isApiError(err) && err.code === 'CONFLICT'
          ? `A configuration named “${name.trim()}” already exists. Pick another name.`
          : errorMessage(err),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Typography variant="h3Bold">Save configuration</Typography>
        <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
          {mappingCount} table mapping{mappingCount === 1 ? '' : 's'} from the editor, stored in the
          metadata database against your username.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          sx={{ mt: 1, mb: 2 }}
        />
        <TextField
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />
        <TextField
          label="Note for this version (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          fullWidth
          size="small"
          placeholder="e.g. added student_enrollment_details join"
        />
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="caption1">
            Database passwords are never stored in a configuration — saving is refused if one is
            found. Connections are referenced separately.
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResolvedDialog({
  resolved,
  onClose,
}: {
  resolved: ResolvedConfiguration | null;
  onClose: () => void;
}) {
  if (!resolved) return null;
  const mappings = resolved.engineConfig.tableMappings;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Typography variant="h3Bold">{resolved.configuration.name}</Typography>
        <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
          What the migration engine would actually execute for v{resolved.version.version}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip size="small" label={`stored shape: ${resolved.storedShape}`} variant="outlined" />
          <Chip size="small" label={`${mappings.length} table mappings`} variant="outlined" />
          <Chip
            size="small"
            label={`checksum ${resolved.checksum.slice(0, 12)}…`}
            variant="outlined"
          />
        </Box>

        {resolved.dropped.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body2Medium" sx={{ display: 'block' }}>
              {resolved.dropped.length} table mapping(s) cannot run
            </Typography>
            {resolved.dropped.map((d) => (
              <Typography key={d.index} variant="caption1" sx={{ display: 'block' }}>
                #{d.index}: {d.reason}
              </Typography>
            ))}
          </Alert>
        )}

        {resolved.warnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {resolved.warnings.map((w, i) => (
              <Typography key={i} variant="caption1" sx={{ display: 'block' }}>
                {w}
              </Typography>
            ))}
          </Alert>
        )}

        <Divider sx={{ mb: 1 }} />
        <TableContainer sx={{ maxHeight: 420 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Source table</TableCell>
                <TableCell>Target table</TableCell>
                <TableCell align="center">Columns</TableCell>
                <TableCell align="center">On conflict</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappings.map((m, i) => (
                <TableRow key={`${m.sourceTable}-${m.targetTable}-${i}`}>
                  <TableCell>
                    <Typography variant="caption1" sx={{ fontFamily: 'monospace' }}>
                      {m.sourceTable}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption1" sx={{ fontFamily: 'monospace' }}>
                      {m.targetTable}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">{m.columnMappings.length}</TableCell>
                  <TableCell align="center">
                    <Chip label={m.conflictStrategy} size="small" variant="outlined" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
