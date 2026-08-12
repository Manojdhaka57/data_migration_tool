import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Avatar, Menu, MenuItem, Typography, Chip, Divider, Button, Tooltip } from '@mui/material';
import { Logout as LogoutIcon, LoginOutlined as LoginIcon } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { countLocalMappings } from '../../utils/localStorage';
import { signOut, selectAuth } from './authSlice';

const ROLE_COLOR: Record<string, 'error' | 'primary' | 'default'> = {
  admin: 'error',
  operator: 'primary',
  viewer: 'default',
};

/** Signed-in identity in the app header, with a way out. */
export default function UserMenu() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, authEnabled, appDbConfigured, ready } = useAppSelector(selectAuth);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // With no metadata database there are no accounts at all, so offering to
  // sign in would only lead to a dead end.
  if (!ready || !appDbConfigured) return null;

  if (!user) {
    return (
      <Button
        size="small"
        startIcon={<LoginIcon fontSize="small" />}
        onClick={() => navigate('/login')}
        sx={{ textTransform: 'none', color: 'neutral.600' }}
      >
        Sign in
      </Button>
    );
  }

  const initial = user.username.charAt(0).toUpperCase();

  return (
    <>
      <Tooltip title={`${user.username} — ${user.role}`}>
        <Box
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: 'pointer',
            px: 1,
            py: 0.5,
            borderRadius: 2,
            '&:hover': { bgcolor: 'neutral.100' },
          }}
        >
          <Avatar sx={{ width: 28, height: 28, fontSize: 13, bgcolor: 'primary.main' }}>
            {initial}
          </Avatar>
          <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1 }}>
            <Typography variant="caption1Medium" sx={{ display: 'block', color: 'neutral.800' }}>
              {user.username}
            </Typography>
            <Typography variant="caption2" sx={{ color: 'neutral.400' }}>
              {user.role}
            </Typography>
          </Box>
        </Box>
      </Tooltip>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box sx={{ px: 2, py: 1.25, minWidth: 220 }}>
          <Typography variant="body2Medium" sx={{ display: 'block', color: 'neutral.800' }}>
            {user.username}
          </Typography>
          {user.email && (
            <Typography variant="caption2" sx={{ color: 'neutral.500' }}>
              {user.email}
            </Typography>
          )}
          <Box sx={{ mt: 1, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip label={user.role} size="small" color={ROLE_COLOR[user.role] ?? 'default'} />
            {!authEnabled && (
              // Otherwise the role chip reads as though it is protecting
              // something, and it is not.
              <Tooltip title="AUTH_ENABLED is false, so the server accepts unauthenticated requests. This role is informational.">
                <Chip label="not enforced" size="small" variant="outlined" />
              </Tooltip>
            )}
          </Box>
        </Box>
        <Divider />
        <MenuItem
          onClick={async () => {
            setAnchor(null);

            // Signing out wipes this browser, including any mappings that were
            // never saved to a configuration. Saved work is safe in the
            // database; unsaved work is not, so say so rather than discovering
            // it afterwards.
            const local = countLocalMappings();
            if (local > 0) {
              const confirmed = window.confirm(
                `Sign out and clear this browser?\n\n` +
                  `${local} table mapping(s) are stored locally and will be removed, along with ` +
                  `the saved connection settings.\n\n` +
                  `Anything already saved to a configuration is kept in the database. If these ` +
                  `are unsaved changes, cancel and use “Save changes” first.`,
              );
              if (!confirmed) return;
            }

            await dispatch(signOut());
            navigate('/login');
          }}
        >
          <LogoutIcon fontSize="small" sx={{ mr: 1.5, color: 'neutral.500' }} />
          <Typography variant="body2">Sign out</Typography>
        </MenuItem>
      </Menu>
    </>
  );
}
