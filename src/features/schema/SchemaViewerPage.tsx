import { useState, useMemo } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Button, 
  Chip,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Checkbox,
  Select,
  MenuItem,
  FormControl,
} from '@mui/material';
import {
  Storage as DatabaseIcon,
  CompareArrows as CompareIcon,
  Edit as EditIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Visibility as PreviewIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  selectSourceTables, 
  selectSourceIsLoaded,
  selectSourceStats,
  updateColumn as updateSourceColumn,
  updateTable as updateSourceTable,
  addColumn as addSourceColumn,
  removeColumn as removeSourceColumn,
  addTable as addSourceTable,
  removeTable as removeSourceTable,
} from '../sourceSchema/sourceSchemaSlice';
import { 
  selectTargetTables, 
  selectTargetIsLoaded,
  selectTargetStats,
  updateColumn as updateTargetColumn,
  updateTable as updateTargetTable,
  addColumn as addTargetColumn,
  removeColumn as removeTargetColumn,
  addTable as addTargetTable,
  removeTable as removeTargetTable,
} from '../targetSchema/targetSchemaSlice';
import { SourceSchemaPanel } from '../sourceSchema';
import { TargetSchemaPanel } from '../targetSchema';
import type { Table as TableType, Column } from '../../types';

// Schema Edit Dialog Component - Two Panel Layout
function SchemaEditDialog({
  open,
  onClose,
  schemaType,
  tables,
  allTables,
  onUpdateColumn,
  onUpdateTable,
  onAddColumn,
  onRemoveColumn,
  onAddTable,
  onRemoveTable,
}: {
  open: boolean;
  onClose: () => void;
  schemaType: 'source' | 'target';
  tables: TableType[];
  allTables: TableType[];
  onUpdateColumn: (tableName: string, columnName: string, updates: Partial<Column>) => void;
  onUpdateTable: (oldName: string, newName: string) => void;
  onAddColumn: (tableName: string, column: Column) => void;
  onRemoveColumn: (tableName: string, columnName: string) => void;
  onAddTable: (table: TableType) => void;
  onRemoveTable: (tableName: string) => void;
}) {
  const [selectedTable, setSelectedTable] = useState<string | null>(tables[0]?.name || null);
  const [copiedTable, setCopiedTable] = useState<string | null>(null);
  const handleCopyTableName = (name: string) => {
    navigator.clipboard.writeText(name).then(() => {
      setCopiedTable(name);
      setTimeout(() => setCopiedTable((c) => (c === name ? null : c)), 1200);
    });
  };

  // Live data preview (sample rows) for a table.
  const [preview, setPreview] = useState<{ table: string; columns: string[]; rows: any[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const handlePreviewData = async (name: string) => {
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`http://localhost:9005/api/preview/${schemaType}/${encodeURIComponent(name)}?limit=50`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load preview');
      setPreview({ table: name, columns: data.columns ?? [], rows: data.rows ?? [] });
    } catch (e: any) {
      setPreview({ table: name, columns: [], rows: [] });
      setPreviewError(e.message || 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  };
  const [editingTableName, setEditingTableName] = useState<string | null>(null);
  const [newTableName, setNewTableName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnData, setNewColumnData] = useState<Partial<Column>>({
    name: '',
    type: 'VARCHAR',
    nullable: true,
    isPrimaryKey: false,
    isForeignKey: false,
  });
  const [newColumnFKRef, setNewColumnFKRef] = useState<string>('');
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTable, setNewTable] = useState({ name: '' });

  const colorScheme = schemaType === 'source' 
    ? { main: '#2A4954', bg: '#F2F7FA', border: '#CFE4EF', light: '#E7F1F7', dark: '#1F4657' }
    : { main: '#3D82A6', bg: '#F2F7FA', border: '#CFE4EF', light: '#E7F1F7', dark: '#2D6079' };

  // Filter tables by search query
  const filteredTables = useMemo(() => {
    if (!searchQuery) return tables;
    return tables.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [tables, searchQuery]);

  // Get selected table data
  const currentTable = tables.find(t => t.name === selectedTable);

  const handleColumnChange = (
    columnName: string, 
    field: keyof Column, 
    value: string | boolean
  ) => {
    if (!selectedTable) return;
    const updates: Partial<Column> = {};
    
    if (field === 'name' && typeof value === 'string') {
      updates.name = value;
    } else if (field === 'type' && typeof value === 'string') {
      updates.type = value;
    } else if (field === 'nullable' && typeof value === 'boolean') {
      updates.nullable = value;
    } else if (field === 'isPrimaryKey' && typeof value === 'boolean') {
      updates.isPrimaryKey = value;
    } else if (field === 'isForeignKey' && typeof value === 'boolean') {
      updates.isForeignKey = value;
      if (!value) {
        updates.foreignKeyRef = undefined;
      }
    } else if (field === 'foreignKeyRef' && typeof value === 'string') {
      // Update FK reference: value is the table name, column defaults to 'id'
      if (value) {
        updates.foreignKeyRef = { table: value, column: 'id' };
      } else {
        updates.foreignKeyRef = undefined;
      }
    }
    
    onUpdateColumn(selectedTable, columnName, updates);
  };

  const handleSaveTableName = (oldName: string) => {
    if (newTableName && newTableName !== oldName) {
      onUpdateTable(oldName, newTableName);
      setSelectedTable(newTableName);
    }
    setEditingTableName(null);
    setNewTableName('');
  };

  const handleAddColumn = () => {
    if (!selectedTable || !newColumnData.name) return;
    onAddColumn(selectedTable, {
      name: newColumnData.name,
      type: newColumnData.type || 'VARCHAR',
      nullable: newColumnData.nullable ?? true,
      isPrimaryKey: newColumnData.isPrimaryKey ?? false,
      isForeignKey: newColumnData.isForeignKey ?? false,
      foreignKeyRef: newColumnData.isForeignKey && newColumnFKRef
        ? { table: newColumnFKRef, column: 'id' }
        : undefined,
    });
    setAddingColumn(false);
    setNewColumnData({
      name: '',
      type: 'VARCHAR',
      nullable: true,
      isPrimaryKey: false,
      isForeignKey: false,
    });
    setNewColumnFKRef('');
  };

  const handleAddTable = () => {
    if (newTable.name) {
      onAddTable({
        name: newTable.name,
        columns: [],
      });
      setSelectedTable(newTable.name);
      setNewTable({ name: '' });
      setShowAddTable(false);
    }
  };

  const handleDeleteTable = (tableName: string) => {
    if (confirm(`Delete table "${tableName}"?`)) {
      onRemoveTable(tableName);
      if (selectedTable === tableName) {
        setSelectedTable(tables.find(t => t.name !== tableName)?.name || null);
      }
    }
  };

  // Get all table names for FK reference dropdown
  const allTableNames = allTables.map(t => t.name);

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl" 
      fullWidth
      PaperProps={{ sx: { height: '85vh', bgcolor: '#F7F7F6' } }}
    >
      <DialogTitle sx={{ 
        borderBottom: 1, 
        borderColor: 'divider', 
        display: 'flex', 
        alignItems: 'center', 
        gap: 2,
        bgcolor: colorScheme.bg,
        py: 1.5,
      }}>
        <EditIcon sx={{ color: colorScheme.main }} />
        <Typography variant="h6" sx={{ color: colorScheme.dark, flex: 1, fontWeight: 600 }}>
          Edit {schemaType === 'source' ? 'Source' : 'Target'} Schema
        </Typography>
        <Chip 
          label={`${tables.length} Tables`} 
          size="small"
          sx={{ bgcolor: colorScheme.light, color: colorScheme.dark }}
        />
      </DialogTitle>
      
      <DialogContent sx={{ p: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Left Panel - Tables List */}
        <Box sx={{ 
          width: 280, 
          borderRight: 1, 
          borderColor: 'divider', 
          display: 'flex', 
          flexDirection: 'column',
          bgcolor: 'white',
        }}>
          {/* Search & Add Table */}
          <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              size="small"
              placeholder="Search tables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              fullWidth
              sx={{ mb: 1 }}
            />
            {showAddTable ? (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Table name"
                  value={newTable.name}
                  onChange={(e) => setNewTable({ name: e.target.value })}
                  sx={{ flex: 1 }}
                  autoFocus
                />
                <IconButton size="small" onClick={handleAddTable} disabled={!newTable.name} sx={{ color: 'success.main' }}>
                  <SaveIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={() => setShowAddTable(false)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ) : (
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setShowAddTable(true)}
                fullWidth
                sx={{ 
                  bgcolor: colorScheme.light, 
                  color: colorScheme.dark,
                  '&:hover': { bgcolor: colorScheme.border },
                }}
              >
                Add Table
              </Button>
            )}
          </Box>
          
          {/* Tables List */}
          <Box sx={{ 
            flex: 1, 
            overflow: 'auto',
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(39, 38, 38,0.08)', borderRadius: 3 },
          }}>
            {filteredTables.map((table) => (
              <Box
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  cursor: 'pointer',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: selectedTable === table.name ? colorScheme.light : 'transparent',
                  borderLeft: selectedTable === table.name ? `3px solid ${colorScheme.main}` : '3px solid transparent',
                  '&:hover': { bgcolor: colorScheme.bg },
                }}
              >
                <DatabaseIcon sx={{ fontSize: 18, color: colorScheme.main }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      fontWeight: selectedTable === table.name ? 600 : 400,
                      color: selectedTable === table.name ? colorScheme.dark : 'text.primary',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {table.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {table.columns.length} columns
                  </Typography>
                </Box>
                <Tooltip title="Preview data">
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handlePreviewData(table.name); }}
                    sx={{ color: 'text.secondary', opacity: 0.6, '&:hover': { opacity: 1 } }}
                  >
                    <PreviewIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={copiedTable === table.name ? 'Copied!' : 'Copy table name'}>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleCopyTableName(table.name); }}
                    sx={{ color: copiedTable === table.name ? 'success.main' : 'text.secondary', opacity: 0.6, '&:hover': { opacity: 1 } }}
                  >
                    {copiedTable === table.name
                      ? <CheckIcon sx={{ fontSize: 16 }} />
                      : <CopyIcon sx={{ fontSize: 16 }} />}
                  </IconButton>
                </Tooltip>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); handleDeleteTable(table.name); }}
                  sx={{ color: 'error.light', opacity: 0.5, '&:hover': { opacity: 1 } }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            ))}
            {filteredTables.length === 0 && (
              <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                {searchQuery ? 'No tables match search' : 'No tables'}
              </Box>
            )}
          </Box>
        </Box>

        {/* Right Panel - Table Columns */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {currentTable ? (
            <>
              {/* Table Header */}
              <Box sx={{ 
                px: 2, 
                py: 1.5, 
                bgcolor: 'white', 
                borderBottom: 1, 
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}>
                {editingTableName === currentTable.name ? (
                  <Box sx={{ display: 'flex', gap: 1, flex: 1 }}>
                    <TextField
                      size="small"
                      value={newTableName}
                      onChange={(e) => setNewTableName(e.target.value)}
                      autoFocus
                      sx={{ flex: 1 }}
                    />
                    <Button 
                      size="small" 
                      variant="contained"
                      onClick={() => handleSaveTableName(currentTable.name)}
                      sx={{ bgcolor: colorScheme.main }}
                    >
                      Save
                    </Button>
                    <Button 
                      size="small"
                      onClick={() => { setEditingTableName(null); setNewTableName(''); }}
                    >
                      Cancel
                    </Button>
                  </Box>
                ) : (
                  <>
                    <Typography variant="h6" sx={{ color: colorScheme.dark, fontWeight: 600, flex: 1 }}>
                      {currentTable.name}
                    </Typography>
                    <Chip 
                      label={`${currentTable.columns.length} columns`} 
                      size="small"
                      sx={{ bgcolor: colorScheme.light, color: colorScheme.dark }}
                    />
                    <Tooltip title="Rename Table">
                      <IconButton 
                        size="small"
                        onClick={() => { 
                          setEditingTableName(currentTable.name); 
                          setNewTableName(currentTable.name);
                        }}
                        sx={{ color: colorScheme.main }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => setAddingColumn(true)}
                      sx={{ 
                        bgcolor: colorScheme.main, 
                        color: 'white',
                        '&:hover': { bgcolor: colorScheme.dark },
                      }}
                    >
                      Add Column
                    </Button>
                  </>
                )}
              </Box>

              {/* Columns Table */}
              <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark }}>Column Name</TableCell>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark }}>Data Type</TableCell>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark, textAlign: 'center', width: 80 }}>Nullable</TableCell>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark, textAlign: 'center', width: 60 }}>PK</TableCell>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark, textAlign: 'center', width: 60 }}>FK</TableCell>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark, width: 180 }}>FK Reference</TableCell>
                        <TableCell sx={{ fontWeight: 600, bgcolor: colorScheme.bg, color: colorScheme.dark, width: 60 }}></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {/* Add Column Row */}
                      {addingColumn && (
                        <TableRow sx={{ bgcolor: colorScheme.bg }}>
                          <TableCell>
                            <TextField
                              size="small"
                              value={newColumnData.name}
                              onChange={(e) => setNewColumnData(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="column_name"
                              variant="outlined"
                              fullWidth
                              autoFocus
                              sx={{ bgcolor: 'white' }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={newColumnData.type}
                              onChange={(e) => setNewColumnData(prev => ({ ...prev, type: e.target.value }))}
                              placeholder="VARCHAR"
                              variant="outlined"
                              fullWidth
                              sx={{ bgcolor: 'white' }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={newColumnData.nullable ?? true}
                              onChange={(e) => setNewColumnData(prev => ({ ...prev, nullable: e.target.checked }))}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={newColumnData.isPrimaryKey ?? false}
                              onChange={(e) => setNewColumnData(prev => ({ ...prev, isPrimaryKey: e.target.checked }))}
                              size="small"
                              sx={{ color: 'warning.main', '&.Mui-checked': { color: 'warning.main' } }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={newColumnData.isForeignKey ?? false}
                              onChange={(e) => {
                                setNewColumnData(prev => ({ ...prev, isForeignKey: e.target.checked }));
                                if (!e.target.checked) {
                                  setNewColumnFKRef('');
                                }
                              }}
                              size="small"
                              sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                            />
                          </TableCell>
                          <TableCell>
                            {newColumnData.isForeignKey && (
                              <FormControl size="small" fullWidth>
                                <Select
                                  value={newColumnFKRef}
                                  onChange={(e) => setNewColumnFKRef(e.target.value)}
                                  displayEmpty
                                  sx={{ bgcolor: 'white' }}
                                >
                                  <MenuItem value=""><em>Select table</em></MenuItem>
                                  {allTableNames.map(tName => (
                                    <MenuItem key={tName} value={tName}>{tName}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <IconButton size="small" onClick={handleAddColumn} disabled={!newColumnData.name} sx={{ color: 'success.main' }}>
                                <SaveIcon fontSize="small" />
                              </IconButton>
                              <IconButton size="small" onClick={() => setAddingColumn(false)} sx={{ color: 'error.main' }}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )}
                      
                      {currentTable.columns.map((column) => (
                        <TableRow key={column.name} hover>
                          <TableCell>
                            <TextField
                              size="small"
                              value={column.name}
                              onChange={(e) => handleColumnChange(column.name, 'name', e.target.value)}
                              variant="standard"
                              fullWidth
                              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontWeight: 500 } }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={column.type}
                              onChange={(e) => handleColumnChange(column.name, 'type', e.target.value)}
                              variant="standard"
                              fullWidth
                              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={column.nullable}
                              onChange={(e) => handleColumnChange(column.name, 'nullable', e.target.checked)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={column.isPrimaryKey || false}
                              onChange={(e) => handleColumnChange(column.name, 'isPrimaryKey', e.target.checked)}
                              size="small"
                              sx={{ color: 'warning.main', '&.Mui-checked': { color: 'warning.main' } }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={column.isForeignKey || false}
                              onChange={(e) => handleColumnChange(column.name, 'isForeignKey', e.target.checked)}
                              size="small"
                              sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                            />
                          </TableCell>
                          <TableCell>
                            {column.isForeignKey && (
                              <FormControl size="small" fullWidth variant="standard">
                                <Select
                                  value={
                                    typeof column.foreignKeyRef === 'string' 
                                      ? column.foreignKeyRef 
                                      : (column.foreignKeyRef as any)?.table || ''
                                  }
                                  onChange={(e) => handleColumnChange(column.name, 'foreignKeyRef', e.target.value)}
                                  displayEmpty
                                >
                                  <MenuItem value=""><em>Select table</em></MenuItem>
                                  {allTableNames.map(tName => (
                                    <MenuItem key={tName} value={tName}>{tName}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            )}
                          </TableCell>
                          <TableCell>
                            <IconButton
                              size="small"
                              onClick={() => {
                                if (confirm(`Delete column "${column.name}"?`)) {
                                  onRemoveColumn(currentTable.name, column.name);
                                }
                              }}
                              sx={{ color: 'error.light', '&:hover': { color: 'error.main' } }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                      
                      {currentTable.columns.length === 0 && !addingColumn && (
                        <TableRow>
                          <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                            No columns. Click "Add Column" to create one.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                Select a table from the left to edit its columns
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, bgcolor: 'white' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1 }}>
          ✓ Changes are auto-saved
        </Typography>
        <Button onClick={onClose} variant="contained" sx={{ bgcolor: colorScheme.main, '&:hover': { bgcolor: colorScheme.dark } }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>

    {/* Source/target data preview */}
    <Dialog
      open={previewLoading || !!preview}
      onClose={() => { setPreview(null); setPreviewError(null); }}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2 } }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <PreviewIcon fontSize="small" />
        <Typography variant="h6" sx={{ flex: 1 }}>
          {schemaType === 'source' ? 'Source' : 'Target'} data preview{preview ? ` — ${preview.table}` : ''}
        </Typography>
        {preview && <Chip size="small" label={`${preview.rows.length} row(s)`} />}
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {previewLoading && <Typography sx={{ py: 2, color: 'text.secondary' }}>Loading…</Typography>}
        {previewError && <Typography sx={{ py: 2, color: 'error.main' }}>{previewError}</Typography>}
        {!previewLoading && !previewError && preview && preview.rows.length === 0 && (
          <Typography sx={{ py: 2, color: 'text.secondary' }}>No rows.</Typography>
        )}
        {!previewLoading && !previewError && preview && preview.rows.length > 0 && (
          <TableContainer sx={{ maxHeight: 460 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {preview.columns.map((c) => (
                    <TableCell key={c} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.rows.map((row, i) => (
                  <TableRow key={i} hover>
                    {preview.columns.map((c) => {
                      const v = row[c];
                      const text = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                      return (
                        <TableCell key={c} sx={{ whiteSpace: 'nowrap', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', color: v === null || v === undefined ? 'text.disabled' : 'text.primary' }}>
                          {v === null || v === undefined ? 'NULL' : text}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={() => { setPreview(null); setPreviewError(null); }}>Close</Button>
      </DialogActions>
    </Dialog>
    </>
  );
}

export default function SchemaViewerPage() {
  const dispatch = useAppDispatch();
  const [activePanel, setActivePanel] = useState<'both' | 'source' | 'target'>('both');
  const [editingSchema, setEditingSchema] = useState<'source' | 'target' | null>(null);
  
  const sourceLoaded = useAppSelector(selectSourceIsLoaded);
  const targetLoaded = useAppSelector(selectTargetIsLoaded);
  const sourceTables = useAppSelector(selectSourceTables);
  const targetTables = useAppSelector(selectTargetTables);
  const sourceStats = useAppSelector(selectSourceStats);
  const targetStats = useAppSelector(selectTargetStats);

  // Source schema handlers
  const handleUpdateSourceColumn = (tableName: string, columnName: string, updates: Partial<Column>) => {
    dispatch(updateSourceColumn({ tableName, columnName, updates }));
  };
  const handleUpdateSourceTable = (oldName: string, newName: string) => {
    dispatch(updateSourceTable({ oldName, newName }));
  };
  const handleAddSourceColumn = (tableName: string, column: Column) => {
    dispatch(addSourceColumn({ tableName, column }));
  };
  const handleRemoveSourceColumn = (tableName: string, columnName: string) => {
    dispatch(removeSourceColumn({ tableName, columnName }));
  };
  const handleAddSourceTable = (table: TableType) => {
    dispatch(addSourceTable(table));
  };
  const handleRemoveSourceTable = (tableName: string) => {
    dispatch(removeSourceTable(tableName));
  };

  // Target schema handlers
  const handleUpdateTargetColumn = (tableName: string, columnName: string, updates: Partial<Column>) => {
    dispatch(updateTargetColumn({ tableName, columnName, updates }));
  };
  const handleUpdateTargetTable = (oldName: string, newName: string) => {
    dispatch(updateTargetTable({ oldName, newName }));
  };
  const handleAddTargetColumn = (tableName: string, column: Column) => {
    dispatch(addTargetColumn({ tableName, column }));
  };
  const handleRemoveTargetColumn = (tableName: string, columnName: string) => {
    dispatch(removeTargetColumn({ tableName, columnName }));
  };
  const handleAddTargetTable = (table: TableType) => {
    dispatch(addTargetTable(table));
  };
  const handleRemoveTargetTable = (tableName: string) => {
    dispatch(removeTargetTable(tableName));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'neutral.100' }}>
      {/* Header Bar */}
      <Paper 
        elevation={0}
        sx={{ 
          px: 3, 
          py: 2, 
          borderBottom: 1, 
          borderColor: 'neutral.200',
          bgcolor: 'white.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <DatabaseIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Box>
            <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
              Database Schemas
            </Typography>
            <Typography variant="body2" sx={{ color: 'neutral.500' }}>
              View and manage source and target database schemas
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* View Toggle */}
          <Tabs 
            value={activePanel} 
            onChange={(_, val) => setActivePanel(val)}
            sx={{
              minHeight: 36,
              bgcolor: 'neutral.100',
              borderRadius: 1,
              p: 0.5,
              '& .MuiTab-root': {
                minHeight: 28,
                py: 0.5,
                px: 2,
                textTransform: 'none',
                fontSize: '0.8rem',
                color: 'neutral.600',
                '&.Mui-selected': {
                  color: 'primary.main',
                  bgcolor: 'white.main',
                  borderRadius: 0.5,
                },
              },
              '& .MuiTabs-indicator': { display: 'none' },
            }}
          >
            <Tab value="both" label="Both" />
            <Tab value="source" label="Source Only" />
            <Tab value="target" label="Target Only" />
          </Tabs>

          {/* Stats & Edit Buttons */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Tooltip title="Edit Source Schema">
              <span>
                <Button
                  size="small"
                  startIcon={<EditIcon />}
                  onClick={() => setEditingSchema('source')}
                  disabled={!sourceLoaded}
                  sx={{ 
                    bgcolor: 'primary.100', 
                    color: 'primary.main',
                    '&:hover': { bgcolor: 'primary.200' },
                    '&:disabled': { bgcolor: 'neutral.100' },
                  }}
                >
                  Edit Source
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Edit Target Schema">
              <span>
                <Button
                  size="small"
                  startIcon={<EditIcon />}
                  onClick={() => setEditingSchema('target')}
                  disabled={!targetLoaded}
                  sx={{ 
                    bgcolor: 'secondary.100', 
                    color: 'secondary.main',
                    '&:hover': { bgcolor: 'secondary.200' },
                    '&:disabled': { bgcolor: 'neutral.100' },
                  }}
                >
                  Edit Target
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Paper>

      {/* Schema Stats Summary */}
      <Box sx={{ px: 3, py: 2, display: 'flex', gap: 2 }}>
        {/* Source Stats Card */}
        <Paper 
          sx={{ 
            flex: 1, 
            p: 2, 
            bgcolor: 'primary.50', 
            border: 1, 
            borderColor: 'primary.200',
            display: activePanel === 'target' ? 'none' : 'block',
          }}
        >
          <Typography variant="body2Bold" sx={{ color: 'primary.main', mb: 1 }}>
            📊 Source Schema Stats
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
                {sourceStats.totalTables}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Tables</Typography>
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
                {sourceStats.totalColumns}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Columns</Typography>
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'warning.main' }}>
                {sourceStats.totalPrimaryKeys}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Primary Keys</Typography>
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'info.main' }}>
                {sourceStats.totalForeignKeys}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Foreign Keys</Typography>
            </Box>
          </Box>
        </Paper>

        {/* Compare Icon */}
        {activePanel === 'both' && (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <CompareIcon sx={{ fontSize: 32, color: 'neutral.400' }} />
          </Box>
        )}

        {/* Target Stats Card */}
        <Paper 
          sx={{ 
            flex: 1, 
            p: 2, 
            bgcolor: 'secondary.50', 
            border: 1, 
            borderColor: 'secondary.200',
            display: activePanel === 'source' ? 'none' : 'block',
          }}
        >
          <Typography variant="body2Bold" sx={{ color: 'secondary.main', mb: 1 }}>
            📊 Target Schema Stats
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'secondary.main' }}>
                {targetStats.totalTables}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Tables</Typography>
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'secondary.main' }}>
                {targetStats.totalColumns}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Columns</Typography>
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'warning.main' }}>
                {targetStats.totalPrimaryKeys}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Primary Keys</Typography>
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'info.main' }}>
                {targetStats.totalForeignKeys}
              </Typography>
              <Typography variant="caption" sx={{ color: 'neutral.500' }}>Foreign Keys</Typography>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Schema Panels */}
      <Box sx={{ flex: 1, display: 'flex', gap: 2, px: 3, pb: 3, overflow: 'hidden' }}>
        {/* Source Schema Panel */}
        {(activePanel === 'both' || activePanel === 'source') && (
          <Paper 
            sx={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              overflow: 'hidden',
              border: 1,
              borderColor: 'primary.200',
            }}
          >
            <SourceSchemaPanel />
          </Paper>
        )}

        {/* Target Schema Panel */}
        {(activePanel === 'both' || activePanel === 'target') && (
          <Paper 
            sx={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              overflow: 'hidden',
              border: 1,
              borderColor: 'secondary.200',
            }}
          >
            <TargetSchemaPanel />
          </Paper>
        )}
      </Box>

      {/* Source Schema Edit Dialog */}
      <SchemaEditDialog
        open={editingSchema === 'source'}
        onClose={() => setEditingSchema(null)}
        schemaType="source"
        tables={sourceTables}
        allTables={sourceTables}
        onUpdateColumn={handleUpdateSourceColumn}
        onUpdateTable={handleUpdateSourceTable}
        onAddColumn={handleAddSourceColumn}
        onRemoveColumn={handleRemoveSourceColumn}
        onAddTable={handleAddSourceTable}
        onRemoveTable={handleRemoveSourceTable}
      />

      {/* Target Schema Edit Dialog */}
      <SchemaEditDialog
        open={editingSchema === 'target'}
        onClose={() => setEditingSchema(null)}
        schemaType="target"
        tables={targetTables}
        allTables={targetTables}
        onUpdateColumn={handleUpdateTargetColumn}
        onUpdateTable={handleUpdateTargetTable}
        onAddColumn={handleAddTargetColumn}
        onRemoveColumn={handleRemoveTargetColumn}
        onAddTable={handleAddTargetTable}
        onRemoveTable={handleRemoveTargetTable}
      />
    </Box>
  );
}
