/**
 * The `Records / Duration / Success Rate` triple that sits inside every
 * pipeline card in the reference dashboard: a small grey label above a value.
 */
import { Box, Typography } from '@mui/material';

export interface Metric {
  label: string;
  value: string;
  /** Colours the value — used for success rate and failure counts. */
  tone?: 'default' | 'success' | 'error' | 'warning';
}

const TONE_COLOR: Record<NonNullable<Metric['tone']>, string> = {
  default: 'neutral.800',
  success: 'success.main',
  error: 'error.main',
  warning: 'warning.main',
};

export default function MetricRow({ metrics }: { metrics: Metric[] }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
        gap: 2,
      }}
    >
      {metrics.map((metric) => (
        <Box key={metric.label} sx={{ minWidth: 0 }}>
          <Typography variant="caption2" sx={{ color: 'neutral.400', display: 'block' }}>
            {metric.label}
          </Typography>
          <Typography
            variant="body2Medium"
            sx={{ color: TONE_COLOR[metric.tone ?? 'default'], fontWeight: 600 }}
            noWrap
          >
            {metric.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
