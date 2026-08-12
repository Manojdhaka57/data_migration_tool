/**
 * The tinted rounded-square that sits beside every title in the reference
 * dashboard. One implementation so the tint/radius pairing is consistent
 * instead of being re-invented with inline `rgba(...)` at each call site.
 */
import { Box } from '@mui/material';
import type { ReactNode } from 'react';

export type TileTone = 'indigo' | 'green' | 'blue' | 'violet' | 'amber' | 'red' | 'neutral';

const TONE: Record<TileTone, { bg: string; fg: string }> = {
  indigo: { bg: 'primary.100', fg: 'primary.main' },
  green: { bg: 'success.100', fg: 'success.main' },
  blue: { bg: 'info.100', fg: 'info.main' },
  violet: { bg: 'secondary.100', fg: 'secondary.main' },
  amber: { bg: 'warning.100', fg: 'warning.main' },
  red: { bg: 'error.100', fg: 'error.main' },
  neutral: { bg: 'neutral.100', fg: 'neutral.500' },
};

interface IconTileProps {
  children: ReactNode;
  tone?: TileTone;
  size?: number;
}

export default function IconTile({ children, tone = 'indigo', size = 40 }: IconTileProps) {
  const { bg, fg } = TONE[tone];
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size >= 40 ? 2.5 : 2,
        bgcolor: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '& .MuiSvgIcon-root': { fontSize: Math.round(size * 0.5) },
      }}
    >
      {children}
    </Box>
  );
}
