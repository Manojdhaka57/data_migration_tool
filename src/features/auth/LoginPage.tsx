import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  IconButton,
  InputAdornment,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  Chip,
  Divider,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  LockOutlined as LockIcon,
  Storage as DbIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { signIn, clearAuthError, selectAuth } from './authSlice';

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loggingIn, error, authEnabled, appDbConfigured, appDbReachable, ready, sessionExpired } =
    useAppSelector(selectAuth);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  const returnTo = (location.state as LocationState | null)?.from ?? '/read-schema';

  // Already signed in — nothing to do here.
  useEffect(() => {
    if (user) navigate(returnTo, { replace: true });
  }, [user, navigate, returnTo]);

  useEffect(() => () => { dispatch(clearAuthError()); }, [dispatch]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    const result = await dispatch(signIn({ username: username.trim(), password, remember }));
    if (signIn.fulfilled.match(result)) navigate(returnTo, { replace: true });
  };

  // Sign-in needs the metadata database; without it there are no user accounts
  // to check against. Say so plainly instead of failing on submit.
  const dbUnavailable = ready && (!appDbConfigured || !appDbReachable);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 55%, #0C4A6E 100%)',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 3, sm: 4 },
          borderRadius: 3,
          bgcolor: 'white.main',
          boxShadow: '0 24px 48px rgba(2, 6, 23, 0.35)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.main',
              color: 'white.main',
            }}
          >
            <LockIcon fontSize="small" />
          </Box>
          <Box>
            <Typography variant="h3Bold" component="h1" sx={{ display: 'block', color: 'neutral.800' }}>
              Sign in
            </Typography>
            <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
              DataMigrate — ERP Data Migration
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 2.5 }} />

        {sessionExpired && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Your session expired. Sign in to continue — any unsaved work in this browser is kept.
          </Alert>
        )}

        {dbUnavailable && (
          <Alert severity="warning" icon={<DbIcon fontSize="small" />} sx={{ mb: 2 }}>
            <Typography variant="body2Medium" sx={{ display: 'block' }}>
              The metadata database is not available
            </Typography>
            <Typography variant="caption1" sx={{ color: 'neutral.600' }}>
              User accounts live there. Set <code>APP_DB_*</code> in <code>.env</code> and run{' '}
              <code>npm run appdb:up</code>.
            </Typography>
          </Alert>
        )}

        {ready && !authEnabled && !dbUnavailable && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="caption1">
              Authentication is <strong>not being enforced</strong> yet
              (<code>AUTH_ENABLED=false</code>). Signing in records who you are, but the API still
              accepts unauthenticated requests.
            </Typography>
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => dispatch(clearAuthError())}>
            {error}
          </Alert>
        )}

        {/*
          Autofill is deliberately off. `autocomplete="off"` is only a hint —
          browsers routinely override it on login forms — so the field `name`s
          are also non-standard, since that is what the heuristics key on.
          Note a password manager extension can still offer to fill; nothing in
          the page can prevent that.
        */}
        <Box component="form" onSubmit={handleSubmit} noValidate autoComplete="off">
          <TextField
            label="Username"
            name="erp-login-identifier"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            autoFocus
            autoComplete="off"
            disabled={loggingIn}
            size="small"
            sx={{ mb: 2 }}
            slotProps={{
              htmlInput: {
                autoComplete: 'off',
                autoCorrect: 'off',
                autoCapitalize: 'none',
                spellCheck: false,
                'data-lpignore': 'true',
                'data-1p-ignore': 'true',
              },
            }}
          />

          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            name="erp-login-secret"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            autoComplete="off"
            disabled={loggingIn}
            size="small"
            slotProps={{
              htmlInput: {
                autoComplete: 'off',
                autoCorrect: 'off',
                autoCapitalize: 'none',
                spellCheck: false,
                'data-lpignore': 'true',
                'data-1p-ignore': 'true',
              },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword((v) => !v)}
                      edge="end"
                      size="small"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Checkbox
                size="small"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={loggingIn}
              />
            }
            label={
              <Typography variant="caption1" sx={{ color: 'neutral.600' }}>
                Keep me signed in on this browser
              </Typography>
            }
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loggingIn || !username.trim() || !password}
            startIcon={loggingIn ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ mt: 2, textTransform: 'none', py: 1.2 }}
          >
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </Button>
        </Box>

        <Typography
          variant="caption2"
          sx={{ display: 'block', mt: 2.5, color: 'neutral.400', textAlign: 'center' }}
        >
          Sessions last 12 hours. Without “keep me signed in” the session ends when you close the
          browser.
        </Typography>

        {/* Kept out of production builds so demo credentials never ship. */}
        {import.meta.env.DEV && (
          <Box sx={{ mt: 2.5, pt: 2, borderTop: 1, borderColor: 'neutral.200' }}>
            <Typography variant="caption2" sx={{ color: 'neutral.400', display: 'block', mb: 1 }}>
              Development accounts — password <code>password123</code>
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {[
                { name: 'admin', role: 'admin' },
                { name: 'manoj', role: 'admin' },
                { name: 'operator', role: 'operator' },
                { name: 'sam', role: 'operator' },
                { name: 'viewer', role: 'viewer' },
                { name: 'ro', role: 'viewer' },
              ].map((account) => (
                <Chip
                  key={account.name}
                  label={`${account.name} · ${account.role}`}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setUsername(account.name);
                    setPassword('password123');
                  }}
                  sx={{ cursor: 'pointer', fontSize: 11 }}
                />
              ))}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
