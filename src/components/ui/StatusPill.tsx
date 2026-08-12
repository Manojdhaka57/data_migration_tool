/**
 * The status pill from the reference dashboard: Running / Completed / Failed.
 *
 * Replaces scattered inline `<Chip sx={{ bgcolor: 'rgba(74,222,128,0.15)' }}>`
 * so a status means the same colour everywhere. The union is deliberately the
 * set of states the migration engine actually produces (see TableResult.status
 * in migrationResultsSlice) plus the two the UI adds for tables it has not
 * reached yet.
 */
import { Box, Chip } from '@mui/material';
import {
  PlayArrow as RunningIcon,
  CheckCircle as CompletedIcon,
  ErrorOutline as FailedIcon,
  RemoveCircleOutline as SkippedIcon,
  HourglassEmpty as QueuedIcon,
  WarningAmber as PartialIcon,
} from '@mui/icons-material';

export type PillStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'skipped'
  | 'queued'
  | 'idle';

const STATUS: Record<PillStatus, { label: string; bg: string; fg: string; Icon: typeof RunningIcon }> = {
  running: { label: 'Running', bg: 'success.100', fg: 'success.main', Icon: RunningIcon },
  completed: { label: 'Completed', bg: 'info.100', fg: 'info.main', Icon: CompletedIcon },
  failed: { label: 'Failed', bg: 'error.100', fg: 'error.main', Icon: FailedIcon },
  partial: { label: 'Partial', bg: 'warning.100', fg: 'warning.main', Icon: PartialIcon },
  skipped: { label: 'Skipped', bg: 'neutral.100', fg: 'neutral.500', Icon: SkippedIcon },
  queued: { label: 'Queued', bg: 'neutral.100', fg: 'neutral.500', Icon: QueuedIcon },
  idle: { label: 'Idle', bg: 'neutral.100', fg: 'neutral.500', Icon: QueuedIcon },
};

interface StatusPillProps {
  status: PillStatus;
  /** Overrides the default word, e.g. "Finished with failures". */
  label?: string;
  size?: 'small' | 'medium';
}

export default function StatusPill({ status, label, size = 'small' }: StatusPillProps) {
  const { label: defaultLabel, bg, fg, Icon } = STATUS[status];
  return (
    <Chip
      size={size}
      icon={
        <Box sx={{ display: 'flex', color: `${fg} !important`, ml: 0.75 }}>
          <Icon sx={{ fontSize: 15 }} />
        </Box>
      }
      label={label ?? defaultLabel}
      sx={{ bgcolor: bg, color: fg, '& .MuiChip-label': { pl: 0.75, pr: 1.25 } }}
    />
  );
}
