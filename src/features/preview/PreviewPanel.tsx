import { useMemo, useCallback, useState, useEffect } from 'react';
import { 
  Box, Typography, Button, Tabs, Tab, Paper, Chip, Divider,
  Alert, AlertTitle
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import { useAppSelector, useAppDispatch } from '../../store';
import { selectSourceSchema } from '../sourceSchema/sourceSchemaSlice';
import { selectTargetSchema } from '../targetSchema/targetSchemaSlice';
import { selectTableMappings, selectValidationErrors, setValidationErrors } from '../mapping/mappingSlice';
import { generateMigrationConfig, downloadMigrationConfig, copyConfigToClipboard, validateAllMappings } from '../../utils';
import type { MigrationConfig, ValidationError } from '../../types';

export function PreviewPanel() {
  const dispatch = useAppDispatch();
  const sourceSchema = useAppSelector(selectSourceSchema);
  const targetSchema = useAppSelector(selectTargetSchema);
  const tableMappings = useAppSelector(selectTableMappings);
  const validationErrors = useAppSelector(selectValidationErrors);
  
  const [copied, setCopied] = useState(false);
  const [copiedMappings, setCopiedMappings] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const migrationConfig = useMemo<MigrationConfig | null>(() => {
    if (!sourceSchema || !targetSchema) return null;
    return generateMigrationConfig(sourceSchema, targetSchema, tableMappings);
  }, [sourceSchema, targetSchema, tableMappings]);

  const mappingsJson = useMemo(() => {
    return JSON.stringify({ tableMappings }, null, 2);
  }, [tableMappings]);

  useEffect(() => {
    const errors = validateAllMappings(tableMappings, targetSchema);
    dispatch(setValidationErrors(errors));
  }, [tableMappings, targetSchema, dispatch]);

  const handleDownload = useCallback(() => {
    if (migrationConfig) {
      downloadMigrationConfig(migrationConfig);
    }
  }, [migrationConfig]);

  const handleCopy = useCallback(async () => {
    if (migrationConfig) {
      const success = await copyConfigToClipboard(migrationConfig);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [migrationConfig]);

  const handleCopyMappings = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mappingsJson);
      setCopiedMappings(true);
      setTimeout(() => setCopiedMappings(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  }, [mappingsJson]);

  const handleDownloadMappings = useCallback(() => {
    const blob = new Blob([mappingsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mappingConfig.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [mappingsJson]);

  const errorCount = validationErrors.filter(e => e.type === 'error').length;
  const warningCount = validationErrors.filter(e => e.type === 'warning').length;

  if (!sourceSchema || !targetSchema) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', bgcolor: 'white.main' }}>
        <Typography variant="h1" sx={{ mb: 2, color: 'neutral.300' }}>📋</Typography>
        <Typography variant="h3Medium" sx={{ color: 'primary.main', mb: 1 }}>No Preview Available</Typography>
        <Typography variant="body1" sx={{ color: 'neutral.500' }}>
          Load both schemas to see the migration config preview
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'white.main' }}>
      {/* Header with Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'neutral.200' }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, val) => setActiveTab(val)}
          sx={{ 
            minHeight: 40,
            '& .MuiTab-root': { 
              color: 'neutral.500', 
              minHeight: 40, 
              textTransform: 'none'
            },
            '& .Mui-selected': { color: 'primary.main' }
          }}
        >
          <Tab label={<Typography variant="body2Medium">Mappings JSON</Typography>} />
          <Tab label={<Typography variant="body2Medium">Full Config</Typography>} />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2Medium">Validation</Typography>
                {(errorCount > 0 || warningCount > 0) && (
                  <Chip 
                    label={errorCount + warningCount}
                    size="small"
                    sx={{ 
                      bgcolor: errorCount > 0 ? 'secondary.main' : 'warning.main',
                      color: 'white.main',
                      height: 16,
                      fontSize: (theme) => theme.typography.supportingText.fontSize,
                      '& .MuiChip-label': { px: 0.5 }
                    }}
                  />
                )}
              </Box>
            } 
          />
        </Tabs>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: 'neutral.100', borderBottom: 1, borderColor: 'neutral.200' }}>
              <Typography variant="body2Medium" sx={{ color: 'warning.main' }}>
                📁 Copy to update src/data/mappingConfig.json
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button 
                  size="small" 
                  startIcon={<ContentCopyIcon />}
                  onClick={handleCopyMappings}
                  sx={{ color: 'primary.main' }}
                >
                  <Typography variant="caption1Medium">{copiedMappings ? 'Copied!' : 'Copy'}</Typography>
                </Button>
                <Button 
                  size="small" 
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadMappings}
                  sx={{ bgcolor: 'warning.main', color: 'white.main', '&:hover': { bgcolor: 'warning.600' } }}
                >
                  <Typography variant="caption1Medium">Download</Typography>
                </Button>
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
              <Paper sx={{ bgcolor: 'neutral.100', p: 1.5, border: 1, borderColor: 'neutral.200' }}>
                <Typography 
                  component="pre" 
                  variant="caption1"
                  sx={{ 
                    fontFamily: 'monospace', 
                    color: 'primary.main',
                    whiteSpace: 'pre',
                    m: 0,
                    lineHeight: 1.5
                  }}
                >
                  {mappingsJson}
                </Typography>
              </Paper>
            </Box>
          </Box>
        )}

        {activeTab === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: 'neutral.100', borderBottom: 1, borderColor: 'neutral.200' }}>
              <Typography variant="body2Medium" sx={{ color: 'secondary.main' }}>
                Full Migration Config
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button 
                  size="small" 
                  startIcon={<ContentCopyIcon />}
                  onClick={handleCopy}
                  sx={{ color: 'primary.main' }}
                >
                  <Typography variant="caption1Medium">{copied ? 'Copied!' : 'Copy'}</Typography>
                </Button>
                <Button 
                  size="small" 
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownload}
                  sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.dark' } }}
                >
                  <Typography variant="caption1Medium">Download</Typography>
                </Button>
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
              <Paper sx={{ bgcolor: 'neutral.100', p: 1.5, border: 1, borderColor: 'neutral.200' }}>
                <Typography 
                  component="pre" 
                  variant="caption1"
                  sx={{ 
                    fontFamily: 'monospace', 
                    color: 'primary.main',
                    whiteSpace: 'pre',
                    m: 0,
                    lineHeight: 1.5
                  }}
                >
                  {migrationConfig ? JSON.stringify(migrationConfig, null, 2) : 'No configuration generated'}
                </Typography>
              </Paper>
            </Box>
          </Box>
        )}

        {activeTab === 2 && (
          <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
            {validationErrors.length === 0 ? (
              <Alert 
                severity="success" 
                icon={<CheckCircleIcon sx={{ color: 'primary.main' }} />}
                sx={{ bgcolor: 'primary.100', color: 'primary.main', border: 1, borderColor: 'primary.main' }}
              >
                <AlertTitle>
                  <Typography variant="body1Bold" sx={{ color: 'primary.main' }}>All Validations Passed</Typography>
                </AlertTitle>
                <Typography variant="body2" sx={{ color: 'primary.main' }}>Your mapping configuration is valid and ready to export.</Typography>
              </Alert>
            ) : (
              <>
                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                  {errorCount > 0 && (
                    <Chip 
                      icon={<ErrorIcon sx={{ color: 'white.main !important' }} />}
                      label={`${errorCount} error(s)`}
                      sx={{ bgcolor: 'secondary.main', color: 'white.main' }}
                    />
                  )}
                  {warningCount > 0 && (
                    <Chip 
                      icon={<WarningIcon sx={{ color: 'white.main !important' }} />}
                      label={`${warningCount} warning(s)`}
                      sx={{ bgcolor: 'warning.main', color: 'white.main' }}
                    />
                  )}
                </Box>
                {validationErrors.map((error, index) => (
                  <ValidationErrorItem key={index} error={error} />
                ))}
              </>
            )}
          </Box>
        )}
      </Box>

      {/* Footer Stats */}
      <Divider sx={{ borderColor: 'neutral.200' }} />
      <Box sx={{ p: 1.5, display: 'flex', gap: 3, bgcolor: 'neutral.100' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography variant="body1Bold" sx={{ color: 'primary.main' }}>{tableMappings.length}</Typography>
          <Typography variant="body2" sx={{ color: 'neutral.500' }}>table mappings</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography variant="body1Bold" sx={{ color: 'primary.main' }}>
            {tableMappings.reduce((acc, tm) => acc + tm.columnMappings.length, 0)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'neutral.500' }}>column mappings</Typography>
        </Box>
      </Box>
    </Box>
  );
}

function ValidationErrorItem({ error }: { error: ValidationError }) {
  const isError = error.type === 'error';
  
  return (
    <Paper 
      sx={{ 
        display: 'flex', 
        alignItems: 'flex-start', 
        gap: 1.5, 
        p: 1.5, 
        mb: 1,
        bgcolor: isError ? 'secondary.100' : 'warning.100',
        border: 1,
        borderColor: isError ? 'secondary.main' : 'warning.main'
      }}
    >
      {isError ? (
        <ErrorIcon sx={{ fontSize: 18, color: 'secondary.main' }} />
      ) : (
        <WarningIcon sx={{ fontSize: 18, color: 'warning.main' }} />
      )}
      <Box>
        <Typography variant="caption1" sx={{ color: 'neutral.600', fontFamily: 'monospace', display: 'block' }}>
          {error.field}
        </Typography>
        <Typography variant="body2" sx={{ color: isError ? 'secondary.main' : 'warning.main' }}>
          {error.message}
        </Typography>
      </Box>
    </Paper>
  );
}
