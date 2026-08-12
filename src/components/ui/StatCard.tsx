/**
 * The summary card from the top row of the reference dashboard: a tinted icon
 * tile, an optional change badge in the corner, a large figure, and a label.
 *
 * The badge is optional for a reason. The reference shows "+12%" on every card,
 * but a trend only exists once there is something to compare against — so
 * `delta` is nullable and NOTHING is rendered when it is absent. A first
 * migration run shows no badge rather than "+0%", which would be a claim the
 * data does not support.
 */
import { Box, Card, CardContent, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import IconTile, { type TileTone } from './IconTile';

export interface StatCardProps {
  icon: ReactNode;
  tone?: TileTone;
  /** The figure, already formatted (e.g. "1,216,004" or "14m 23s"). */
  value: string;
  label: string;
  /** Formatted change, e.g. "+8.2%". Omit when there is nothing to compare. */
  delta?: string | null;
  /** Whether the change is an improvement — decides green versus red. */
  deltaGood?: boolean;
  /** Explains what the delta is measured against. */
  deltaTooltip?: string;
}

export default function StatCard({
  icon,
  tone = 'indigo',
  value,
  label,
  delta,
  deltaGood = true,
  deltaTooltip = 'Compared with the previous run',
}: StatCardProps) {
  return (
    <Card>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <IconTile tone={tone}>{icon}</IconTile>
          {delta && (
            <Tooltip title={deltaTooltip}>
              <Typography
                variant="caption1Medium"
                sx={{ color: deltaGood ? 'success.main' : 'error.main', fontWeight: 600 }}
              >
                {delta}
              </Typography>
            </Tooltip>
          )}
        </Box>
        <Typography sx={{ mt: 2, fontSize: 26, fontWeight: 700, color: 'neutral.800', lineHeight: 1.2 }}>
          {value}
        </Typography>
        <Typography variant="body2" sx={{ color: 'neutral.500' }}>
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}
