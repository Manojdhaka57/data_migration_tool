import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  MenuItem,
  Alert,
  Chip,
  Divider,
  CircularProgress,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Save as SaveIcon,
  Cable as TestIcon,
  RestartAlt as ResetIcon,
  Visibility as ShowIcon,
  VisibilityOff as HideIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Storage as DatabaseIcon,
} from '@mui/icons-material';
import {
  type ConnectionSettings,
  type DbConnectionForm,
  type ResolvedConfig,
  type ResolvedConnection,
  type ProbeResult,
  type ValueSource,
  emptyConnectionSettings,
  loadConnectionSettings,
  saveConnectionSettings,
  clearStoredConnectionSettings,
  applyConnectionSettings,
  fetchResolvedConfig,
  testConnectionSettings,
  resetServerConnectionSettings,
  hasAnyOverride,
} from './connectionConfig';
import { API_BASE_URL } from '../../api/config';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Where an effective value came from, rendered as a small colour-coded chip. */
const SOURCE_CHIP: Record<ValueSource, { label: string; color: string; bg: string }> = {
  ui: { label: 'from UI', color: 'success.main', bg: 'success.100' },
  env: { label: 'from .env', color: '#2D6079', bg: 'primary.100' },
  default: { label: 'default', color: 'neutral.500', bg: 'neutral.100' },
};

const FIELDS: { key: keyof DbConnectionForm; label: string; placeholder: string }[] = [
  { key: 'host', label: 'Host', placeholder: 'localhost' },
  { key: 'port', label: 'Port', placeholder: '5432' },
  { key: 'database', label: 'Database', placeholder: 'my_database' },
  { key: 'user', label: 'User', placeholder: 'postgres' },
];

function OriginChip({ from }: { from?: ValueSource }) {
  if (!from) return null;
  const style = SOURCE_CHIP[from];
  return (
    <Chip
      label={style.label}
      size="small"
      sx={{
        height: 18,
        fontSize: '10px',
        color: style.color,
        bgcolor: style.bg,
        border: `1px solid ${style.color}33`,
      }}
    />
  );
}

interface ConnectionFormProps {
  title: string;
  accent: string;
  form: DbConnectionForm;
  resolved?: ResolvedConnection;
  probe?: ProbeResult;
  onChange: (field: keyof DbConnectionForm, value: string) => void;
}

function ConnectionForm({ title, accent, form, resolved, probe, onChange }: ConnectionFormProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Paper sx={{ p: 2.5, flex: 1, minWidth: 320, borderTop: `3px solid ${accent}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <DatabaseIcon sx={{ color: accent, fontSize: 20 }} />
        <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
          {title}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'neutral.500' }}>
        Leave a field blank to use the value from .env
      </Typography>

      {probe && (
        <Alert
          severity={probe.success ? 'success' : 'error'}
          icon={probe.success ? <SuccessIcon fontSize="inherit" /> : <ErrorIcon fontSize="inherit" />}
          sx={{ mt: 1.5, py: 0.25 }}
        >
          {probe.success
            ? `${probe.message}${probe.tables !== undefined ? ` — ${probe.tables} tables` : ''}`
            : probe.error}
        </Alert>
      )}

      <Divider sx={{ my: 2 }} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Database Type
            </Typography>
            <OriginChip from={resolved?.type?.from} />
          </Box>
          <TextField
            select
            fullWidth
            size="small"
            value={form.type}
            onChange={(e) => onChange('type', e.target.value)}
          >
            <MenuItem value="">
              <em>Use .env ({resolved?.type?.value ?? 'postgresql'})</em>
            </MenuItem>
            <MenuItem value="postgresql">PostgreSQL</MenuItem>
            <MenuItem value="mysql">MySQL</MenuItem>
          </TextField>
        </Box>

        {FIELDS.map(({ key, label, placeholder }) => (
          <Box key={key}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {label}
              </Typography>
              <OriginChip from={resolved?.[key]?.from} />
            </Box>
            <TextField
              fullWidth
              size="small"
              value={form[key]}
              placeholder={resolved?.[key]?.value ?? placeholder}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </Box>
        ))}

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Password
            </Typography>
            <OriginChip from={resolved?.password?.from} />
          </Box>
          <TextField
            fullWidth
            size="small"
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            placeholder={resolved?.password?.value ? '•••••••• (from .env)' : 'password'}
            onChange={(e) => onChange('password', e.target.value)}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowPassword((v) => !v)} edge="end">
                    {showPassword ? <HideIcon fontSize="small" /> : <ShowIcon fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Box>

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              SSL
            </Typography>
            <OriginChip from={resolved?.ssl?.from} />
          </Box>
          <TextField
            select
            fullWidth
            size="small"
            value={form.ssl}
            onChange={(e) => onChange('ssl', e.target.value)}
          >
            <MenuItem value="">
              <em>Use .env ({resolved?.ssl?.value ?? 'off'})</em>
            </MenuItem>
            <MenuItem value="true">Enabled</MenuItem>
            <MenuItem value="false">Disabled</MenuItem>
          </TextField>
        </Box>
      </Box>
    </Paper>
  );
}

export default function ConnectionSettingsPage() {
  const [settings, setSettings] = useState<ConnectionSettings>(emptyConnectionSettings);
  const [resolved, setResolved] = useState<ResolvedConfig | null>(null);
  const [probes, setProbes] = useState<{ source?: ProbeResult; target?: ProbeResult }>({});
  const [busy, setBusy] = useState<'test' | 'save' | 'reset' | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);

  const refreshResolved = useCallback(async () => {
    try {
      setResolved(await fetchResolvedConfig());
    } catch {
      setBanner({
        kind: 'error',
        text: `Could not reach the API server at ${API_BASE_URL}. Locally, start it with \`npm run migrate:server\`.`,
      });
    }
  }, []);

  useEffect(() => {
    const saved = loadConnectionSettings();
    if (saved) setSettings(saved);
    void refreshResolved();
  }, [refreshResolved]);

  const updateField = (role: 'source' | 'target') => (field: keyof DbConnectionForm, value: string) =>
    setSettings((prev) => ({ ...prev, [role]: { ...prev[role], [field]: value } }));

  const handleTest = async () => {
    setBusy('test');
    setBanner(null);
    setProbes({});
    try {
      const result = await testConnectionSettings(settings);
      setProbes(result);
      const bothOk = result.source?.success && result.target?.success;
      setBanner({
        kind: bothOk ? 'success' : 'error',
        text: bothOk
          ? 'Both connections succeeded. These settings are not saved yet — click "Save & Apply".'
          : 'One or more connections failed. See the details on each panel.',
      });
    } catch (err: unknown) {
      setBanner({ kind: 'error', text: errorMessage(err, 'Test failed') });
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setBusy('save');
    setBanner(null);
    try {
      setResolved(await applyConnectionSettings(settings));
      saveConnectionSettings(settings);
      setBanner({
        kind: 'success',
        text: 'Saved. Every schema read and migration will now use these settings.',
      });
    } catch (err: unknown) {
      setBanner({ kind: 'error', text: errorMessage(err, 'Could not save settings') });
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Clear all connection settings entered here and fall back to .env?')) return;
    setBusy('reset');
    setBanner(null);
    setProbes({});
    try {
      setResolved(await resetServerConnectionSettings());
      clearStoredConnectionSettings();
      setSettings(emptyConnectionSettings());
      setBanner({ kind: 'info', text: 'Cleared. Values now come from .env only.' });
    } catch (err: unknown) {
      setBanner({ kind: 'error', text: errorMessage(err, 'Could not reset settings') });
    } finally {
      setBusy(null);
    }
  };

  const overriding = hasAnyOverride(settings);

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 3, bgcolor: 'neutral.100' }}>
      <Alert severity="info" sx={{ mb: 2 }}>
        Values entered here <strong>override .env</strong>. Anything left blank falls back to the
        matching <code>SOURCE_DB_*</code> / <code>TARGET_DB_*</code> variable, so you can run the tool
        with no .env file at all. Settings are kept in this browser and re-sent automatically when the
        API server restarts.
      </Alert>

      {banner && (
        <Alert severity={banner.kind} sx={{ mb: 2 }} onClose={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <ConnectionForm
          title="Source Database"
          accent="#2D6079"
          form={settings.source}
          resolved={resolved?.source}
          probe={probes.source}
          onChange={updateField('source')}
        />
        <ConnectionForm
          title="Target Database"
          accent="#356B43"
          form={settings.target}
          resolved={resolved?.target}
          probe={probes.target}
          onChange={updateField('target')}
        />
      </Box>

      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="h3Bold" sx={{ color: 'primary.main', mb: 0.5 }}>
          Encryption Key
        </Typography>
        <Typography variant="caption" sx={{ color: 'neutral.500' }}>
          Used for columns marked "encrypt" in a mapping. Falls back to <code>ENCRYPTION_KEY</code> in .env.
        </Typography>
        <TextField
          fullWidth
          size="small"
          sx={{ mt: 1.5 }}
          type={showEncryptionKey ? 'text' : 'password'}
          value={settings.encryptionKey}
          placeholder="base64-encoded key — leave blank to use .env"
          onChange={(e) => setSettings((prev) => ({ ...prev, encryptionKey: e.target.value }))}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShowEncryptionKey((v) => !v)} edge="end">
                  {showEncryptionKey ? <HideIcon fontSize="small" /> : <ShowIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Paper>

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          startIcon={busy === 'test' ? <CircularProgress size={16} /> : <TestIcon />}
          onClick={handleTest}
          disabled={busy !== null}
        >
          Test Connection
        </Button>
        <Button
          variant="contained"
          startIcon={busy === 'save' ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={busy !== null}
        >
          Save &amp; Apply
        </Button>
        <Tooltip title="Remove everything entered here and use .env alone">
          <span>
            <Button
              variant="text"
              color="error"
              startIcon={busy === 'reset' ? <CircularProgress size={16} /> : <ResetIcon />}
              onClick={handleReset}
              disabled={busy !== null}
            >
              Reset to .env
            </Button>
          </span>
        </Tooltip>
        {overriding && (
          <Chip
            size="small"
            label="Overriding .env"
            sx={{
              height: 22,
              fontSize: '11px',
              color: 'success.main',
              bgcolor: 'success.100',
              border: '1px solid #D3E9DA',
            }}
          />
        )}
      </Box>
    </Box>
  );
}
