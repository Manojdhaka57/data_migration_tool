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
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Search as SearchIcon,
  TableChart as TableIcon,
  Key as KeyIcon,
  Link as LinkIcon,
  Code as CodeIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Storage as StorageIcon,
  DataObject as DataIcon,
  ContentCopy as CopyIcon,
  Input as SourceIcon,
  Output as TargetIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setSQL,
  setTables,
  setSelectedTable,
  setSearchQuery,
  setError,
  clearSQL,
  selectFilteredTables,
  selectFileName,
  selectIsLoaded,
  selectSelectedTable,
  selectSelectedTableData,
  selectError,
  selectSearchQuery,
  selectTableStats,
  selectTables,
} from './sqlAnalyzerSlice';
import { parseSQL, parsePgDump, validateSQL } from '../../utils/sqlParser';
import { setSchema as setSourceSchema } from '../sourceSchema/sourceSchemaSlice';
import { setSchema as setTargetSchema } from '../targetSchema/targetSchemaSlice';
import type { DatabaseSchema, Table as SchemaTable, Column } from '../../types';

export const SQLAnalyzerPage = () => {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const tables = useAppSelector(selectFilteredTables);
  const fileName = useAppSelector(selectFileName);
  const isLoaded = useAppSelector(selectIsLoaded);
  const selectedTable = useAppSelector(selectSelectedTable);
  const selectedTableData = useAppSelector(selectSelectedTableData);
  const error = useAppSelector(selectError);
  const searchQuery = useAppSelector(selectSearchQuery);
  const stats = useAppSelector(selectTableStats);
  
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [jsonDialog, setJsonDialog] = useState(false);
  const [updateDialog, setUpdateDialog] = useState(false);
  
  // Get all tables (not just filtered) for updating schema
  const allTables = useAppSelector(selectTables);
  
  // Convert SQL tables to DatabaseSchema format
  const convertToSchema = useCallback((dbName: string): DatabaseSchema => {
    const schemaTables: SchemaTable[] = allTables.map(table => ({
      name: table.name,
      columns: table.columns.map(col => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        defaultValue: col.defaultValue,
        isPrimaryKey: col.isPrimaryKey,
        isForeignKey: col.isForeignKey,
        foreignKeyRef: col.foreignKeyRef,
      } as Column)),
    }));
    
    return {
      database: dbName,
      tables: schemaTables,
    };
  }, [allTables]);
  
  // Update source or target schema with parsed data
  const handleUpdateSchema = useCallback((target: 'source' | 'target') => {
    const dbName = fileName?.replace(/\.sql$/i, '') || 'parsed_db';
    const schema = convertToSchema(target === 'source' ? `${dbName}_source` : `${dbName}_target`);
    
    if (target === 'source') {
      dispatch(setSourceSchema(schema));
    } else {
      dispatch(setTargetSchema(schema));
    }
    
    setSnackbar({ 
      open: true, 
      message: `Updated ${target === 'source' ? 'Source' : 'Target'} Schema with ${allTables.length} tables!` 
    });
    setUpdateDialog(false);
  }, [dispatch, convertToSchema, fileName, allTables.length]);
  
  // Generate JSON for tables
  const generateTableJSON = useCallback((tableName?: string) => {
    const targetTables = tableName 
      ? tables.filter(t => t.name === tableName)
      : tables;
    
    const jsonData = {
      database: "parsed_db",
      tables: targetTables.map(table => ({
        name: table.name,
        columns: table.columns.map(col => {
          const columnDef: Record<string, unknown> = {
            name: col.name,
            type: col.type,
          };
          if (!col.nullable) columnDef.nullable = false;
          if (col.isPrimaryKey) columnDef.isPrimaryKey = true;
          if (col.isForeignKey) columnDef.isForeignKey = true;
          if (col.foreignKeyRef) columnDef.foreignKeyRef = col.foreignKeyRef;
          if (col.isUnique) columnDef.isUnique = true;
          if (col.autoIncrement) columnDef.autoIncrement = true;
          if (col.defaultValue) columnDef.defaultValue = col.defaultValue;
          return columnDef;
        }),
        primaryKey: table.primaryKey.length > 0 ? table.primaryKey : undefined,
        foreignKeys: table.foreignKeys.length > 0 ? table.foreignKeys.map(fk => ({
          column: fk.columnName,
          references: {
            table: fk.referencesTable,
            column: fk.referencesColumn,
          },
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
        })) : undefined,
      })),
    };
    
    return JSON.stringify(jsonData, null, 2);
  }, [tables]);
  
  const handleCopyJSON = useCallback((tableName?: string) => {
    const json = generateTableJSON(tableName);
    navigator.clipboard.writeText(json).then(() => {
      setSnackbar({ 
        open: true, 
        message: tableName ? `Copied ${tableName} JSON to clipboard!` : 'Copied all tables JSON to clipboard!' 
      });
    }).catch(() => {
      setSnackbar({ open: true, message: 'Failed to copy to clipboard' });
    });
  }, [generateTableJSON]);
  
  // Extract printable strings from binary content (like Unix 'strings' command)
  const extractStrings = useCallback((buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const strings: string[] = [];
    let currentString = '';
    
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      // Printable ASCII characters (32-126) plus newline (10) and tab (9)
      if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 9) {
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length >= 4) { // Minimum string length
          strings.push(currentString);
        }
        currentString = '';
      }
    }
    if (currentString.length >= 4) {
      strings.push(currentString);
    }
    
    return strings.join('\n');
  }, []);
  
  // Check if content is PostgreSQL custom dump format
  const isPgDumpFormat = useCallback((buffer: ArrayBuffer): boolean => {
    const bytes = new Uint8Array(buffer);
    // PostgreSQL custom dump magic bytes: "PGDMP"
    return bytes[0] === 0x50 && bytes[1] === 0x47 && bytes[2] === 0x44 && 
           bytes[3] === 0x4D && bytes[4] === 0x50;
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // First read as ArrayBuffer to detect file type
    const binaryReader = new FileReader();
    binaryReader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      
      if (isPgDumpFormat(buffer)) {
        // PostgreSQL custom dump format (binary)
        const extractedContent = extractStrings(buffer);
        
        dispatch(setSQL({ sql: extractedContent, fileName: `${file.name} (pg_dump)` }));
        
        // Try pg_dump parser first, then fall back to standard parser
        let parsedTables = parsePgDump(extractedContent);
        if (parsedTables.length === 0) {
          parsedTables = parseSQL(extractedContent);
        }
        
        if (parsedTables.length === 0) {
          dispatch(setError('No CREATE TABLE statements found in the PostgreSQL dump file'));
          return;
        }
        
        dispatch(setTables(parsedTables));
        setSnackbar({ 
          open: true, 
          message: `Loaded PostgreSQL dump: ${parsedTables.length} tables extracted` 
        });
      } else {
        // Regular text file - read as text
        const textReader = new FileReader();
        textReader.onload = (te) => {
          const content = te.target?.result as string;
          
          // Validate SQL
          const validation = validateSQL(content);
          if (!validation.isValid) {
            dispatch(setError(validation.error || 'Invalid SQL file'));
            return;
          }
          
          // Parse SQL
          dispatch(setSQL({ sql: content, fileName: file.name }));
          const parsedTables = parseSQL(content);
          
          if (parsedTables.length === 0) {
            dispatch(setError('No CREATE TABLE statements found in the file'));
            return;
          }
          
          dispatch(setTables(parsedTables));
        };
        
        textReader.onerror = () => {
          dispatch(setError('Failed to read the file'));
        };
        
        textReader.readAsText(file);
      }
    };
    
    binaryReader.onerror = () => {
      dispatch(setError('Failed to read the file'));
    };
    
    binaryReader.readAsArrayBuffer(file);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [dispatch, isPgDumpFormat, extractStrings]);
  
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    // Accept .sql files, text files, and any file (for pg_dump binary)
    if (file) {
      const input = fileInputRef.current;
      if (input) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, []);
  
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  return (
    <Box sx={{ 
      display: 'flex', 
      height: '100%', 
      bgcolor: 'primary.800',
      background: (theme) => `linear-gradient(135deg, ${theme.palette.primary[800]} 0%, ${theme.palette.primary[700]} 50%, ${theme.palette.primary[800]} 100%)`,
    }}>
      {/* Left Panel - Table List */}
      <Box sx={{ 
        width: 320, 
        borderRight: 1, 
        borderColor: 'primary.500', 
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'primary.700',
      }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
          <Typography variant="h3Bold" sx={{ color: 'white.main', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <StorageIcon sx={{ color: 'info.main' }} />
            SQL Analyzer
          </Typography>
          <Typography variant="caption1" sx={{ color: 'neutral.300' }}>
            Upload SQL file to analyze table structures
          </Typography>
        </Box>
        
        {/* File Upload */}
        <Box sx={{ p: 2 }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".sql,.txt,.dump,.backup,*"
            style={{ display: 'none' }}
          />
          <Paper
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              p: 3,
              border: 2,
              borderStyle: 'dashed',
              borderColor: 'info.main',
              bgcolor: 'primary.600',
              borderRadius: 2,
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s ease',
              '&:hover': {
                bgcolor: 'primary.500',
                borderColor: 'info.400',
              },
            }}
          >
            <UploadIcon sx={{ fontSize: 40, color: 'info.main', mb: 1 }} />
            <Typography variant="body2Medium" sx={{ color: 'white.main' }}>
              {fileName || 'Drop SQL file here'}
            </Typography>
            <Typography variant="caption1" sx={{ color: 'neutral.400', display: 'block', mt: 0.5 }}>
              or click to browse
            </Typography>
          </Paper>
          
          {fileName && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              {isLoaded && (
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
                  Export JSON
                </Button>
              )}
              <Button
                size="small"
                startIcon={<DeleteIcon />}
                onClick={() => dispatch(clearSQL())}
                sx={{ color: 'error.300' }}
              >
                Clear
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
        
        {/* Stats */}
        {isLoaded && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <Paper sx={{ p: 1.5, bgcolor: 'info.100', borderRadius: 1 }}>
                <Typography variant="caption1" sx={{ color: 'info.700' }}>Tables</Typography>
                <Typography variant="body1Bold" sx={{ color: 'info.600' }}>{stats.totalTables}</Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: 'success.100', borderRadius: 1 }}>
                <Typography variant="caption1" sx={{ color: 'success.700' }}>Columns</Typography>
                <Typography variant="body1Bold" sx={{ color: 'success.600' }}>{stats.totalColumns}</Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: 'warning.100', borderRadius: 1 }}>
                <Typography variant="caption1" sx={{ color: 'warning.700' }}>Primary Keys</Typography>
                <Typography variant="body1Bold" sx={{ color: 'warning.600' }}>{stats.totalPrimaryKeys}</Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: 'secondary.100', borderRadius: 1 }}>
                <Typography variant="caption1" sx={{ color: 'secondary.700' }}>Foreign Keys</Typography>
                <Typography variant="body1Bold" sx={{ color: 'secondary.600' }}>{stats.totalForeignKeys}</Typography>
              </Paper>
            </Box>
            
            {/* Update Schema Button */}
            <Button
              fullWidth
              variant="contained"
              startIcon={<StorageIcon />}
              onClick={() => setUpdateDialog(true)}
              sx={{ 
                mt: 2,
                bgcolor: 'success.main',
                color: 'white.main',
                fontWeight: 600,
                '&:hover': { bgcolor: 'success.600' },
              }}
            >
              Update Schema
            </Button>
          </Box>
        )}
        
        {/* Search */}
        {isLoaded && (
          <Box sx={{ px: 2, pb: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search tables..."
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
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'primary.600',
                  color: 'white.main',
                  '& fieldset': { borderColor: 'primary.500' },
                  '&:hover fieldset': { borderColor: 'primary.400' },
                  '&.Mui-focused fieldset': { borderColor: 'info.main' },
                },
              }}
            />
          </Box>
        )}
        
        {/* Table List */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 2, pb: 2 }}>
          {tables.map((table) => (
            <Paper
              key={table.name}
              onClick={() => dispatch(setSelectedTable(table.name))}
              sx={{
                p: 1.5,
                mb: 1,
                bgcolor: selectedTable === table.name ? 'info.100' : 'primary.600',
                border: 1,
                borderColor: selectedTable === table.name ? 'info.main' : 'primary.500',
                borderRadius: 1,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: selectedTable === table.name ? 'info.200' : 'primary.500',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <TableIcon sx={{ 
                  fontSize: 18, 
                  color: selectedTable === table.name ? 'info.600' : 'info.main' 
                }} />
                <Typography 
                  variant="body2Medium" 
                  sx={{ 
                    color: selectedTable === table.name ? 'primary.700' : 'white.main',
                    wordBreak: 'break-all',
                  }}
                >
                  {table.name}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  size="small"
                  label={`${table.columns.length} cols`}
                  sx={{ 
                    height: 20, 
                    fontSize: '10px',
                    bgcolor: selectedTable === table.name ? 'primary.200' : 'primary.500',
                    color: selectedTable === table.name ? 'primary.700' : 'neutral.300',
                  }}
                />
                {table.primaryKey.length > 0 && (
                  <Chip
                    size="small"
                    icon={<KeyIcon sx={{ fontSize: '12px !important' }} />}
                    label="PK"
                    sx={{ 
                      height: 20, 
                      fontSize: '10px',
                      bgcolor: 'warning.100',
                      color: 'warning.700',
                      '& .MuiChip-icon': { color: 'warning.500' },
                    }}
                  />
                )}
                {table.foreignKeys.length > 0 && (
                  <Chip
                    size="small"
                    icon={<LinkIcon sx={{ fontSize: '12px !important' }} />}
                    label={`${table.foreignKeys.length} FK`}
                    sx={{ 
                      height: 20, 
                      fontSize: '10px',
                      bgcolor: 'secondary.100',
                      color: 'secondary.700',
                      '& .MuiChip-icon': { color: 'secondary.500' },
                    }}
                  />
                )}
              </Box>
            </Paper>
          ))}
          
          {isLoaded && tables.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <TableIcon sx={{ fontSize: 48, color: 'neutral.400', mb: 1 }} />
              <Typography variant="body2" sx={{ color: 'neutral.400' }}>
                {searchQuery ? 'No tables match your search' : 'No tables found'}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      
      {/* Main Content - Table Details */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {selectedTableData ? (
          <Box>
            {/* Table Header */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <TableIcon sx={{ fontSize: 32, color: 'info.main' }} />
                  <Typography variant="h2Bold" sx={{ color: 'white.main' }}>
                    {selectedTableData.name}
                  </Typography>
                </Box>
                <Tooltip title="Copy table as JSON">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CopyIcon />}
                    onClick={() => handleCopyJSON(selectedTableData.name)}
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
                  label={`${selectedTableData.columns.length} Columns`}
                  sx={{ bgcolor: 'info.100', color: 'info.700' }}
                />
                {selectedTableData.primaryKey.length > 0 && (
                  <Chip
                    icon={<KeyIcon />}
                    label={`Primary Key: ${selectedTableData.primaryKey.join(', ')}`}
                    sx={{ 
                      bgcolor: 'warning.100', 
                      color: 'warning.700',
                      '& .MuiChip-icon': { color: 'warning.500' },
                    }}
                  />
                )}
                {selectedTableData.foreignKeys.length > 0 && (
                  <Chip
                    icon={<LinkIcon />}
                    label={`${selectedTableData.foreignKeys.length} Foreign Keys`}
                    sx={{ 
                      bgcolor: 'secondary.100', 
                      color: 'secondary.700',
                      '& .MuiChip-icon': { color: 'secondary.500' },
                    }}
                  />
                )}
              </Box>
            </Box>
            
            {/* Columns Table */}
            <Paper sx={{ mb: 3, bgcolor: 'primary.700', overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
                <Typography variant="body1Bold" sx={{ color: 'white.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DataIcon sx={{ color: 'info.main' }} />
                  Columns
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'primary.600' }}>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600, width: 40 }}>#</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Column Name</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600, width: 80 }} align="center">Nullable</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600, width: 80 }} align="center">PK</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600, width: 80 }} align="center">FK</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>FK Reference</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Default</TableCell>
                      <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Attributes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedTableData.columns.map((col, idx) => (
                      <TableRow 
                        key={col.name}
                        sx={{ 
                          bgcolor: col.isPrimaryKey 
                            ? 'warning.900' 
                            : col.isForeignKey 
                              ? 'secondary.900' 
                              : idx % 2 === 0 ? 'primary.700' : 'primary.600',
                          '&:hover': { bgcolor: 'primary.500' },
                          borderLeft: col.isPrimaryKey ? 3 : col.isForeignKey ? 3 : 0,
                          borderColor: col.isPrimaryKey ? 'warning.main' : col.isForeignKey ? 'secondary.main' : 'transparent',
                        }}
                      >
                        <TableCell sx={{ color: 'neutral.400', fontWeight: 500 }}>{idx + 1}</TableCell>
                        <TableCell sx={{ color: 'white.main' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {col.isPrimaryKey && (
                              <Tooltip title="Primary Key">
                                <KeyIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                              </Tooltip>
                            )}
                            {col.isForeignKey && (
                              <Tooltip title="Foreign Key">
                                <LinkIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
                              </Tooltip>
                            )}
                            <Box sx={{ fontFamily: 'monospace', fontWeight: col.isPrimaryKey || col.isForeignKey ? 600 : 400 }}>
                              {col.name}
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={col.type}
                            sx={{ 
                              height: 22, 
                              fontSize: '11px',
                              bgcolor: 'info.100',
                              color: 'info.700',
                              fontFamily: 'monospace',
                            }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          {col.nullable ? (
                            <CheckIcon sx={{ color: 'success.main', fontSize: 18 }} />
                          ) : (
                            <Tooltip title="NOT NULL">
                              <CloseIcon sx={{ color: 'error.main', fontSize: 18 }} />
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {col.isPrimaryKey ? (
                            <Chip size="small" label="PK" sx={{ height: 20, fontSize: '10px', bgcolor: 'warning.100', color: 'warning.700', fontWeight: 700 }} />
                          ) : (
                            <Typography sx={{ color: 'neutral.500' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {col.isForeignKey ? (
                            <Chip size="small" label="FK" sx={{ height: 20, fontSize: '10px', bgcolor: 'secondary.100', color: 'secondary.700', fontWeight: 700 }} />
                          ) : (
                            <Typography sx={{ color: 'neutral.500' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {col.foreignKeyRef ? (
                            <Chip
                              size="small"
                              icon={<TableIcon sx={{ fontSize: '12px !important' }} />}
                              label={`${col.foreignKeyRef.table}.${col.foreignKeyRef.column}`}
                              onClick={() => dispatch(setSelectedTable(col.foreignKeyRef!.table))}
                              sx={{ 
                                height: 22, 
                                fontSize: '10px',
                                bgcolor: 'secondary.100',
                                color: 'secondary.700',
                                fontFamily: 'monospace',
                                cursor: 'pointer',
                                '& .MuiChip-icon': { color: 'secondary.500' },
                                '&:hover': { bgcolor: 'secondary.200' },
                              }}
                            />
                          ) : (
                            <Typography sx={{ color: 'neutral.500' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontFamily: 'monospace', fontSize: '11px' }}>
                          {col.defaultValue || '—'}
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {col.isUnique && (
                              <Chip size="small" label="UNIQUE" sx={{ height: 20, fontSize: '10px', bgcolor: 'info.100', color: 'info.700' }} />
                            )}
                            {col.autoIncrement && (
                              <Chip size="small" label="AUTO" sx={{ height: 20, fontSize: '10px', bgcolor: 'success.100', color: 'success.700' }} />
                            )}
                            {!col.nullable && (
                              <Chip size="small" label="NN" sx={{ height: 20, fontSize: '10px', bgcolor: 'error.100', color: 'error.700' }} />
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            
            {/* Foreign Keys */}
            {selectedTableData.foreignKeys.length > 0 && (
              <Paper sx={{ mb: 3, bgcolor: 'primary.700', overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
                  <Typography variant="body1Bold" sx={{ color: 'white.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinkIcon sx={{ color: 'secondary.300' }} />
                    Foreign Keys
                  </Typography>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'primary.600' }}>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Column</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>References Table</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>References Column</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>On Delete</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>On Update</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedTableData.foreignKeys.map((fk, idx) => (
                        <TableRow 
                          key={idx}
                          sx={{ 
                            bgcolor: idx % 2 === 0 ? 'primary.700' : 'primary.600',
                            '&:hover': { bgcolor: 'primary.500' },
                          }}
                        >
                          <TableCell sx={{ color: 'white.main' }}>{fk.columnName}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              icon={<TableIcon sx={{ fontSize: '14px !important' }} />}
                              label={fk.referencesTable}
                              onClick={() => {
                                // Try to select the referenced table
                                dispatch(setSelectedTable(fk.referencesTable));
                              }}
                              sx={{ 
                                height: 24, 
                                fontSize: '11px',
                                bgcolor: 'secondary.100',
                                color: 'secondary.700',
                                cursor: 'pointer',
                                '& .MuiChip-icon': { color: 'secondary.500' },
                                '&:hover': { bgcolor: 'secondary.200' },
                              }}
                            />
                          </TableCell>
                          <TableCell sx={{ color: 'neutral.300' }}>{fk.referencesColumn}</TableCell>
                          <TableCell sx={{ color: 'neutral.300' }}>{fk.onDelete || '-'}</TableCell>
                          <TableCell sx={{ color: 'neutral.300' }}>{fk.onUpdate || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
            
            {/* Indexes */}
            {selectedTableData.indexes.length > 0 && (
              <Paper sx={{ mb: 3, bgcolor: 'primary.700', overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
                  <Typography variant="body1Bold" sx={{ color: 'white.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DataIcon sx={{ color: 'success.main' }} />
                    Indexes
                  </Typography>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'primary.600' }}>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Index Name</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Columns</TableCell>
                        <TableCell sx={{ color: 'neutral.300', fontWeight: 600 }}>Unique</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedTableData.indexes.map((idx, i) => (
                        <TableRow 
                          key={i}
                          sx={{ 
                            bgcolor: i % 2 === 0 ? 'primary.700' : 'primary.600',
                            '&:hover': { bgcolor: 'primary.500' },
                          }}
                        >
                          <TableCell sx={{ color: 'white.main' }}>{idx.name}</TableCell>
                          <TableCell sx={{ color: 'neutral.300' }}>{idx.columns.join(', ')}</TableCell>
                          <TableCell>
                            {idx.isUnique ? (
                              <CheckIcon sx={{ color: 'success.main', fontSize: 18 }} />
                            ) : (
                              <CloseIcon sx={{ color: 'neutral.400', fontSize: 18 }} />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
            
            {/* Raw SQL */}
            <Paper sx={{ bgcolor: 'primary.700', overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'primary.500' }}>
                <Typography variant="body1Bold" sx={{ color: 'white.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CodeIcon sx={{ color: 'warning.main' }} />
                  CREATE TABLE Statement
                </Typography>
              </Box>
              <Box sx={{ p: 2 }}>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: 'primary.800',
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    color: 'success.300',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 300,
                    overflow: 'auto',
                  }}
                >
                  {selectedTableData.rawSQL}
                </Paper>
              </Box>
            </Paper>
          </Box>
        ) : (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
          }}>
            <StorageIcon sx={{ fontSize: 80, color: 'primary.500', mb: 2 }} />
            <Typography variant="h3Medium" sx={{ color: 'neutral.400', mb: 1 }}>
              {isLoaded ? 'Select a table to view details' : 'Upload a SQL file to get started'}
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.500' }}>
              {isLoaded 
                ? 'Click on any table from the left panel'
                : 'Drag and drop or click to upload a .sql file'
              }
            </Typography>
          </Box>
        )}
      </Box>
      
      {/* Export JSON Dialog */}
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
          Export Parsed SQL as JSON
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" sx={{ color: 'neutral.300', mb: 2 }}>
            Copy this JSON to use in your database schema configuration. Includes columns, primary keys, and foreign keys.
          </Typography>
          
          {/* Quick Copy Buttons */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<CopyIcon />}
              onClick={() => handleCopyJSON()}
              sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.600' } }}
            >
              Copy All Tables ({tables.length})
            </Button>
            {selectedTable && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<CopyIcon />}
                onClick={() => handleCopyJSON(selectedTable)}
                sx={{ 
                  borderColor: 'info.300', 
                  color: 'info.300',
                  '&:hover': { bgcolor: 'info.100', color: 'info.700' },
                }}
              >
                Copy {selectedTable} Only
              </Button>
            )}
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
                  onClick={() => handleCopyJSON()}
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
              {generateTableJSON()}
            </Typography>
          </Paper>
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'primary.500', p: 2 }}>
          <Button onClick={() => setJsonDialog(false)} sx={{ color: 'neutral.300' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Update Schema Dialog */}
      <Dialog 
        open={updateDialog} 
        onClose={() => setUpdateDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'white.main',
            borderRadius: 2,
          }
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: 1, 
          borderColor: 'neutral.200', 
          bgcolor: 'success.50',
          display: 'flex', 
          alignItems: 'center', 
          gap: 1 
        }}>
          <StorageIcon sx={{ color: 'success.main' }} />
          <Typography variant="h6" sx={{ color: 'success.800' }}>
            Update Schema
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body1" sx={{ color: 'neutral.700', mb: 3 }}>
            Choose which schema to update with the parsed SQL data ({allTables.length} tables):
          </Typography>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Source DB Option */}
            <Paper
              onClick={() => handleUpdateSchema('source')}
              sx={{
                p: 3,
                border: 2,
                borderColor: 'primary.300',
                borderRadius: 2,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'primary.50',
                  transform: 'translateY(-2px)',
                  boxShadow: 2,
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ 
                  p: 1.5, 
                  borderRadius: 2, 
                  bgcolor: 'primary.100',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <SourceIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                </Box>
                <Box>
                  <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 600 }}>
                    Update Source DB
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'neutral.600' }}>
                    Use this SQL as the source (old) database schema
                  </Typography>
                </Box>
              </Box>
            </Paper>
            
            {/* Target DB Option */}
            <Paper
              onClick={() => handleUpdateSchema('target')}
              sx={{
                p: 3,
                border: 2,
                borderColor: 'secondary.300',
                borderRadius: 2,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: 'secondary.main',
                  bgcolor: 'secondary.50',
                  transform: 'translateY(-2px)',
                  boxShadow: 2,
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ 
                  p: 1.5, 
                  borderRadius: 2, 
                  bgcolor: 'secondary.100',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <TargetIcon sx={{ fontSize: 32, color: 'secondary.main' }} />
                </Box>
                <Box>
                  <Typography variant="h6" sx={{ color: 'secondary.main', fontWeight: 600 }}>
                    Update Target DB
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'neutral.600' }}>
                    Use this SQL as the target (new) database schema
                  </Typography>
                </Box>
              </Box>
            </Paper>
          </Box>
          
          <Alert severity="info" sx={{ mt: 3, bgcolor: 'info.50' }}>
            <Typography variant="body2">
              This will replace the current schema in the Schema Mapping page with {allTables.length} tables from <strong>{fileName}</strong>
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'neutral.200', p: 2, bgcolor: 'neutral.100' }}>
          <Button 
            onClick={() => setUpdateDialog(false)} 
            sx={{ color: 'neutral.600' }}
          >
            Cancel
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
