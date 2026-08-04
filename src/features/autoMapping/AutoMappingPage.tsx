import { useRef, useCallback, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Tooltip,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Search as SearchIcon,
  TableChart as TableIcon,
  Link as LinkIcon,
  Code as CodeIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Storage as StorageIcon,
  ArrowForward as ArrowIcon,
  ContentCopy as CopyIcon,
  AutoFixHigh as AutoIcon,
  CompareArrows as CompareIcon,
  Warning as WarningIcon,
  CheckCircle as SuccessIcon,
  Info as InfoIcon,
  Folder as FolderIcon,
  FileUpload as FileUploadIcon,
  Sync as ApplyIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setSourceSchema,
  setTargetSchema,
  setSelectedMapping,
  setSearchQuery,
  setConfidenceFilter,
  clearAll,
  selectSourceFileName,
  selectTargetFileName,
  selectSourceLoaded,
  selectTargetLoaded,
  selectFilteredMappings,
  selectSelectedMapping,
  selectSelectedMappingData,
  selectMappingSummary,
  selectSearchQuery,
  selectConfidenceFilter,
  selectError,
  selectMappingResult,
} from './autoMappingSlice';
import { parseSQL } from '../../utils/sqlParser';
import { exportMappingToJSON } from '../../utils/autoMapper';
import { loadMappingsAndPersist } from '../mapping/mappingSlice';
import { v4 as uuidv4 } from 'uuid';
import type { TableMapping, ColumnMapping } from '../../types';

export const AutoMappingPage = () => {
  const dispatch = useAppDispatch();
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);
  
  const sourceFileName = useAppSelector(selectSourceFileName);
  const targetFileName = useAppSelector(selectTargetFileName);
  const sourceLoaded = useAppSelector(selectSourceLoaded);
  const targetLoaded = useAppSelector(selectTargetLoaded);
  const mappings = useAppSelector(selectFilteredMappings);
  const selectedMapping = useAppSelector(selectSelectedMapping);
  const selectedMappingData = useAppSelector(selectSelectedMappingData);
  const summary = useAppSelector(selectMappingSummary);
  const searchQuery = useAppSelector(selectSearchQuery);
  const confidenceFilter = useAppSelector(selectConfidenceFilter);
  const error = useAppSelector(selectError);
  const mappingResult = useAppSelector(selectMappingResult);
  
  // Get existing schema data from store
  const existingSourceSchema = useAppSelector((state) => state.sourceSchema.schema);
  const existingTargetSchema = useAppSelector((state) => state.targetSchema.schema);
  
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [jsonDialog, setJsonDialog] = useState(false);
  const [loadMode, setLoadMode] = useState<'file' | 'data'>('file');

  // Parse SQL file and convert to Table format
  const parseAndLoadFile = useCallback((file: File, type: 'source' | 'target') => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsedTables = parseSQL(content);
      
      // Convert parsed tables to Table format
      const tables = parsedTables.map(pt => ({
        name: pt.name,
        columns: pt.columns.map(col => {
          // Check if this column is a foreign key
          const fk = pt.foreignKeys.find(f => f.columnName === col.name);
          return {
            name: col.name,
            type: col.type,
            nullable: col.nullable,
            isPrimaryKey: col.isPrimaryKey,
            isForeignKey: !!fk,
            foreignKeyRef: fk ? { table: fk.referencesTable, column: fk.referencesColumn } : undefined,
          };
        }),
      }));
      
      if (type === 'source') {
        dispatch(setSourceSchema({ tables, fileName: file.name }));
      } else {
        dispatch(setTargetSchema({ tables, fileName: file.name }));
      }
    };
    reader.readAsText(file);
  }, [dispatch]);

  const handleSourceFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      parseAndLoadFile(file, 'source');
    }
  }, [parseAndLoadFile]);

  const handleTargetFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      parseAndLoadFile(file, 'target');
    }
  }, [parseAndLoadFile]);

  const handleDrop = useCallback((e: React.DragEvent, type: 'source' | 'target') => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.sql')) {
      parseAndLoadFile(file, type);
    }
  }, [parseAndLoadFile]);

  const handleCopyJSON = useCallback(() => {
    if (!mappingResult) return;
    const json = exportMappingToJSON(mappingResult);
    navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    setSnackbar({ open: true, message: 'Mapping JSON copied to clipboard!' });
  }, [mappingResult]);

  // Load from existing schema data
  const handleLoadFromData = useCallback(() => {
    if (existingSourceSchema && existingSourceSchema.tables.length > 0) {
      dispatch(setSourceSchema({ 
        tables: existingSourceSchema.tables, 
        fileName: `${existingSourceSchema.database} (from data)` 
      }));
    }
    if (existingTargetSchema && existingTargetSchema.tables.length > 0) {
      dispatch(setTargetSchema({ 
        tables: existingTargetSchema.tables, 
        fileName: `${existingTargetSchema.database} (from data)` 
      }));
    }
    setSnackbar({ open: true, message: 'Schemas loaded from existing data!' });
  }, [dispatch, existingSourceSchema, existingTargetSchema]);

  const hasExistingData = (existingSourceSchema?.tables?.length ?? 0) > 0 && 
                          (existingTargetSchema?.tables?.length ?? 0) > 0;

  // Convert auto-mapping result to TableMapping format for Schema Mapping page
  const convertToTableMappings = useCallback((): TableMapping[] => {
    if (!mappingResult) return [];

    return mappingResult.tableMappings.map(tm => {
      const columnMappings: ColumnMapping[] = tm.columnMatches
        .filter(cm => cm.matchType !== 'none' && cm.sourceColumn)
        .map(cm => ({
          id: uuidv4(),
          target: {
            table: tm.targetTable,
            column: cm.targetColumn,
          },
          mappingType: 'DIRECT' as const,
          source: {
            table: tm.sourceTable,
            column: cm.sourceColumn,
          },
        }));

      return {
        id: uuidv4(),
        sourceTables: [tm.sourceTable],
        targetTables: [tm.targetTable],
        columnMappings,
        description: `Auto-generated mapping (${tm.confidence} confidence, ${Math.round(tm.matchScore * 100)}% match)`,
      };
    });
  }, [mappingResult]);

  // Apply mappings to Schema Mapping page and persist to localStorage
  const handleApplyMappings = useCallback(() => {
    const tableMappings = convertToTableMappings();
    if (tableMappings.length > 0) {
      dispatch(loadMappingsAndPersist(tableMappings));
      setSnackbar({ open: true, message: `Applied ${tableMappings.length} table mappings and saved to localStorage!` });
    }
  }, [dispatch, convertToTableMappings]);

  // Download mapping config as JSON file
  const handleDownloadConfig = useCallback(() => {
    const tableMappings = convertToTableMappings();
    const config = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      sourceDatabase: sourceFileName,
      targetDatabase: targetFileName,
      tableMappings,
      metadata: {
        description: 'Auto-generated mapping configuration',
        generatedBy: 'DataMigrate Auto Mapping',
      },
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mappingConfig.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'Mapping config downloaded!' });
  }, [convertToTableMappings, sourceFileName, targetFileName]);

  const generateMappingJSON = useCallback(() => {
    if (!mappingResult) return '{}';
    return JSON.stringify(exportMappingToJSON(mappingResult), null, 2);
  }, [mappingResult]);

  const getConfidenceColor = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high': return { bg: 'success.100', text: 'success.700', icon: 'success.500' };
      case 'medium': return { bg: 'warning.100', text: 'warning.700', icon: 'warning.500' };
      case 'low': return { bg: 'error.100', text: 'error.700', icon: 'error.500' };
    }
  };

  const getMatchTypeColor = (matchType: string) => {
    switch (matchType) {
      case 'exact': return { bg: 'success.100', text: 'success.700' };
      case 'similar': return { bg: 'info.100', text: 'info.700' };
      case 'partial': return { bg: 'warning.100', text: 'warning.700' };
      default: return { bg: 'neutral.200', text: 'neutral.600' };
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', gap: 2, p: 2 }}>
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={sourceInputRef}
        onChange={handleSourceFileUpload}
        accept=".sql"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={targetInputRef}
        onChange={handleTargetFileUpload}
        accept=".sql"
        style={{ display: 'none' }}
      />
      
      {/* Left Panel - File Upload & Mapping List */}
      <Paper
        sx={{
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'primary.700',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AutoIcon sx={{ color: 'secondary.300' }} />
            <Typography variant="h6" sx={{ color: 'white.main' }}>
              Auto Mapping
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: 'neutral.400' }}>
            Upload old and new DB schemas to generate mappings
          </Typography>
          
          {(sourceLoaded || targetLoaded) && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              {mappingResult && (
                <>
                  <Tooltip title="Apply mappings to Schema Mapping page">
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<ApplyIcon />}
                      onClick={handleApplyMappings}
                      sx={{ 
                        bgcolor: 'success.main',
                        '&:hover': { bgcolor: 'success.600' },
                      }}
                    >
                      Apply
                    </Button>
                  </Tooltip>
                  <Tooltip title="Download mapping config file">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      onClick={handleDownloadConfig}
                      sx={{ 
                        color: 'info.300', 
                        borderColor: 'info.300',
                        '&:hover': { bgcolor: 'info.100', borderColor: 'info.400' },
                      }}
                    >
                      Download
                    </Button>
                  </Tooltip>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CodeIcon />}
                    onClick={() => setJsonDialog(true)}
                    sx={{ 
                      color: 'secondary.300', 
                      borderColor: 'secondary.300',
                      '&:hover': { bgcolor: 'secondary.100', borderColor: 'secondary.400' },
                    }}
                  >
                    JSON
                  </Button>
                </>
              )}
              <Button
                size="small"
                startIcon={<DeleteIcon />}
                onClick={() => dispatch(clearAll())}
                sx={{ color: 'error.300' }}
              >
                Clear All
              </Button>
            </Box>
          )}
        </Box>
        
        {/* Error */}
        {error && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Alert severity="error" sx={{ bgcolor: 'error.100', color: 'error.700' }}>
              {error}
            </Alert>
          </Box>
        )}
        
        {/* Mode Toggle */}
        {!sourceLoaded && !targetLoaded && (
          <Box sx={{ px: 2, pb: 2 }}>
            <ToggleButtonGroup
              value={loadMode}
              exclusive
              onChange={(_, value) => value && setLoadMode(value)}
              size="small"
              fullWidth
              sx={{ bgcolor: 'primary.600', borderRadius: 1 }}
            >
              <ToggleButton 
                value="file" 
                sx={{ 
                  color: 'neutral.300', 
                  gap: 1,
                  '&.Mui-selected': { color: 'white.main', bgcolor: 'primary.500' } 
                }}
              >
                <FileUploadIcon sx={{ fontSize: 18 }} />
                File Upload
              </ToggleButton>
              <ToggleButton 
                value="data" 
                disabled={!hasExistingData}
                sx={{ 
                  color: 'neutral.300', 
                  gap: 1,
                  '&.Mui-selected': { color: 'white.main', bgcolor: 'primary.500' },
                  '&.Mui-disabled': { color: 'neutral.600' },
                }}
              >
                <FolderIcon sx={{ fontSize: 18 }} />
                From Data
              </ToggleButton>
            </ToggleButtonGroup>
            {!hasExistingData && loadMode === 'file' && (
              <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block', mt: 0.5, textAlign: 'center' }}>
                Load schemas in Schema Mapping tab to enable "From Data"
              </Typography>
            )}
          </Box>
        )}
        
        {/* Data Loading Section */}
        {loadMode === 'data' && !sourceLoaded && !targetLoaded && (
          <Box sx={{ px: 2, py: 2 }}>
            <Paper
              sx={{
                p: 3,
                bgcolor: 'primary.600',
                border: 1,
                borderColor: 'primary.400',
                borderRadius: 2,
                textAlign: 'center',
              }}
            >
              <FolderIcon sx={{ fontSize: 48, color: 'info.300', mb: 2 }} />
              <Typography variant="body1Bold" sx={{ color: 'white.main', mb: 1 }}>
                Load from Existing Data
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.400', display: 'block', mb: 2 }}>
                Use schemas already loaded in the Schema Mapping tab
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mb: 2 }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="body2Medium" sx={{ color: 'success.300' }}>
                    {existingSourceSchema?.database || 'Source'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'neutral.400', display: 'block' }}>
                    {existingSourceSchema?.tables?.length || 0} tables
                  </Typography>
                </Box>
                <ArrowIcon sx={{ color: 'neutral.400', alignSelf: 'center' }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="body2Medium" sx={{ color: 'info.300' }}>
                    {existingTargetSchema?.database || 'Target'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'neutral.400', display: 'block' }}>
                    {existingTargetSchema?.tables?.length || 0} tables
                  </Typography>
                </Box>
              </Box>
              
              <Button
                variant="contained"
                startIcon={<AutoIcon />}
                onClick={handleLoadFromData}
                disabled={!hasExistingData}
                sx={{ 
                  bgcolor: 'secondary.main', 
                  '&:hover': { bgcolor: 'secondary.600' },
                }}
              >
                Generate Auto Mapping
              </Button>
            </Paper>
          </Box>
        )}
        
        {/* File Upload Sections - Show when in file mode OR when data is already loaded */}
        {(loadMode === 'file' || sourceLoaded || targetLoaded) && (
        <Box sx={{ px: 2, py: 2 }}>
          {/* Source (Old DB) Upload */}
          <Paper
            onDrop={(e) => handleDrop(e, 'source')}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !sourceLoaded && sourceInputRef.current?.click()}
            sx={{
              p: 2,
              mb: 2,
              bgcolor: sourceLoaded ? 'success.100' : 'primary.600',
              border: 2,
              borderStyle: 'dashed',
              borderColor: sourceLoaded ? 'success.400' : 'primary.400',
              borderRadius: 2,
              cursor: sourceLoaded ? 'default' : 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': !sourceLoaded ? {
                bgcolor: 'primary.500',
                borderColor: 'info.main',
              } : {},
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ 
                p: 1, 
                borderRadius: 1, 
                bgcolor: sourceLoaded ? 'success.200' : 'primary.500',
              }}>
                <StorageIcon sx={{ 
                  fontSize: 24, 
                  color: sourceLoaded ? 'success.700' : 'info.300',
                }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography 
                  variant="body2Medium" 
                  sx={{ color: sourceLoaded ? 'success.700' : 'white.main' }}
                >
                  {sourceLoaded ? 'Old Database Loaded' : 'Old Database (Source)'}
                </Typography>
                <Typography 
                  variant="caption" 
                  sx={{ color: sourceLoaded ? 'success.600' : 'neutral.400', display: 'block' }}
                >
                  {sourceLoaded ? sourceFileName : 'Drop SQL file or click to browse'}
                </Typography>
              </Box>
              {sourceLoaded && (
                <CheckIcon sx={{ color: 'success.600', fontSize: 20 }} />
              )}
            </Box>
          </Paper>
          
          {/* Target (New DB) Upload */}
          <Paper
            onDrop={(e) => handleDrop(e, 'target')}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !targetLoaded && targetInputRef.current?.click()}
            sx={{
              p: 2,
              bgcolor: targetLoaded ? 'info.100' : 'primary.600',
              border: 2,
              borderStyle: 'dashed',
              borderColor: targetLoaded ? 'info.400' : 'primary.400',
              borderRadius: 2,
              cursor: targetLoaded ? 'default' : 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': !targetLoaded ? {
                bgcolor: 'primary.500',
                borderColor: 'info.main',
              } : {},
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ 
                p: 1, 
                borderRadius: 1, 
                bgcolor: targetLoaded ? 'info.200' : 'primary.500',
              }}>
                <StorageIcon sx={{ 
                  fontSize: 24, 
                  color: targetLoaded ? 'info.700' : 'secondary.300',
                }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography 
                  variant="body2Medium" 
                  sx={{ color: targetLoaded ? 'info.700' : 'white.main' }}
                >
                  {targetLoaded ? 'New Database Loaded' : 'New Database (Target)'}
                </Typography>
                <Typography 
                  variant="caption" 
                  sx={{ color: targetLoaded ? 'info.600' : 'neutral.400', display: 'block' }}
                >
                  {targetLoaded ? targetFileName : 'Drop SQL file or click to browse'}
                </Typography>
              </Box>
              {targetLoaded && (
                <CheckIcon sx={{ color: 'info.600', fontSize: 20 }} />
              )}
            </Box>
          </Paper>
        </Box>
        )}
        
        {/* Summary Stats */}
        {summary && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <Paper sx={{ p: 1.5, bgcolor: 'info.100', borderRadius: 1 }}>
                <Typography variant="caption" sx={{ color: 'info.700' }}>Mapped Tables</Typography>
                <Typography variant="body1Bold" sx={{ color: 'info.600' }}>
                  {summary.mappedTables}/{summary.totalTargetTables}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: 'success.100', borderRadius: 1 }}>
                <Typography variant="caption" sx={{ color: 'success.700' }}>High Confidence</Typography>
                <Typography variant="body1Bold" sx={{ color: 'success.600' }}>{summary.highConfidenceMatches}</Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: 'warning.100', borderRadius: 1 }}>
                <Typography variant="caption" sx={{ color: 'warning.700' }}>Medium Confidence</Typography>
                <Typography variant="body1Bold" sx={{ color: 'warning.600' }}>{summary.mediumConfidenceMatches}</Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: 'error.100', borderRadius: 1 }}>
                <Typography variant="caption" sx={{ color: 'error.700' }}>Low Confidence</Typography>
                <Typography variant="body1Bold" sx={{ color: 'error.600' }}>{summary.lowConfidenceMatches}</Typography>
              </Paper>
            </Box>
          </Box>
        )}
        
        {/* Search & Filter */}
        {mappingResult && (
          <Box sx={{ px: 2, pb: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search mappings..."
              value={searchQuery}
              onChange={(e) => dispatch(setSearchQuery(e.target.value))}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'neutral.400', fontSize: 20 }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                mb: 1,
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'primary.600',
                  color: 'white.main',
                  '& fieldset': { borderColor: 'primary.500' },
                  '&:hover fieldset': { borderColor: 'primary.400' },
                  '&.Mui-focused fieldset': { borderColor: 'info.main' },
                },
              }}
            />
            <ToggleButtonGroup
              value={confidenceFilter}
              exclusive
              onChange={(_, value) => value && dispatch(setConfidenceFilter(value))}
              size="small"
              fullWidth
              sx={{ bgcolor: 'primary.600', borderRadius: 1 }}
            >
              <ToggleButton value="all" sx={{ color: 'neutral.300', '&.Mui-selected': { color: 'white.main', bgcolor: 'primary.500' } }}>
                All
              </ToggleButton>
              <ToggleButton value="high" sx={{ color: 'success.400', '&.Mui-selected': { color: 'success.300', bgcolor: 'primary.500' } }}>
                High
              </ToggleButton>
              <ToggleButton value="medium" sx={{ color: 'warning.400', '&.Mui-selected': { color: 'warning.300', bgcolor: 'primary.500' } }}>
                Med
              </ToggleButton>
              <ToggleButton value="low" sx={{ color: 'error.400', '&.Mui-selected': { color: 'error.300', bgcolor: 'primary.500' } }}>
                Low
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
        
        {/* Mapping List */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 2, pb: 2 }}>
          {mappings.map((mapping) => {
            const colors = getConfidenceColor(mapping.confidence);
            return (
              <Paper
                key={mapping.targetTable}
                onClick={() => dispatch(setSelectedMapping(mapping.targetTable))}
                sx={{
                  p: 1.5,
                  mb: 1,
                  bgcolor: selectedMapping === mapping.targetTable ? colors.bg : 'primary.600',
                  border: 1,
                  borderColor: selectedMapping === mapping.targetTable ? colors.text : 'primary.500',
                  borderRadius: 1,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    bgcolor: selectedMapping === mapping.targetTable ? colors.bg : 'primary.500',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <CompareIcon sx={{ 
                    fontSize: 18, 
                    color: selectedMapping === mapping.targetTable ? colors.icon : 'info.300',
                  }} />
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: selectedMapping === mapping.targetTable ? colors.text : 'neutral.300',
                        maxWidth: '40%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mapping.sourceTable}
                    </Typography>
                    <ArrowIcon sx={{ fontSize: 14, color: 'neutral.400' }} />
                    <Typography 
                      variant="body2Medium" 
                      sx={{ 
                        color: selectedMapping === mapping.targetTable ? 'primary.700' : 'white.main',
                        maxWidth: '40%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mapping.targetTable}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    label={`${mapping.mappedColumnsCount}/${mapping.totalTargetColumns} cols`}
                    sx={{ 
                      height: 20, 
                      fontSize: '10px',
                      bgcolor: selectedMapping === mapping.targetTable ? 'primary.200' : 'primary.500',
                      color: selectedMapping === mapping.targetTable ? 'primary.700' : 'neutral.300',
                    }}
                  />
                  <Chip
                    size="small"
                    label={mapping.confidence}
                    sx={{ 
                      height: 20, 
                      fontSize: '10px',
                      bgcolor: colors.bg,
                      color: colors.text,
                      textTransform: 'uppercase',
                    }}
                  />
                  <Chip
                    size="small"
                    label={`${Math.round(mapping.matchScore * 100)}%`}
                    sx={{
                      height: 20,
                      fontSize: '10px',
                      bgcolor: selectedMapping === mapping.targetTable ? 'info.200' : 'info.100',
                      color: 'info.700',
                    }}
                  />
                </Box>
              </Paper>
            );
          })}
          
          {mappings.length === 0 && mappingResult && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <InfoIcon sx={{ fontSize: 40, color: 'neutral.500', mb: 1 }} />
              <Typography variant="body2" sx={{ color: 'neutral.400' }}>
                No mappings match your filter
              </Typography>
            </Box>
          )}
          
          {!mappingResult && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <UploadIcon sx={{ fontSize: 40, color: 'neutral.500', mb: 1 }} />
              <Typography variant="body2" sx={{ color: 'neutral.400' }}>
                Upload both database schemas to generate mappings
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
      
      {/* Right Panel - Mapping Details */}
      <Paper
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'primary.800',
          overflow: 'hidden',
        }}
      >
        {selectedMappingData ? (
          <>
            {/* Header */}
            <Box sx={{ p: 3, borderBottom: 1, borderColor: 'primary.600' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <TableIcon sx={{ fontSize: 32, color: 'info.300' }} />
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1" sx={{ color: 'neutral.300' }}>
                        {selectedMappingData.sourceTable}
                      </Typography>
                      <ArrowIcon sx={{ color: 'neutral.400' }} />
                      <Typography variant="h5" sx={{ color: 'white.main' }}>
                        {selectedMappingData.targetTable}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'neutral.400' }}>
                      {selectedMappingData.matchType.toUpperCase()} match • {Math.round(selectedMappingData.matchScore * 100)}% score
                    </Typography>
                  </Box>
                </Box>
                <Tooltip title="Copy mapping as JSON">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CopyIcon />}
                    onClick={handleCopyJSON}
                    sx={{ 
                      borderColor: 'secondary.300', 
                      color: 'secondary.300',
                      '&:hover': { bgcolor: 'secondary.100', color: 'secondary.700' },
                    }}
                  >
                    Copy JSON
                  </Button>
                </Tooltip>
              </Box>
              
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  label={`${selectedMappingData.mappedColumnsCount} Mapped Columns`}
                  sx={{ bgcolor: 'info.100', color: 'info.700' }}
                />
                <Chip
                  label={`${selectedMappingData.totalTargetColumns - selectedMappingData.mappedColumnsCount} Unmapped`}
                  sx={{ bgcolor: 'warning.100', color: 'warning.700' }}
                />
                <Chip
                  icon={
                    selectedMappingData.confidence === 'high' ? <SuccessIcon /> :
                    selectedMappingData.confidence === 'medium' ? <WarningIcon /> :
                    <CloseIcon />
                  }
                  label={`${selectedMappingData.confidence.toUpperCase()} Confidence`}
                  sx={{ 
                    bgcolor: getConfidenceColor(selectedMappingData.confidence).bg, 
                    color: getConfidenceColor(selectedMappingData.confidence).text,
                    '& .MuiChip-icon': { color: getConfidenceColor(selectedMappingData.confidence).icon },
                  }}
                />
              </Box>
            </Box>
            
            {/* Column Mappings Table */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
              <Paper sx={{ bgcolor: 'primary.700', overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
                  <Typography variant="body1Bold" sx={{ color: 'white.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinkIcon sx={{ color: 'secondary.300' }} />
                    Column Mappings
                  </Typography>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'primary.600' }}>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Source Column</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600, width: 50 }}></TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Target Column</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Match Type</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Type Compatible</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedMappingData.columnMatches.map((match, idx) => {
                        const matchColors = getMatchTypeColor(match.matchType);
                        return (
                          <TableRow 
                            key={match.targetColumn}
                            sx={{ 
                              bgcolor: idx % 2 === 0 ? 'primary.700' : 'primary.600',
                              '&:hover': { bgcolor: 'primary.500' },
                            }}
                          >
                            <TableCell sx={{ color: match.sourceColumn ? 'white.main' : 'neutral.500' }}>
                              {match.sourceColumn || '—'}
                            </TableCell>
                            <TableCell>
                              <ArrowIcon sx={{ fontSize: 16, color: 'neutral.400' }} />
                            </TableCell>
                            <TableCell sx={{ color: 'white.main' }}>
                              {match.targetColumn}
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={match.matchType.toUpperCase()}
                                sx={{
                                  height: 22,
                                  fontSize: '10px',
                                  bgcolor: matchColors.bg,
                                  color: matchColors.text,
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              {match.matchType !== 'none' ? (
                                match.typeCompatible ? (
                                  <CheckIcon sx={{ color: 'success.400', fontSize: 18 }} />
                                ) : (
                                  <Tooltip title="Type mismatch - may need transformation">
                                    <WarningIcon sx={{ color: 'warning.400', fontSize: 18 }} />
                                  </Tooltip>
                                )
                              ) : (
                                <CloseIcon sx={{ color: 'neutral.500', fontSize: 18 }} />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
              
              {/* Progress Bar */}
              <Box sx={{ mt: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="caption" sx={{ color: 'neutral.400' }}>
                    Mapping Coverage
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'neutral.300' }}>
                    {selectedMappingData.mappedColumnsCount}/{selectedMappingData.totalTargetColumns} columns
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(selectedMappingData.mappedColumnsCount / selectedMappingData.totalTargetColumns) * 100}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: 'primary.600',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 4,
                      bgcolor: selectedMappingData.confidence === 'high' ? 'success.main' :
                               selectedMappingData.confidence === 'medium' ? 'warning.main' : 'error.main',
                    },
                  }}
                />
              </Box>
            </Box>
          </>
        ) : (
          <Box sx={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center', 
            justifyContent: 'center',
            color: 'neutral.500',
          }}>
            <CompareIcon sx={{ fontSize: 64, mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              {mappingResult ? 'Select a Mapping' : 'No Mappings Generated'}
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.600' }}>
              {mappingResult 
                ? 'Click on a mapping from the list to view column details'
                : 'Upload both old and new database SQL files to auto-generate mappings'
              }
            </Typography>
          </Box>
        )}
      </Paper>
      
      {/* JSON Export Dialog */}
      <Dialog 
        open={jsonDialog} 
        onClose={() => setJsonDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'primary.700',
            color: 'white.main',
          }
        }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'primary.500', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CodeIcon sx={{ color: 'secondary.300' }} />
          Export Auto-Mapping as JSON
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" sx={{ color: 'neutral.300', mb: 2 }}>
            Copy this JSON to use in your migration configuration. Includes all table and column mappings with confidence scores.
          </Typography>
          
          {/* Quick Copy Button */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<CopyIcon />}
              onClick={handleCopyJSON}
              sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.600' } }}
            >
              Copy All Mappings
            </Button>
          </Box>
          
          {/* JSON Preview */}
          <Paper
            sx={{
              p: 2,
              bgcolor: 'primary.800',
              borderRadius: 1,
              maxHeight: 400,
              overflow: 'auto',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <Tooltip title="Copy to clipboard">
                <IconButton 
                  size="small" 
                  onClick={handleCopyJSON}
                  sx={{ color: 'neutral.300' }}
                >
                  <CopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography
              component="pre"
              sx={{
                fontFamily: 'monospace',
                fontSize: '11px',
                color: 'success.300',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                m: 0,
              }}
            >
              {generateMappingJSON()}
            </Typography>
          </Paper>
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'primary.500', p: 2 }}>
          <Button onClick={() => setJsonDialog(false)} sx={{ color: 'neutral.300' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Snackbar for copy feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ open: false, message: '' })}
        message={snackbar.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};
