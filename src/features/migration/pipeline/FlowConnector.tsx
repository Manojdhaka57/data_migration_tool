/**
 * One arrow between two pipeline stages, carrying animated batch markers.
 *
 * Each dot corresponds to a batch the worker actually reported. Travel is a CSS
 * animation; EXISTENCE is data. When no batches arrive, the connector is a
 * static arrow — a stalled pipeline looks stalled, which is the point.
 */
import { Box } from '@mui/material';
import { pulseSize, type BatchPulse } from './batchPulse';

interface FlowConnectorProps {
  pulses: BatchPulse[];
  onPulseEnd: (id: number) => void;
  batchSize: number | null;
  /** Dots only render while the run is live. */
  active: boolean;
  /** Colour the flow red once the run has failures. */
  tone?: 'normal' | 'error';
  /** Stagger between stages, so a batch appears to travel down the pipeline. */
  delayMs?: number;
}

/** Matches the CSS animation duration below. */
const TRAVEL_MS = 900;

export default function FlowConnector({
  pulses,
  onPulseEnd,
  batchSize,
  active,
  tone = 'normal',
  delayMs = 0,
}: FlowConnectorProps) {
  // Blue-Gray for data in flight — bright enough to read against the
  // light rail, where Dark Slate Gray would sink into it. Red on failure.
  const color = tone === 'error' ? '#B03B33' : '#62A8CB';
  const idle = '#E9E9E7';

  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        flex: 1,
        minWidth: 48,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        // The keyframes are declared here rather than globally so this
        // component carries everything it needs.
        '@keyframes flowTravel': {
          '0%': { left: '0%', opacity: 0 },
          '12%': { opacity: 1 },
          '88%': { opacity: 1 },
          '100%': { left: '100%', opacity: 0 },
        },
        '@media (prefers-reduced-motion: reduce)': {
          '& .flow-dot': { animation: 'none', display: 'none' },
        },
      }}
    >
      {/* The rail */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 8,
          height: 2,
          borderRadius: 1,
          bgcolor: active ? `${color}55` : idle,
        }}
      />
      {/* Arrow head */}
      <Box
        sx={{
          position: 'absolute',
          right: 0,
          width: 0,
          height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: `8px solid ${active ? color : idle}`,
        }}
      />

      {active &&
        pulses.map((pulse) => {
          const size = pulseSize(pulse.rows, batchSize);
          return (
            <Box
              key={pulse.id}
              className="flow-dot"
              onAnimationEnd={() => onPulseEnd(pulse.id)}
              sx={{
                position: 'absolute',
                width: size,
                height: size,
                borderRadius: '50%',
                bgcolor: color,
                boxShadow: `0 0 8px ${color}`,
                animation: `flowTravel ${TRAVEL_MS}ms linear ${delayMs}ms forwards`,
                left: 0,
              }}
            />
          );
        })}
    </Box>
  );
}
