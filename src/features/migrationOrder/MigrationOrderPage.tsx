import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Button,
  Card,
  CardContent,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  Alert,
  Divider,
  useTheme,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Snackbar,
} from '@mui/material';
import {
  Search as SearchIcon,
  PlayArrow as PlayIcon,
  TableChart as TableIcon,
  Link as LinkIcon,
  ArrowForward as ArrowIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Add as AddIcon,
  Info as InfoIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Speed as SpeedIcon,
  ContentCopy as CopyIcon,
  Code as CodeIcon,
  Download as DownloadIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { selectTargetTables } from '../targetSchema/targetSchemaSlice';
import { selectTableMappings } from '../mapping/mappingSlice';
import {
  analyzeDependencies,
  selectGroupedByLevel,
  selectIsAnalyzed,
  selectSelectedTable,
  setSelectedTable,
  selectCustomDependencies,
  addCustomDependency,
  removeCustomDependency,
  selectDependencies,
  selectOrderedTableNames,
  selectCircularDependency,
  wouldCreateCycle,
  type TableDependency,
} from './migrationOrderSlice';
import { saveToLocalStorage, STORAGE_KEYS } from '../../utils/localStorage';
import ManualOrderPanel from './ManualOrderPanel';
import {
  generateMigrationSQL,
  generateFullMigrationScript,
  groupSQLByLevel,
  generateLevelScript,
  generateSingleTableScript,
  type GeneratedSQL,
  type SQLGeneratorOptions,
} from '../../utils/sqlGenerator';

export const MigrationOrderPage = () => {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const tables = useAppSelector(selectTargetTables);
  const groupedDeps = useAppSelector(selectGroupedByLevel);
  const isAnalyzed = useAppSelector(selectIsAnalyzed);
  const selectedTable = useAppSelector(selectSelectedTable);
  const customDependencies = useAppSelector(selectCustomDependencies);
  const orderedTableNames = useAppSelector(selectOrderedTableNames);
  const circularDependency = useAppSelector(selectCircularDependency);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set([0, 1, 2]));
  const [addDepDialog, setAddDepDialog] = useState(false);
  const [newDepFrom, setNewDepFrom] = useState<string | null>(null);
  const [newDepTo, setNewDepTo] = useState<string | null>(null);
  const [jsonDialog, setJsonDialog] = useState(false);
  const [sqlDialog, setSqlDialog] = useState(false);
  const [sqlDialect, setSqlDialect] = useState<'postgresql' | 'mysql' | 'mssql'>('postgresql');
  const [generatedSQL, setGeneratedSQL] = useState<GeneratedSQL[]>([]);
  const [fullScript, setFullScript] = useState('');
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [sqlViewMode, setSqlViewMode] = useState<'full' | 'level' | 'table'>('full');
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [selectedSQLTable, setSelectedSQLTable] = useState<string | null>(null);
  
  // Get mappings and all dependencies
  const tableMappings = useAppSelector(selectTableMappings);
  const allDependencies = useAppSelector(selectDependencies);
  
  // Custom dependencies are NOT loaded from localStorage here any more.
  //
  // They used to be, and it was actively wrong once configurations became the
  // source of truth: applyConfiguration puts the saved dependencies into the
  // store at boot, and this effect then overwrote them with whatever this
  // browser happened to have. A configuration with no custom dependencies would
  // silently gain three of them the moment someone opened this page, changing
  // the migration order of a run nobody had edited.
  useEffect(() => {
    if (tables.length > 0 && !isAnalyzed) {
      dispatch(analyzeDependencies(tables));
    }
  }, [tables, isAnalyzed, dispatch]);

  // Mirror to localStorage as a draft, so unsaved edits survive a reload.
  // Writing the empty array matters: the old code skipped it, so removing the
  // last dependency left the previous list on disk to be picked up by the
  // backup/import tooling as though it were still in force.
  useEffect(() => {
    saveToLocalStorage(STORAGE_KEYS.MIGRATION_ORDER_CUSTOM_DEPS, customDependencies);
  }, [customDependencies]);
  
  // Generate JSON for selected table or all tables
  const generateTableJSON = useCallback((tableName?: string) => {
    const targetTables = tableName 
      ? tables.filter(t => t.name === tableName)
      : tables;
    
    const jsonData = {
      database: "old_db",
      tables: targetTables.map(table => {
        // Find FK info from dependencies
        const depInfo = groupedDeps.flatMap(g => g.tables).find(d => d.tableName === table.name);
        
        // Get primary key columns
        const pkColumns = table.columns.filter(c => c.isPrimaryKey).map(c => c.name);
        
        // Get foreign keys
        const foreignKeys = table.columns
          .filter(c => c.isForeignKey && c.foreignKeyRef)
          .map(c => ({
            column: c.name,
            references: {
              table: c.foreignKeyRef!.table,
              column: c.foreignKeyRef!.column,
            },
          }));
        
        return {
          name: table.name,
          columns: table.columns.map(col => {
            // Check for FK info from dependencies (fallback)
            const fkInfo = depInfo?.foreignKeys.find(fk => fk.columnName === col.name);
            const columnDef: Record<string, unknown> = {
              name: col.name,
              type: col.type,
            };
            if (col.nullable !== undefined) columnDef.nullable = col.nullable;
            if (col.isPrimaryKey) columnDef.isPrimaryKey = true;
            
            // Use column's FK info first, fallback to depInfo
            if (col.isForeignKey && col.foreignKeyRef) {
              columnDef.isForeignKey = true;
              columnDef.foreignKeyRef = col.foreignKeyRef;
            } else if (fkInfo) {
              columnDef.isForeignKey = true;
              columnDef.foreignKeyRef = {
                table: fkInfo.referencesTable,
                column: fkInfo.referencesColumn,
              };
            }
            return columnDef;
          }),
          primaryKey: pkColumns.length > 0 ? pkColumns : undefined,
          foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined,
        };
      }),
    };
    
    return JSON.stringify(jsonData, null, 2);
  }, [tables, groupedDeps]);
  
  const handleCopyJSON = useCallback((tableName?: string) => {
    const json = generateTableJSON(tableName);
    navigator.clipboard.writeText(json).then(() => {
      setSnackbar({ open: true, message: tableName ? `Copied ${tableName} JSON to clipboard!` : 'Copied all tables JSON to clipboard!' });
    }).catch(() => {
      setSnackbar({ open: true, message: 'Failed to copy to clipboard' });
    });
  }, [generateTableJSON]);
  
  const handleReanalyze = () => {
    dispatch(analyzeDependencies(tables));
  };
  
  // Generate SQL migration script
  const handleGenerateSQL = useCallback(() => {
    if (tableMappings.length === 0) {
      setSnackbar({ open: true, message: 'No mappings found. Please create table mappings first.' });
      return;
    }
    
    const options: Partial<SQLGeneratorOptions> = {
      dialect: sqlDialect,
      includeComments: true,
      useTruncate: false,
    };
    
    const sqlStatements = generateMigrationSQL(tableMappings, allDependencies, options);
    setGeneratedSQL(sqlStatements);
    
    const script = generateFullMigrationScript(sqlStatements, options);
    setFullScript(script);
    
    setSqlDialog(true);
  }, [tableMappings, allDependencies, sqlDialect]);
  
  // Copy SQL to clipboard
  const handleCopySQL = useCallback(() => {
    navigator.clipboard.writeText(fullScript).then(() => {
      setSnackbar({ open: true, message: 'SQL script copied to clipboard!' });
    }).catch(() => {
      setSnackbar({ open: true, message: 'Failed to copy to clipboard' });
    });
  }, [fullScript]);
  
  // Download SQL file
  const handleDownloadSQL = useCallback(() => {
    const blob = new Blob([fullScript], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-script-${sqlDialect}-${Date.now()}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'SQL file downloaded!' });
  }, [fullScript, sqlDialect]);
  
  const toggleLevel = (level: number) => {
    setExpandedLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };
  
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedDeps;
    const query = searchQuery.toLowerCase();
    return groupedDeps
      .map(group => ({
        ...group,
        tables: group.tables.filter(t => 
          t.tableName.toLowerCase().includes(query)
        ),
      }))
      .filter(group => group.tables.length > 0);
  }, [groupedDeps, searchQuery]);
  
  const totalTables = useMemo(() => 
    groupedDeps.reduce((sum, g) => sum + g.tables.length, 0),
    [groupedDeps]
  );
  
  const maxLevel = useMemo(() => 
    Math.max(...groupedDeps.map(g => g.level), 0),
    [groupedDeps]
  );
  
  const wouldCreateCycleWithNew = useMemo(() => {
    if (!newDepFrom || !newDepTo || newDepFrom === newDepTo || tables.length === 0) return false;
    return wouldCreateCycle(tables, customDependencies, { from: newDepFrom, to: newDepTo });
  }, [tables, customDependencies, newDepFrom, newDepTo]);

  const handleAddDependency = () => {
    if (newDepFrom && newDepTo && newDepFrom !== newDepTo && !wouldCreateCycleWithNew) {
      dispatch(addCustomDependency({ from: newDepFrom, to: newDepTo }));
      setNewDepFrom(null);
      setNewDepTo(null);
      setAddDepDialog(false);
      setTimeout(() => dispatch(analyzeDependencies(tables)), 100);
    }
  };

  const handleCopyOrder = useCallback(() => {
    const text = orderedTableNames.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setSnackbar({ open: true, message: `Copied ${orderedTableNames.length} tables in migration order to clipboard` });
    }).catch(() => {
      setSnackbar({ open: true, message: 'Failed to copy' });
    });
  }, [orderedTableNames]);
  
  const handleRemoveDependency = (from: string, to: string) => {
    dispatch(removeCustomDependency({ from, to }));
    setTimeout(() => dispatch(analyzeDependencies(tables)), 100);
  };
  
  const getComplexityColor = (complexity: 'low' | 'medium' | 'high') => {
    switch (complexity) {
      case 'low': return 'success';
      case 'medium': return 'warning';
      case 'high': return 'error';
    }
  };
  
  // Use theme colors for levels
  const getLevelColor = (level: number) => {
    const colors = [
      theme.palette.success.main,    // Level 0 - Green
      theme.palette.info.main,       // Level 1 - Blue
      theme.palette.secondary.main,  // Level 2 - Purple
      theme.palette.warning.main,    // Level 3 - Amber
      theme.palette.error.main,      // Level 4+ - Red
    ];
    return colors[Math.min(level, colors.length - 1)];
  };
  
  const selectedTableData = useMemo(() => {
    if (!selectedTable) return null;
    for (const group of groupedDeps) {
      const found = group.tables.find(t => t.tableName === selectedTable);
      if (found) return found;
    }
    return null;
  }, [selectedTable, groupedDeps]);
  
  const tableNames = useMemo(() => tables.map(t => t.name), [tables]);

  return (
    <Box sx={{ 
      display: 'flex', 
      height: '100%', 
      bgcolor: 'primary.800',
      background: (theme) => `linear-gradient(135deg, ${theme.palette.primary[800]} 0%, ${theme.palette.primary[700]} 50%, ${theme.palette.primary[800]} 100%)`,
    }}>
      {/* Main Content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {/* Header Section */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography 
                variant="h3Bold" 
                sx={{ 
                  color: 'white.main',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <SpeedIcon sx={{ color: 'success.main', fontSize: 32 }} />
                Migration Order Analysis
              </Typography>
              <Typography variant="body2" sx={{ color: 'neutral.400', mt: 0.5 }}>
                Analyze table dependencies and determine optimal migration sequence
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<StorageIcon />}
                onClick={handleGenerateSQL}
                sx={{
                  bgcolor: 'success.main',
                  color: 'white.main',
                  '&:hover': { bgcolor: 'success.600' },
                }}
              >
                Generate SQL
              </Button>
              <Button
                variant="outlined"
                startIcon={<CodeIcon />}
                onClick={() => setJsonDialog(true)}
                sx={{
                  borderColor: 'secondary.main',
                  color: 'secondary.main',
                  '&:hover': { borderColor: 'secondary.400', bgcolor: 'secondary.100' },
                }}
              >
                Export JSON
              </Button>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setAddDepDialog(true)}
                sx={{
                  borderColor: 'info.main',
                  color: 'info.main',
                  '&:hover': { borderColor: 'info.400', bgcolor: 'info.100' },
                }}
              >
                Add Dependency
              </Button>
              <Button
                variant="outlined"
                startIcon={<CopyIcon />}
                onClick={handleCopyOrder}
                disabled={orderedTableNames.length === 0}
                sx={{
                  borderColor: 'neutral.400',
                  color: 'neutral.200',
                  '&:hover': { borderColor: 'neutral.300', bgcolor: 'primary.600' },
                }}
              >
                Copy order
              </Button>
              <Button
                variant="contained"
                startIcon={<PlayIcon />}
                onClick={handleReanalyze}
                sx={{
                  bgcolor: 'success.main',
                  '&:hover': { bgcolor: 'success.500' },
                }}
              >
                Re-analyze
              </Button>
            </Box>
          </Box>
          
          {/* Stats Cards */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Paper sx={{ 
              flex: 1, 
              p: 2, 
              bgcolor: 'info.100', 
              border: 1,
              borderColor: 'info.300',
              borderRadius: 2,
            }}>
              <Typography variant="caption1" sx={{ color: 'info.700' }}>Total Tables</Typography>
              <Typography variant="h2Bold" sx={{ color: 'info.600' }}>{totalTables}</Typography>
            </Paper>
            <Paper sx={{ 
              flex: 1, 
              p: 2, 
              bgcolor: 'success.100', 
              border: 1,
              borderColor: 'success.300',
              borderRadius: 2,
            }}>
              <Typography variant="caption1" sx={{ color: 'success.700' }}>Migration Levels</Typography>
              <Typography variant="h2Bold" sx={{ color: 'success.600' }}>{maxLevel + 1}</Typography>
            </Paper>
            <Paper sx={{ 
              flex: 1, 
              p: 2, 
              bgcolor: 'secondary.100', 
              border: 1,
              borderColor: 'secondary.300',
              borderRadius: 2,
            }}>
              <Typography variant="caption1" sx={{ color: 'secondary.700' }}>Custom Dependencies</Typography>
              <Typography variant="h2Bold" sx={{ color: 'secondary.600' }}>{customDependencies.length}</Typography>
            </Paper>
            <Paper sx={{ 
              flex: 1, 
              p: 2, 
              bgcolor: 'warning.100', 
              border: 1,
              borderColor: 'warning.300',
              borderRadius: 2,
            }}>
              <Typography variant="caption1" sx={{ color: 'warning.700' }}>First to Migrate</Typography>
              <Typography variant="h2Bold" sx={{ color: 'warning.600' }}>
                {groupedDeps.find(g => g.level === 0)?.tables.length || 0}
              </Typography>
            </Paper>
          </Box>
          
          {/* Search */}
          <TextField
            fullWidth
            placeholder="Search tables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'neutral.400' }} />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: 'primary.700',
                color: 'white.main',
                borderRadius: 2,
                '& fieldset': { borderColor: 'primary.500' },
                '&:hover fieldset': { borderColor: 'primary.400' },
                '&.Mui-focused fieldset': { borderColor: 'info.main' },
              },
              '& .MuiInputBase-input::placeholder': { color: 'neutral.400' },
            }}
          />
        </Box>
        
        {/* Info Alert */}
        <Alert 
          severity="info" 
          icon={<InfoIcon />}
          sx={{ 
            mb: 3, 
            bgcolor: 'info.100', 
            color: 'info.700',
            border: 1,
            borderColor: 'info.300',
            '& .MuiAlert-icon': { color: 'info.600' },
          }}
        >
          <strong>Level 0</strong> tables have no dependencies and should be migrated first. 
          Higher levels depend on lower levels. Tables at the same level can be migrated in parallel.
        </Alert>

        {circularDependency && circularDependency.length > 0 && (
          <Alert 
            severity="error" 
            icon={<WarningIcon />}
            sx={{ 
              mb: 3, 
              bgcolor: 'error.100', 
              color: 'error.700',
              border: 1,
              borderColor: 'error.300',
              '& .MuiAlert-icon': { color: 'error.600' },
            }}
          >
            <strong>Circular dependency detected:</strong> {circularDependency.join(' → ')}. 
            Remove one of these dependencies (e.g. from Custom Dependencies) so tables can be migrated in order.
          </Alert>
        )}
        
        {/* The order tables actually migrate in — derived, or chosen by hand */}
        <ManualOrderPanel />

        {/* Custom Dependencies Section */}
        {customDependencies.length > 0 && (
          <Paper sx={{ 
            p: 2, 
            mb: 3, 
            bgcolor: 'secondary.100', 
            border: 1,
            borderColor: 'secondary.300',
            borderRadius: 2,
          }}>
            <Typography variant="body2Medium" sx={{ color: 'secondary.700', mb: 1.5 }}>
              Custom Dependencies
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {customDependencies.map((dep, idx) => (
                <Chip
                  key={idx}
                  label={`${dep.from} → ${dep.to}`}
                  onDelete={() => handleRemoveDependency(dep.from, dep.to)}
                  sx={{
                    bgcolor: 'secondary.200',
                    color: 'secondary.800',
                    '& .MuiChip-deleteIcon': { color: 'secondary.600' },
                  }}
                />
              ))}
            </Box>
          </Paper>
        )}
        
        {/* Migration Levels */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filteredGroups.map(({ level, tables: levelTables }) => (
            <Paper
              key={level}
              sx={{
                bgcolor: 'primary.700',
                border: 1,
                borderColor: getLevelColor(level),
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {/* Level Header */}
              <Box
                onClick={() => toggleLevel(level)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 2,
                  cursor: 'pointer',
                  bgcolor: 'primary.600',
                  borderBottom: expandedLevels.has(level) ? 1 : 0,
                  borderColor: getLevelColor(level),
                  transition: 'all 0.2s ease',
                  '&:hover': { bgcolor: 'primary.500' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Chip
                    label={`Level ${level}`}
                    size="small"
                    sx={{
                      bgcolor: getLevelColor(level),
                      color: 'white.main',
                      fontWeight: 600,
                    }}
                  />
                  <Typography variant="body1Medium" sx={{ color: 'white.main' }}>
                    {level === 0 ? 'No Dependencies - Migrate First' : 
                     level === 1 ? 'Depends on Level 0' :
                     `Depends on Level ${level - 1} and below`}
                  </Typography>
                  <Chip
                    label={`${levelTables.length} tables`}
                    size="small"
                    variant="outlined"
                    sx={{ borderColor: 'neutral.400', color: 'neutral.300' }}
                  />
                </Box>
                <IconButton size="small" sx={{ color: 'neutral.300' }}>
                  {expandedLevels.has(level) ? <CollapseIcon /> : <ExpandIcon />}
                </IconButton>
              </Box>
              
              {/* Tables Grid */}
              <Collapse in={expandedLevels.has(level)}>
                <Box sx={{ p: 2 }}>
                  <Box sx={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 2,
                  }}>
                    {levelTables.map((table) => (
                      <TableCard
                        key={table.tableName}
                        table={table}
                        levelColor={getLevelColor(level)}
                        isSelected={selectedTable === table.tableName}
                        onClick={() => dispatch(setSelectedTable(
                          selectedTable === table.tableName ? null : table.tableName
                        ))}
                        getComplexityColor={getComplexityColor}
                      />
                    ))}
                  </Box>
                </Box>
              </Collapse>
            </Paper>
          ))}
        </Box>
        
        {filteredGroups.length === 0 && (
          <Paper sx={{ 
            p: 4, 
            textAlign: 'center', 
            bgcolor: 'primary.700',
            border: 1,
            borderColor: 'primary.500',
            borderRadius: 2,
          }}>
            <TableIcon sx={{ fontSize: 48, color: 'neutral.400', mb: 2 }} />
            <Typography variant="body1" sx={{ color: 'neutral.300' }}>
              {searchQuery ? 'No tables match your search' : 'No tables to analyze'}
            </Typography>
          </Paper>
        )}
      </Box>
      
      {/* Details Panel */}
      <Box 
        sx={{ 
          width: 380, 
          borderLeft: 1, 
          borderColor: 'primary.500', 
          bgcolor: 'primary.800',
          overflow: 'auto',
        }}
      >
        {selectedTableData ? (
          <TableDetailsPanel 
            table={selectedTableData} 
            getLevelColor={getLevelColor}
            getComplexityColor={getComplexityColor}
            onSelectTable={(name) => dispatch(setSelectedTable(name))}
            onCopyJSON={handleCopyJSON}
          />
        ) : (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            p: 3,
          }}>
            <InfoIcon sx={{ fontSize: 64, color: 'primary.500', mb: 2 }} />
            <Typography variant="body1Medium" sx={{ color: 'neutral.400', textAlign: 'center' }}>
              Select a table to view its dependencies and migration details
            </Typography>
          </Box>
        )}
      </Box>
      
      {/* Add Dependency Dialog */}
      <Dialog 
        open={addDepDialog} 
        onClose={() => setAddDepDialog(false)}
        PaperProps={{
          sx: {
            bgcolor: 'primary.700',
            color: 'white.main',
            minWidth: 400,
          }
        }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'primary.500' }}>
          Add Custom Dependency
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" sx={{ color: 'neutral.300', mb: 3 }}>
            Define a dependency: the first table must be migrated after the second table.
          </Typography>
          {wouldCreateCycleWithNew && (
            <Alert severity="error" sx={{ mb: 2 }}>
              This dependency would create a circular dependency. Choose a different pair or remove an existing dependency.
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Autocomplete
              options={tableNames}
              value={newDepFrom}
              onChange={(_, value) => setNewDepFrom(value)}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label="Table that depends on (migrate later)" 
                  placeholder="Select table"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      color: 'white.main',
                      '& fieldset': { borderColor: 'primary.400' },
                    },
                    '& .MuiInputLabel-root': { color: 'neutral.300' },
                  }}
                />
              )}
              sx={{
                '& .MuiAutocomplete-popupIndicator': { color: 'neutral.300' },
              }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <ArrowIcon sx={{ color: 'neutral.400', transform: 'rotate(90deg)' }} />
            </Box>
            <Autocomplete
              options={tableNames.filter(t => t !== newDepFrom)}
              value={newDepTo}
              onChange={(_, value) => setNewDepTo(value)}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label="Depends on table (migrate first)" 
                  placeholder="Select table"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      color: 'white.main',
                      '& fieldset': { borderColor: 'primary.400' },
                    },
                    '& .MuiInputLabel-root': { color: 'neutral.300' },
                  }}
                />
              )}
              sx={{
                '& .MuiAutocomplete-popupIndicator': { color: 'neutral.300' },
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'primary.500', p: 2 }}>
          <Button onClick={() => setAddDepDialog(false)} sx={{ color: 'neutral.300' }}>
            Cancel
          </Button>
          <Button 
            onClick={handleAddDependency}
            variant="contained"
            disabled={!newDepFrom || !newDepTo || newDepFrom === newDepTo || wouldCreateCycleWithNew}
            sx={{ bgcolor: 'info.main', '&:hover': { bgcolor: 'info.600' } }}
          >
            Add Dependency
          </Button>
        </DialogActions>
      </Dialog>
      
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
          <CodeIcon sx={{ color: 'secondary.main' }} />
          Export Tables as JSON
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" sx={{ color: 'neutral.300', mb: 2 }}>
            Copy this JSON to use in your source/target schema configuration. Includes foreign key relationships.
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
              Copy All Tables
            </Button>
            {selectedTable && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<CopyIcon />}
                onClick={() => handleCopyJSON(selectedTable)}
                sx={{ 
                  borderColor: 'info.main', 
                  color: 'info.main',
                  '&:hover': { bgcolor: 'info.100' },
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
      
      {/* SQL Generator Dialog */}
      <Dialog 
        open={sqlDialog} 
        onClose={() => setSqlDialog(false)}
        maxWidth="xl"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'neutral.100',
            minHeight: '85vh',
            borderRadius: 3,
            overflow: 'hidden',
          }
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: 1, 
          borderColor: 'neutral.200', 
          background: 'linear-gradient(135deg, #272626 0%, #F7F7F6 100%)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          py: 2,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ 
              p: 1, 
              borderRadius: 1.5, 
              bgcolor: 'success.100',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <StorageIcon sx={{ color: 'success.main', fontSize: 24 }} />
            </Box>
            <Typography variant="h6" sx={{ color: 'neutral.800', fontWeight: 600 }}>
              Migration SQL Generator
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Chip 
              label={`${generatedSQL.length} Tables`}
              size="small"
              sx={{ bgcolor: 'primary.100', color: 'primary.main', fontWeight: 600 }}
            />
            <Chip 
              label={`${Array.from(groupSQLByLevel(generatedSQL).keys()).length} Levels`}
              size="small"
              sx={{ bgcolor: 'info.100', color: '#A8CFE1', fontWeight: 600 }}
            />
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Toolbar with View Mode and Dialect */}
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'neutral.100', bgcolor: 'neutral.800' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              {/* View Mode Toggle */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2Medium" sx={{ color: 'neutral.500' }}>
                  View:
                </Typography>
                <Box sx={{ display: 'flex', bgcolor: 'rgba(39, 38, 38,0.08)', borderRadius: 1.5, overflow: 'hidden', p: 0.5 }}>
                  {([
                    { key: 'full', label: 'Full Script' },
                    { key: 'level', label: 'By Level' },
                    { key: 'table', label: 'By Table' },
                  ] as const).map((mode) => (
                    <Box
                      key={mode.key}
                      onClick={() => {
                        setSqlViewMode(mode.key);
                        if (mode.key === 'level' && selectedLevel === null) {
                          const levels = Array.from(groupSQLByLevel(generatedSQL).keys()).sort((a, b) => a - b);
                          if (levels.length > 0) setSelectedLevel(levels[0]);
                        }
                        if (mode.key === 'table' && selectedSQLTable === null && generatedSQL.length > 0) {
                          setSelectedSQLTable(generatedSQL[0].targetTable);
                        }
                      }}
                      sx={{
                        px: 2,
                        py: 0.75,
                        cursor: 'pointer',
                        bgcolor: sqlViewMode === mode.key ? 'primary.main' : 'transparent',
                        color: sqlViewMode === mode.key ? 'neutral.800' : 'neutral.500',
                        fontWeight: sqlViewMode === mode.key ? 600 : 400,
                        fontSize: '13px',
                        borderRadius: 1,
                        transition: 'all 0.2s ease',
                        '&:hover': { 
                          bgcolor: sqlViewMode === mode.key ? 'primary.700' : 'neutral.100',
                          color: sqlViewMode === mode.key ? 'neutral.800' : 'neutral.800',
                        },
                      }}
                    >
                      {mode.label}
                    </Box>
                  ))}
                </Box>
              </Box>
              
              {/* Dialect Selector */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2Medium" sx={{ color: 'neutral.500' }}>
                  Dialect:
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {(['postgresql', 'mysql', 'mssql'] as const).map((dialect) => (
                    <Chip
                      key={dialect}
                      label={dialect.toUpperCase()}
                      size="small"
                      onClick={() => {
                        setSqlDialect(dialect);
                        const options = { dialect, includeComments: true, useTruncate: false };
                        const newSQL = generateMigrationSQL(tableMappings, allDependencies, options);
                        setGeneratedSQL(newSQL);
                        setFullScript(generateFullMigrationScript(newSQL, options));
                      }}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: sqlDialect === dialect ? 'primary.700' : 'neutral.200',
                        color: sqlDialect === dialect ? 'neutral.800' : 'neutral.500',
                        fontWeight: sqlDialect === dialect ? 600 : 400,
                        transition: 'all 0.2s ease',
                        '&:hover': { 
                          bgcolor: sqlDialect === dialect ? '#2D6079' : 'neutral.200',
                        },
                      }}
                    />
                  ))}
                </Box>
              </Box>
              
              <Box sx={{ flex: 1 }} />
              
              {/* Action Buttons */}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CopyIcon />}
                  onClick={handleCopySQL}
                  sx={{ 
                    borderColor: 'primary.main', 
                    color: 'primary.main',
                    '&:hover': { borderColor: 'primary.main', bgcolor: 'primary.100' },
                  }}
                >
                  Copy SQL
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadSQL}
                  sx={{ 
                    bgcolor: 'success.main',
                    '&:hover': { bgcolor: 'success.600' },
                  }}
                >
                  Download .sql
                </Button>
              </Box>
            </Box>
          </Box>
          
          {generatedSQL.length === 0 ? (
            <Box sx={{ p: 6, textAlign: 'center', bgcolor: 'neutral.100' }}>
              <Box sx={{ 
                width: 80, 
                height: 80, 
                borderRadius: '50%', 
                bgcolor: 'warning.100', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                mx: 'auto',
                mb: 3,
              }}>
                <WarningIcon sx={{ fontSize: 40, color: 'warning.400' }} />
              </Box>
              <Typography variant="h6" sx={{ color: 'neutral.800', mb: 1 }}>
                No Mappings Found
              </Typography>
              <Typography variant="body2" sx={{ color: 'neutral.500' }}>
                Please create table mappings in the Schema Mapping page first.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left Sidebar */}
              <Box sx={{ 
                width: 320, 
                borderRight: 1, 
                borderColor: 'neutral.100', 
                overflow: 'auto',
                bgcolor: 'neutral.800',
                display: 'flex',
                flexDirection: 'column',
              }}>
                {/* Full Script View - Table List */}
                {sqlViewMode === 'full' && (
                  <>
                    <Box sx={{ 
                      p: 2, 
                      borderBottom: 1, 
                      borderColor: 'neutral.100', 
                      position: 'sticky', 
                      top: 0, 
                      bgcolor: 'primary.100', 
                      zIndex: 1 
                    }}>
                      <Typography variant="body2Bold" sx={{ color: 'neutral.800' }}>
                        Migration Order ({generatedSQL.length} tables)
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto' }}>
                      {Array.from(groupSQLByLevel(generatedSQL).entries())
                        .sort(([a], [b]) => a - b)
                        .map(([level, stmts]) => (
                          <Box key={level}>
                            <Box sx={{ 
                              px: 2, 
                              py: 1.5, 
                              bgcolor: level === 0 ? 'success.100' : 
                                       level === 1 ? '#FFF1E2' : 
                                       level === 2 ? '#FFF1E2' : '#FBEAE8',
                              borderBottom: 1,
                              borderColor: 'neutral.100',
                            }}>
                              <Typography variant="caption1Bold" sx={{ 
                                color: level === 0 ? 'success.400' : 
                                       level === 1 ? '#FFC28C' : 
                                       level === 2 ? '#FF9933' : '#D25F53',
                              }}>
                                Level {level} ({stmts.length} tables)
                              </Typography>
                            </Box>
                            {stmts.map((stmt, idx) => (
                              <Box
                                key={idx}
                                sx={{
                                  p: 2,
                                  borderBottom: 1,
                                  borderColor: 'neutral.100',
                                  cursor: 'pointer',
                                  bgcolor: selectedSQLTable === stmt.targetTable ? 'primary.100' : 'transparent',
                                  transition: 'all 0.2s ease',
                                  '&:hover': { bgcolor: 'primary.100' },
                                }}
                                onClick={() => {
                                  setSelectedSQLTable(stmt.targetTable);
                                  setSqlViewMode('table');
                                }}
                              >
                                <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 500, fontSize: '13px' }}>
                                  {stmt.sourceTable}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'neutral.400', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                  <ArrowIcon sx={{ fontSize: 12, color: 'success.main' }} />
                                  {stmt.targetTable}
                                  <Chip 
                                    label={`${stmt.columnCount} cols`} 
                                    sx={{ 
                                      ml: 'auto', 
                                      height: 18, 
                                      fontSize: '10px',
                                      bgcolor: 'neutral.200',
                                      color: 'neutral.500',
                                    }} 
                                    size="small" 
                                  />
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        ))}
                    </Box>
                  </>
                )}
                
                {/* Level-wise View - Level List */}
                {sqlViewMode === 'level' && (
                  <>
                    <Box sx={{ 
                      p: 2, 
                      borderBottom: 1, 
                      borderColor: 'neutral.100', 
                      position: 'sticky', 
                      top: 0, 
                      bgcolor: 'primary.100', 
                      zIndex: 1 
                    }}>
                      <Typography variant="body2Bold" sx={{ color: 'neutral.800' }}>
                        Migration Levels ({Array.from(groupSQLByLevel(generatedSQL).keys()).length})
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto' }}>
                      {Array.from(groupSQLByLevel(generatedSQL).entries())
                        .sort(([a], [b]) => a - b)
                        .map(([level, stmts]) => {
                          const levelColors = {
                            bg: level === 0 ? '#EBF5EE' : 
                                level === 1 ? '#FFF1E2' : 
                                level === 2 ? '#FFF1E2' : '#FBEAE8',
                            border: level === 0 ? '#356B43' : 
                                    level === 1 ? '#A85C13' : 
                                    level === 2 ? '#A85C13' : '#B03B33',
                            chip: level === 0 ? '#356B43' : 
                                  level === 1 ? '#A85C13' : 
                                  level === 2 ? '#A85C13' : '#B03B33',
                            text: level === 0 ? '#A9D4B6' : 
                                  level === 1 ? '#FFDFC0' : 
                                  level === 2 ? '#FFC28C' : '#E5978F',
                          };
                          
                          return (
                            <Box
                              key={level}
                              onClick={() => setSelectedLevel(level)}
                              sx={{
                                p: 2,
                                m: 1.5,
                                borderRadius: 2,
                                cursor: 'pointer',
                                bgcolor: selectedLevel === level ? levelColors.bg : 'neutral.100',
                                border: 2,
                                borderColor: selectedLevel === level ? levelColors.border : 'transparent',
                                transition: 'all 0.2s ease',
                                '&:hover': { 
                                  bgcolor: levelColors.bg,
                                  borderColor: `${levelColors.border}66`,
                                },
                              }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                <Chip
                                  label={`LEVEL ${level}`}
                                  size="small"
                                  sx={{
                                    bgcolor: levelColors.chip,
                                    color: '#000000',
                                    fontWeight: 700,
                                  }}
                                />
                                <Typography variant="caption1Bold" sx={{ color: 'neutral.800' }}>
                                  {stmts.length} tables
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                {stmts.slice(0, 3).map((stmt, idx) => (
                                  <Typography key={idx} variant="caption" sx={{ color: levelColors.text, fontSize: '11px' }}>
                                    • {stmt.sourceTable} → {stmt.targetTable}
                                  </Typography>
                                ))}
                                {stmts.length > 3 && (
                                  <Typography variant="caption" sx={{ color: 'neutral.400', fontStyle: 'italic' }}>
                                    +{stmts.length - 3} more tables...
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          );
                        })}
                    </Box>
                  </>
                )}
                
                {/* Table-wise View - Table List */}
                {sqlViewMode === 'table' && (
                  <>
                    <Box sx={{ 
                      p: 2, 
                      borderBottom: 1, 
                      borderColor: 'neutral.100', 
                      position: 'sticky', 
                      top: 0, 
                      bgcolor: 'primary.100', 
                      zIndex: 1 
                    }}>
                      <Typography variant="body2Bold" sx={{ color: 'neutral.800' }}>
                        Tables ({generatedSQL.length})
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto' }}>
                      {generatedSQL.map((stmt, idx) => {
                        const levelColor = stmt.level === 0 ? '#356B43' : 
                                          stmt.level === 1 ? '#A85C13' : 
                                          stmt.level === 2 ? '#A85C13' : '#B03B33';
                        return (
                          <Box
                            key={idx}
                            onClick={() => setSelectedSQLTable(stmt.targetTable)}
                            sx={{
                              p: 2,
                              borderBottom: 1,
                              borderColor: 'neutral.100',
                              cursor: 'pointer',
                              bgcolor: selectedSQLTable === stmt.targetTable ? 'primary.100' : 'transparent',
                              borderLeft: selectedSQLTable === stmt.targetTable ? 3 : 0,
                              borderLeftColor: 'primary.700',
                              transition: 'all 0.2s ease',
                              '&:hover': { bgcolor: 'primary.100' },
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                              <Chip
                                label={`L${stmt.level}`}
                                size="small"
                                sx={{
                                  bgcolor: levelColor,
                                  color: '#000000',
                                  fontSize: '10px',
                                  height: 20,
                                  fontWeight: 700,
                                }}
                              />
                              <Typography variant="caption" sx={{ color: 'neutral.500' }}>
                                {stmt.columnCount} columns
                              </Typography>
                            </Box>
                            <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 500, fontSize: '13px' }}>
                              {stmt.sourceTable}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'neutral.400', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                              <ArrowIcon sx={{ fontSize: 12, color: 'success.main' }} />
                              {stmt.targetTable}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  </>
                )}
              </Box>
              
              {/* Right: SQL Preview */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* SQL Preview Header */}
                <Box sx={{ 
                  p: 2, 
                  borderBottom: 1, 
                  borderColor: 'neutral.100', 
                  bgcolor: '#142329',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <CodeIcon sx={{ color: 'success.main', fontSize: 20 }} />
                    <Typography variant="body2Medium" sx={{ color: 'neutral.800' }}>
                      {sqlViewMode === 'full' && 'Full Migration Script'}
                      {sqlViewMode === 'level' && selectedLevel !== null && `Level ${selectedLevel} - ${groupSQLByLevel(generatedSQL).get(selectedLevel)?.length || 0} table(s)`}
                      {sqlViewMode === 'table' && selectedSQLTable && `Table: ${selectedSQLTable}`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Copy this SQL">
                      <IconButton
                        size="small"
                        onClick={() => {
                          let sql = '';
                          const options = { dialect: sqlDialect, includeComments: true, useTruncate: false };
                          
                          if (sqlViewMode === 'full') {
                            sql = fullScript;
                          } else if (sqlViewMode === 'level' && selectedLevel !== null) {
                            const levelStmts = groupSQLByLevel(generatedSQL).get(selectedLevel) || [];
                            sql = generateLevelScript(selectedLevel, levelStmts, options);
                          } else if (sqlViewMode === 'table' && selectedSQLTable) {
                            const stmt = generatedSQL.find(s => s.targetTable === selectedSQLTable);
                            if (stmt) sql = generateSingleTableScript(stmt, options);
                          }
                          
                          navigator.clipboard.writeText(sql);
                          setSnackbar({ open: true, message: 'SQL copied to clipboard!' });
                        }}
                        sx={{ 
                          color: 'neutral.500', 
                          '&:hover': { color: 'primary.main', bgcolor: 'primary.100' } 
                        }}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Download this SQL">
                      <IconButton
                        size="small"
                        onClick={() => {
                          let sql = '';
                          let filename = 'migration';
                          const options = { dialect: sqlDialect, includeComments: true, useTruncate: false };
                          
                          if (sqlViewMode === 'full') {
                            sql = fullScript;
                            filename = `full_migration_${sqlDialect}`;
                          } else if (sqlViewMode === 'level' && selectedLevel !== null) {
                            const levelStmts = groupSQLByLevel(generatedSQL).get(selectedLevel) || [];
                            sql = generateLevelScript(selectedLevel, levelStmts, options);
                            filename = `level_${selectedLevel}_migration_${sqlDialect}`;
                          } else if (sqlViewMode === 'table' && selectedSQLTable) {
                            const stmt = generatedSQL.find(s => s.targetTable === selectedSQLTable);
                            if (stmt) {
                              sql = generateSingleTableScript(stmt, options);
                              filename = `${stmt.sourceTable}_to_${stmt.targetTable}_${sqlDialect}`;
                            }
                          }
                          
                          const blob = new Blob([sql], { type: 'text/sql' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${filename}.sql`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        sx={{ 
                          color: 'neutral.500', 
                          '&:hover': { color: 'success.main', bgcolor: 'success.100' } 
                        }}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                
                {/* SQL Content */}
                <Box sx={{ flex: 1, overflow: 'auto', p: 2.5, bgcolor: '#142329' }}>
                  <Typography
                    component="pre"
                    sx={{
                      fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
                      fontSize: '13px',
                      color: '#A9D4B6',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      m: 0,
                      lineHeight: 1.8,
                    }}
                  >
                    {(() => {
                      const options = { dialect: sqlDialect, includeComments: true, useTruncate: false };
                      
                      if (sqlViewMode === 'full') {
                        return fullScript || '-- No SQL generated';
                      } else if (sqlViewMode === 'level') {
                        if (selectedLevel === null) {
                          return '-- Select a level from the left panel';
                        }
                        const levelStmts = groupSQLByLevel(generatedSQL).get(selectedLevel);
                        if (!levelStmts || levelStmts.length === 0) {
                          return '-- No tables in this level';
                        }
                        return generateLevelScript(selectedLevel, levelStmts, options);
                      } else if (sqlViewMode === 'table') {
                        if (!selectedSQLTable) {
                          return '-- Select a table from the left panel';
                        }
                        const stmt = generatedSQL.find(s => s.targetTable === selectedSQLTable);
                        if (!stmt) {
                          return '-- Table not found';
                        }
                        return generateSingleTableScript(stmt, options);
                      }
                      return '-- No SQL generated';
                    })()}
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ 
          borderTop: 1, 
          borderColor: 'neutral.100', 
          p: 2, 
          bgcolor: 'neutral.800',
          justifyContent: 'space-between',
        }}>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Chip
              size="small"
              label={`${generatedSQL.reduce((sum, s) => sum + s.columnCount, 0)} columns mapped`}
              sx={{ bgcolor: 'primary.100', color: 'primary.main' }}
            />
            <Chip
              size="small"
              label={`${tableMappings.length} source tables`}
              sx={{ bgcolor: 'neutral.200', color: 'neutral.500' }}
            />
          </Box>
          <Button 
            onClick={() => setSqlDialog(false)} 
            variant="outlined"
            sx={{ 
              color: 'neutral.500', 
              borderColor: 'neutral.200',
              '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
            }}
          >
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

// Table Card Component
interface TableCardProps {
  table: TableDependency;
  levelColor: string;
  isSelected: boolean;
  onClick: () => void;
  getComplexityColor: (c: 'low' | 'medium' | 'high') => 'success' | 'warning' | 'error';
}

const TableCard = ({ table, levelColor, isSelected, onClick, getComplexityColor }: TableCardProps) => (
  <Card
    onClick={onClick}
    sx={{
      bgcolor: isSelected ? 'info.100' : 'primary.600',
      border: 2,
      borderColor: isSelected ? 'info.main' : 'primary.500',
      borderRadius: 2,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        bgcolor: isSelected ? 'info.200' : 'primary.500',
        borderColor: isSelected ? 'info.400' : 'primary.400',
        transform: 'translateY(-2px)',
      },
    }}
  >
    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TableIcon sx={{ color: levelColor, fontSize: 20 }} />
          <Typography 
            variant="body2Medium" 
            sx={{ 
              color: isSelected ? 'primary.700' : 'white.main',
              wordBreak: 'break-all',
            }}
          >
            {table.tableName}
          </Typography>
        </Box>
        <Chip
          label={table.estimatedComplexity}
          size="small"
          color={getComplexityColor(table.estimatedComplexity)}
          sx={{ height: 20, fontSize: '10px' }}
        />
      </Box>
      
      <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption1" sx={{ color: isSelected ? 'primary.500' : 'neutral.400' }}>Cols:</Typography>
          <Typography variant="caption1Medium" sx={{ color: isSelected ? 'primary.600' : 'neutral.300' }}>{table.columnCount}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption1" sx={{ color: isSelected ? 'primary.500' : 'neutral.400' }}>FKs:</Typography>
          <Typography variant="caption1Medium" sx={{ color: isSelected ? 'secondary.600' : 'secondary.300' }}>{table.foreignKeys.length}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption1" sx={{ color: isSelected ? 'primary.500' : 'neutral.400' }}>Deps:</Typography>
          <Typography variant="caption1Medium" sx={{ color: isSelected ? 'primary.600' : 'neutral.300' }}>{table.dependsOn.length}</Typography>
        </Box>
      </Box>
      
      {table.foreignKeys.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {table.foreignKeys.slice(0, 2).map((fk, idx) => (
              <Chip
                key={idx}
                label={`${fk.columnName} → ${fk.referencesTable}`}
                size="small"
                icon={<LinkIcon sx={{ fontSize: '12px !important' }} />}
                sx={{
                  height: 22,
                  fontSize: '10px',
                  bgcolor: 'secondary.100',
                  color: 'secondary.700',
                  '& .MuiChip-icon': { color: 'secondary.500' },
                }}
              />
            ))}
            {table.foreignKeys.length > 2 && (
              <Chip
                label={`+${table.foreignKeys.length - 2} FK`}
                size="small"
                sx={{
                  height: 22,
                  fontSize: '10px',
                  bgcolor: 'neutral.200',
                  color: 'neutral.700',
                }}
              />
            )}
          </Box>
        </Box>
      )}
    </CardContent>
  </Card>
);

// Details Panel Component
interface TableDetailsPanelProps {
  table: TableDependency;
  getLevelColor: (level: number) => string;
  getComplexityColor: (c: 'low' | 'medium' | 'high') => 'success' | 'warning' | 'error';
  onSelectTable: (name: string) => void;
  onCopyJSON: (tableName: string) => void;
}

const TableDetailsPanel = ({ table, getLevelColor, getComplexityColor, onSelectTable, onCopyJSON }: TableDetailsPanelProps) => (
  <Box sx={{ p: 3 }}>
    {/* Header */}
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TableIcon sx={{ color: getLevelColor(table.level), fontSize: 28 }} />
          <Typography variant="h3Bold" sx={{ color: 'white.main', wordBreak: 'break-all' }}>
            {table.tableName}
          </Typography>
        </Box>
        <Tooltip title="Copy table JSON">
          <IconButton 
            size="small" 
            onClick={() => onCopyJSON(table.tableName)}
            sx={{ 
              color: 'secondary.main',
              bgcolor: 'secondary.100',
              '&:hover': { bgcolor: 'secondary.200' },
            }}
          >
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          label={`Level ${table.level}`}
          size="small"
          sx={{ bgcolor: getLevelColor(table.level), color: 'white.main', fontWeight: 600 }}
        />
        <Chip
          label={`${table.estimatedComplexity} complexity`}
          size="small"
          color={getComplexityColor(table.estimatedComplexity)}
        />
      </Box>
    </Box>
    
    <Divider sx={{ borderColor: 'primary.500', my: 2 }} />
    
    {/* Stats */}
    <Box sx={{ mb: 3 }}>
      <Typography variant="body2Medium" sx={{ color: 'neutral.300', mb: 1.5 }}>
        Statistics
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        <Paper sx={{ p: 1.5, bgcolor: 'primary.700', borderRadius: 1 }}>
          <Typography variant="caption1" sx={{ color: 'neutral.400' }}>Columns</Typography>
          <Typography variant="body1Bold" sx={{ color: 'white.main' }}>{table.columnCount}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5, bgcolor: 'primary.700', borderRadius: 1 }}>
          <Typography variant="caption1" sx={{ color: 'neutral.400' }}>Migration Order</Typography>
          <Typography variant="body1Bold" sx={{ color: 'white.main' }}>#{table.level + 1}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5, bgcolor: 'primary.700', borderRadius: 1 }}>
          <Typography variant="caption1" sx={{ color: 'neutral.400' }}>Foreign Keys</Typography>
          <Typography variant="body1Bold" sx={{ color: 'secondary.main' }}>{table.foreignKeys.length}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5, bgcolor: 'primary.700', borderRadius: 1 }}>
          <Typography variant="caption1" sx={{ color: 'neutral.400' }}>Depends On</Typography>
          <Typography variant="body1Bold" sx={{ color: 'warning.main' }}>{table.dependsOn.length}</Typography>
        </Paper>
      </Box>
    </Box>
    
    <Divider sx={{ borderColor: 'primary.500', my: 2 }} />
    
    {/* Foreign Keys Table */}
    <Box sx={{ mb: 3 }}>
      <Typography variant="body2Medium" sx={{ color: 'neutral.300', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinkIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
        Foreign Keys ({table.foreignKeys.length})
      </Typography>
      {table.foreignKeys.length > 0 ? (
        <Paper sx={{ bgcolor: 'primary.700', borderRadius: 1, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'primary.600' }}>
                  <TableCell sx={{ color: 'neutral.300', fontWeight: 600, fontSize: '11px', py: 1 }}>
                    Column
                  </TableCell>
                  <TableCell sx={{ color: 'neutral.300', fontWeight: 600, fontSize: '11px', py: 1 }}>
                    References
                  </TableCell>
                  <TableCell sx={{ color: 'neutral.300', fontWeight: 600, fontSize: '11px', py: 1 }}>
                    Type
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {table.foreignKeys.map((fk, idx) => (
                  <TableRow 
                    key={idx}
                    onClick={() => onSelectTable(fk.referencesTable)}
                    sx={{ 
                      bgcolor: idx % 2 === 0 ? 'primary.700' : 'primary.600',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'primary.500' },
                    }}
                  >
                    <TableCell sx={{ py: 1 }}>
                      <Typography variant="caption1Medium" sx={{ color: 'white.main' }}>
                        {fk.columnName}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Tooltip title={`Go to ${fk.referencesTable}`}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <TableIcon sx={{ fontSize: 14, color: 'secondary.main' }} />
                          <Typography variant="caption1Medium" sx={{ color: 'secondary.300' }}>
                            {fk.referencesTable}
                          </Typography>
                          <Typography variant="caption1" sx={{ color: 'neutral.400' }}>
                            .{fk.referencesColumn}
                          </Typography>
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Chip
                        size="small"
                        label={fk.isExplicit ? 'Explicit' : 'Inferred'}
                        sx={{
                          height: 18,
                          fontSize: '9px',
                          bgcolor: fk.isExplicit ? 'info.100' : 'neutral.200',
                          color: fk.isExplicit ? 'info.700' : 'neutral.600',
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ) : (
        <Paper sx={{ p: 2, bgcolor: 'primary.700', borderRadius: 1 }}>
          <Typography variant="body2" sx={{ color: 'neutral.300' }}>
            No foreign keys detected
          </Typography>
        </Paper>
      )}
    </Box>
    
    <Divider sx={{ borderColor: 'primary.500', my: 2 }} />
    
    {/* Dependencies */}
    <Box sx={{ mb: 3 }}>
      <Typography variant="body2Medium" sx={{ color: 'neutral.300', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon sx={{ fontSize: 16, color: 'warning.main' }} />
        Depends On ({table.dependsOn.length})
      </Typography>
      {table.dependsOn.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {table.dependsOn.map((dep) => (
            <Paper
              key={dep}
              onClick={() => onSelectTable(dep)}
              sx={{
                p: 1.5,
                bgcolor: 'warning.100',
                border: 1,
                borderColor: 'warning.300',
                borderRadius: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                transition: 'all 0.2s ease',
                '&:hover': { bgcolor: 'warning.200' },
              }}
            >
              <ArrowIcon sx={{ color: 'warning.500', fontSize: 16, transform: 'rotate(180deg)' }} />
              <Typography variant="body2" sx={{ color: 'warning.700' }}>{dep}</Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        <Paper sx={{ p: 2, bgcolor: 'success.100', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckIcon sx={{ color: 'success.500', fontSize: 18 }} />
            <Typography variant="body2" sx={{ color: 'success.700' }}>
              No dependencies - can be migrated first!
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
    
    <Divider sx={{ borderColor: 'primary.500', my: 2 }} />
    
    {/* Depended By */}
    <Box>
      <Typography variant="body2Medium" sx={{ color: 'neutral.300', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />
        Depended By ({table.dependedBy.length})
      </Typography>
      {table.dependedBy.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {table.dependedBy.map((dep) => (
            <Paper
              key={dep}
              onClick={() => onSelectTable(dep)}
              sx={{
                p: 1.5,
                bgcolor: 'success.100',
                border: 1,
                borderColor: 'success.300',
                borderRadius: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                transition: 'all 0.2s ease',
                '&:hover': { bgcolor: 'success.200' },
              }}
            >
              <ArrowIcon sx={{ color: 'success.500', fontSize: 16 }} />
              <Typography variant="body2" sx={{ color: 'success.700' }}>{dep}</Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        <Paper sx={{ p: 2, bgcolor: 'primary.700', borderRadius: 1 }}>
          <Typography variant="body2" sx={{ color: 'neutral.300' }}>
            No other tables depend on this table
          </Typography>
        </Paper>
      )}
    </Box>
  </Box>
);
