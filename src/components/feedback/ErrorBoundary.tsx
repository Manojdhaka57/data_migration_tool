import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Paper, Typography, Button, Alert } from '@mui/material';
import { Refresh as RefreshIcon, ContentCopy as CopyIcon } from '@mui/icons-material';

/**
 * Catches render errors so a crash shows something actionable.
 *
 * Without this, a single bad render anywhere blanks the entire tool — no
 * message, no sidebar, nothing but a white page. That failure mode is
 * indistinguishable from "the feature was never added", which makes it
 * genuinely hard to diagnose. Wrapping each route means a crash in one page
 * leaves the rest of the app usable.
 */
interface Props {
  children: ReactNode;
  /** Shown in the message so the user knows which page failed. */
  label?: string;
}

interface State {
  error: Error | null;
  componentStack: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console trace — it is what a developer will actually read.
    console.error('Render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private copy = () => {
    const { error, componentStack } = this.state;
    void navigator.clipboard?.writeText(
      `${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}\n\nComponent stack:${componentStack}`,
    );
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
        <Paper elevation={0} sx={{ p: 3, border: 1, borderColor: 'error.light', borderRadius: 2 }}>
          <Typography variant="h3Bold" sx={{ display: 'block', color: 'error.main', mb: 0.5 }}>
            {this.props.label ? `${this.props.label} failed to render` : 'Something went wrong'}
          </Typography>
          <Typography variant="body2" sx={{ color: 'neutral.600', mb: 2 }}>
            The rest of the app still works — use the sidebar to go elsewhere.
          </Typography>

          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body2Medium" sx={{ display: 'block' }}>
              {error.name}: {error.message}
            </Typography>
          </Alert>

          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: 260,
              overflow: 'auto',
              bgcolor: 'neutral.50',
              border: 1,
              borderColor: 'neutral.200',
              borderRadius: 1,
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.stack ?? '(no stack)'}
            {this.state.componentStack}
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => window.location.reload()}
              sx={{ textTransform: 'none' }}
            >
              Reload
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CopyIcon fontSize="small" />}
              onClick={this.copy}
              sx={{ textTransform: 'none' }}
            >
              Copy error
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }
}
