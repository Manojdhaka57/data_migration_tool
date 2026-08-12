import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAppSelector } from '../../store';
import { selectAuth } from './authSlice';

/**
 * Gate for everything that is not the login screen.
 *
 * Two deliberate exceptions, both about not locking the tool out of itself:
 *
 *  1. While AUTH_ENABLED is false the server enforces nothing, so demanding a
 *     login here would only be a curtain — and would block every existing user
 *     for no security gain.
 *  2. If the metadata database is unreachable there are no accounts to check
 *     against, so requiring a login would make the app permanently unusable
 *     rather than degraded. The pre-existing pages still work without it.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, authEnabled, appDbConfigured, appDbReachable, ready } = useAppSelector(selectAuth);
  const location = useLocation();

  // Deciding before the startup probe answers would flash the login screen at
  // users of an install that never required one.
  if (!ready) {
    return (
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          bgcolor: 'neutral.100',
        }}
      >
        <CircularProgress size={28} />
        <Typography variant="body2" sx={{ color: 'neutral.500' }}>
          Starting…
        </Typography>
      </Box>
    );
  }

  const authIsReal = authEnabled && appDbConfigured && appDbReachable;
  if (authIsReal && !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
