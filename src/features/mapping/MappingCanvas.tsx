import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { 
  Box, Typography, Button, Chip, Checkbox, 
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Paper, Tabs, Tab, TextField, Tooltip, MenuItem, Collapse
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CodeIcon from '@mui/icons-material/Code';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import UploadIcon from '@mui/icons-material/UploadFile';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  selectTableMappings, 
  selectActiveTableMappingId,
  selectActiveTableMapping,
  addTableMapping,
  updateTableMapping,
  removeTableMapping,
  setActiveTableMapping,
  addColumnMapping,
  updateColumnMapping,
  removeColumnMapping,
  setTableConflictStrategy,
  setTableConflictKeyColumns,
  setTableRowFilters,
  setTableJoins,
  setTableGroupBy,
  setTableGroupByMode,
  setTableGroupMin,
  setTableOrderBy,
  setTableAutoIdColumn,
  loadMappingsAndPersist,
} from './mappingSlice';
import { selectSourceTables, selectSourceIsLoaded } from '../sourceSchema/sourceSchemaSlice';
import { selectTargetTables, selectTargetIsLoaded } from '../targetSchema/targetSchemaSlice';
import { ColumnMappingRow } from './ColumnMappingRow';
import { AddColumnMappingModal } from './AddColumnMappingModal';
import { generateSqlPreview, generatePythonPreview } from '../../utils';
import type { MappingType, TransformationRule, TableMapping, ColumnMapping, RowFilter, FilterOperator, JoinSpec, JoinType, OrderBySpec } from '../../types';

// Helper to get source tables from a mapping (handles both array and string formats)
function getSourceTablesDisplay(mapping: TableMapping): string {
  const mappingAny = mapping as TableMapping & { sourceTable?: string };
  if (mappingAny.sourceTable) {
    return mappingAny.sourceTable;
  }
  return mapping.sourceTables?.join(', ') || '';
}

// Helper to get target tables from a mapping (handles both array and string formats)
function getTargetTablesDisplay(mapping: TableMapping): string {
  const mappingAny = mapping as TableMapping & { targetTable?: string };
  if (mappingAny.targetTable) {
    return mappingAny.targetTable;
  }
  return mapping.targetTables?.join(', ') || '';
}

// Helper to get source tables array from a mapping
function getSourceTablesArray(mapping: TableMapping): string[] {
  const mappingAny = mapping as TableMapping & { sourceTable?: string };
  if (mappingAny.sourceTable) {
    return [mappingAny.sourceTable];
  }
  return mapping.sourceTables || [];
}

// Helper to get target tables array from a mapping
function getTargetTablesArray(mapping: TableMapping): string[] {
  const mappingAny = mapping as TableMapping & { targetTable?: string };
  if (mappingAny.targetTable) {
    return [mappingAny.targetTable];
  }
  return mapping.targetTables || [];
}

// Component that shows tooltip only when text is truncated
function TruncatedText({ 
  text, 
  color, 
  placement = 'right' 
}: { 
  text: string; 
  color: string; 
  placement?: 'right' | 'left' | 'top' | 'bottom';
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (element) {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    }
  }, [text]);

  const content = (
    <Typography 
      ref={textRef}
      variant="body2" 
      component="span"
      sx={{ 
        color,
        flex: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'block',
      }}
    >
      {text}
    </Typography>
  );

  if (isTruncated) {
    return (
      <Tooltip title={text} placement={placement} arrow>
        {content}
      </Tooltip>
    );
  }

  return content;
}

export function MappingCanvas() {
  const dispatch = useAppDispatch();
  const tableMappings = useAppSelector(selectTableMappings);
  const activeTableMappingId = useAppSelector(selectActiveTableMappingId);
  const activeTableMapping = useAppSelector(selectActiveTableMapping);
  const sourceTables = useAppSelector(selectSourceTables);
  const targetTables = useAppSelector(selectTargetTables);
  const sourceLoaded = useAppSelector(selectSourceIsLoaded);
  const targetLoaded = useAppSelector(selectTargetIsLoaded);

  const [isAddingTableMapping, setIsAddingTableMapping] = useState(false);
  const [isEditingTableMapping, setIsEditingTableMapping] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [selectedSourceTables, setSelectedSourceTables] = useState<string[]>([]);
  const [selectedTargetTables, setSelectedTargetTables] = useState<string[]>([]);
  const [createSrcSearch, setCreateSrcSearch] = useState('');
  const [createTgtSearch, setCreateTgtSearch] = useState('');
  const [mappingDescription, setMappingDescription] = useState('');
  const [isAddingColumnMapping, setIsAddingColumnMapping] = useState(false);
  const [editingColumnMapping, setEditingColumnMapping] = useState<{
    id: string;
    target: { table: string; column: string };
    mappingType: MappingType;
    source?: { table: string; column: string };
    constantValue?: string | number | boolean | null;
    transformation?: TransformationRule;
    sourceColumns?: Array<{ table: string; column: string }>;
    convertDateToEpoch?: boolean;
    convertTinyintToBoolean?: boolean;
    zeroToNull?: boolean;
    encrypt?: boolean;
    useGroupMin?: boolean;
  } | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState(0);
  const [previewTablesModalOpen, setPreviewTablesModalOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [unmappedSrcSearch, setUnmappedSrcSearch] = useState('');
  const [unmappedTgtSearch, setUnmappedTgtSearch] = useState('');
  const [jsonCopied, setJsonCopied] = useState(false);
  const [copiedMappingId, setCopiedMappingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importAppend, setImportAppend] = useState(true);

  // Export all table mappings as JSON to the clipboard.
  const handleCopyMappingsJson = () => {
    const json = JSON.stringify({ tableMappings }, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), 1500);
    });
  };

  // Export a single table mapping as JSON (importable on its own).
  const handleCopySingleMapping = (mapping: TableMapping) => {
    navigator.clipboard.writeText(JSON.stringify({ tableMappings: [mapping] }, null, 2)).then(() => {
      setCopiedMappingId(mapping.id);
      setTimeout(() => setCopiedMappingId((c) => (c === mapping.id ? null : c)), 1500);
    });
  };

  // Import mappings from pasted/uploaded JSON. Accepts either { tableMappings: [...] }
  // or a bare array; normalization happens in the slice.
  const handleImportMappings = () => {
    setImportError(null);
    try {
      const parsed = JSON.parse(importText);
      // Accept an array, { tableMappings: [...] }, or a single mapping object.
      let arr: any[] | null = null;
      if (Array.isArray(parsed)) arr = parsed;
      else if (Array.isArray(parsed?.tableMappings)) arr = parsed.tableMappings;
      else if (parsed && (parsed.sourceTables || parsed.sourceTable || parsed.columnMappings)) arr = [parsed];
      if (!Array.isArray(arr) || arr.length === 0) {
        setImportError('JSON must be a mapping object, an array, or { "tableMappings": [...] }.');
        return;
      }

      let toLoad = arr;
      if (importAppend) {
        // Add to existing mappings; an imported source→target pair replaces a matching one.
        const keyOf = (m: any) =>
          `${(m.sourceTables?.[0] ?? m.sourceTable ?? '')}=>${(m.targetTables?.[0] ?? m.targetTable ?? '')}`;
        const importedKeys = new Set(arr.map(keyOf));
        const kept = tableMappings.filter((m) => !importedKeys.has(keyOf(m)));
        toLoad = [...kept, ...arr];
      }
      dispatch(loadMappingsAndPersist(toLoad));
      setImportOpen(false);
      setImportText('');
    } catch (e: any) {
      setImportError(`Invalid JSON: ${e.message}`);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImportText(String(ev.target?.result ?? ''));
    reader.readAsText(file);
    e.target.value = '';
  };

  const bothSchemasLoaded = sourceLoaded && targetLoaded;

  // Unmapped columns for the active table mapping (suggestions)
  const unmappedSuggestions = useMemo(() => {
    if (!activeTableMapping) return { unmappedSource: [], unmappedTarget: [] };
    const sourceTableNames = getSourceTablesArray(activeTableMapping);
    const targetTableNames = getTargetTablesArray(activeTableMapping);
    const mappedSourceSet = new Set(
      activeTableMapping.columnMappings
        .filter((m) => m.source?.table && m.source?.column)
        .map((m) => `${m.source!.table}.${m.source!.column}`)
    );
    const mappedTargetSet = new Set(
      activeTableMapping.columnMappings.map((m) => `${m.target.table}.${m.target.column}`)
    );
    const unmappedSource: Array<{ table: string; column: string }> = [];
    const unmappedTarget: Array<{ table: string; column: string }> = [];
    sourceTables
      .filter((t) => sourceTableNames.includes(t.name))
      .forEach((t) => {
        t.columns.forEach((c) => {
          const key = `${t.name}.${c.name}`;
          if (!mappedSourceSet.has(key)) unmappedSource.push({ table: t.name, column: c.name });
        });
      });
    targetTables
      .filter((t) => targetTableNames.includes(t.name))
      .forEach((t) => {
        t.columns.forEach((c) => {
          const key = `${t.name}.${c.name}`;
          if (!mappedTargetSet.has(key)) unmappedTarget.push({ table: t.name, column: c.name });
        });
      });
    return { unmappedSource, unmappedTarget };
  }, [activeTableMapping, sourceTables, targetTables]);

  // Tables (from schema) that are not used in any table mapping as source or target
  const unmappedTablesSuggestion = useMemo(() => {
    const mappedSourceSet = new Set<string>();
    const mappedTargetSet = new Set<string>();
    tableMappings.forEach((m) => {
      getSourceTablesArray(m).forEach((t) => mappedSourceSet.add(t));
      getTargetTablesArray(m).forEach((t) => mappedTargetSet.add(t));
    });
    const unmappedSourceTables = sourceTables
      .map((t) => t.name)
      .filter((name) => !mappedSourceSet.has(name));
    const unmappedTargetTables = targetTables
      .map((t) => t.name)
      .filter((name) => !mappedTargetSet.has(name));
    return { unmappedSourceTables, unmappedTargetTables };
  }, [tableMappings, sourceTables, targetTables]);

  const handleCreateTableMapping = useCallback(() => {
    if (selectedSourceTables.length > 0 && selectedTargetTables.length > 0) {
      dispatch(addTableMapping({
        sourceTables: selectedSourceTables,
        targetTables: selectedTargetTables,
        description: mappingDescription || undefined,
      }));
      setSelectedSourceTables([]);
      setSelectedTargetTables([]);
      setMappingDescription('');
      setIsAddingTableMapping(false);
    }
  }, [dispatch, selectedSourceTables, selectedTargetTables, mappingDescription]);

  const handleEditTableMapping = useCallback((mapping: TableMapping) => {
    setEditingMappingId(mapping.id);
    setSelectedSourceTables(getSourceTablesArray(mapping));
    setSelectedTargetTables(getTargetTablesArray(mapping));
    setMappingDescription(mapping.description || '');
    setIsEditingTableMapping(true);
  }, []);

  const handleUpdateTableMapping = useCallback(() => {
    if (editingMappingId && selectedSourceTables.length > 0 && selectedTargetTables.length > 0) {
      dispatch(updateTableMapping({
        id: editingMappingId,
        sourceTables: selectedSourceTables,
        targetTables: selectedTargetTables,
        description: mappingDescription || undefined,
      }));
      setSelectedSourceTables([]);
      setSelectedTargetTables([]);
      setMappingDescription('');
      setEditingMappingId(null);
      setIsEditingTableMapping(false);
    }
  }, [dispatch, editingMappingId, selectedSourceTables, selectedTargetTables, mappingDescription]);

  const handleCloseTableMappingDialog = useCallback(() => {
    setIsAddingTableMapping(false);
    setIsEditingTableMapping(false);
    setEditingMappingId(null);
    setSelectedSourceTables([]);
    setSelectedTargetTables([]);
    setMappingDescription('');
    setCreateSrcSearch('');
    setCreateTgtSearch('');
  }, []);

  const handleDeleteTableMapping = useCallback((id: string) => {
    dispatch(removeTableMapping(id));
  }, [dispatch]);

  const handleAddColumnMapping = useCallback((
    target: { table: string; column: string },
    mappingType: MappingType,
    source?: { table: string; column: string },
    constantValue?: string | number | boolean | null,
    transformation?: TransformationRule,
    sourceColumns?: Array<{ table: string; column: string }>,
    options?: { convertDateToEpoch?: boolean; convertTinyintToBoolean?: boolean; zeroToNull?: boolean; encrypt?: boolean; useGroupMin?: boolean }
  ) => {
    if (activeTableMappingId) {
      const { convertDateToEpoch, convertTinyintToBoolean, zeroToNull, encrypt, useGroupMin } = options ?? {};
      if (editingColumnMapping) {
        dispatch(updateColumnMapping({
          tableMappingId: activeTableMappingId,
          columnMappingId: editingColumnMapping.id,
          updates: {
            target,
            mappingType,
            source,
            constantValue,
            transformation,
            sourceColumns,
            convertDateToEpoch,
            convertTinyintToBoolean,
            zeroToNull,
            encrypt,
            useGroupMin,
          },
        }));
      } else {
        dispatch(addColumnMapping({
          tableMappingId: activeTableMappingId,
          target,
          mappingType,
          source,
          constantValue,
          transformation,
          sourceColumns,
          convertDateToEpoch,
          convertTinyintToBoolean,
          zeroToNull,
          encrypt,
          useGroupMin,
        }));
      }
    }
    setIsAddingColumnMapping(false);
    setEditingColumnMapping(null);
  }, [dispatch, activeTableMappingId, editingColumnMapping]);

  const handleEditColumnMapping = useCallback((columnMapping: ColumnMapping) => {
    setEditingColumnMapping({
      id: columnMapping.id,
      target: columnMapping.target,
      mappingType: columnMapping.mappingType,
      source: columnMapping.source,
      constantValue: columnMapping.constantValue,
      transformation: columnMapping.transformation,
      sourceColumns: columnMapping.sourceColumns,
      convertDateToEpoch: columnMapping.convertDateToEpoch,
      convertTinyintToBoolean: columnMapping.convertTinyintToBoolean,
      zeroToNull: columnMapping.zeroToNull,
      encrypt: columnMapping.encrypt,
      useGroupMin: columnMapping.useGroupMin,
    });
    setIsAddingColumnMapping(true);
  }, []);

  const handleRemoveColumnMapping = useCallback((columnMappingId: string) => {
    if (activeTableMappingId) {
      dispatch(removeColumnMapping({
        tableMappingId: activeTableMappingId,
        columnMappingId,
      }));
    }
  }, [dispatch, activeTableMappingId]);

  // Filter the table-mappings list by source/target table name.
  const tableSearchLc = tableSearch.trim().toLowerCase();
  const filteredTableMappings = tableSearchLc
    ? tableMappings.filter(m =>
        [...(m.sourceTables || []), ...(m.targetTables || [])]
          .some(t => (t || '').toLowerCase().includes(tableSearchLc))
      )
    : tableMappings;

  const sqlPreview = activeTableMapping ? generateSqlPreview(activeTableMapping) : '';
  const pythonPreview = activeTableMapping ? generatePythonPreview(activeTableMapping) : '';
  // Distinct target columns available as upsert match-key candidates.
  const mappedTargetColumns = activeTableMapping
    ? Array.from(new Set(activeTableMapping.columnMappings.map((cm) => cm.target.column)))
    : [];

  // Columns available to filter rows on — across ALL of the mapping's source tables,
  // qualified as `table.column` so multi-table mappings can pick the right one.
  const sourceColumnsForFilter = activeTableMapping
    ? getSourceTablesArray(activeTableMapping).flatMap((tn) => {
        const t = sourceTables.find((x) => x.name === tn);
        return (t?.columns ?? []).map((c) => `${tn}.${c.name}`);
      })
    : [];
  const rowFilters: RowFilter[] = activeTableMapping?.rowFilters ?? [];
  const updateRowFilters = (next: RowFilter[]) => {
    if (activeTableMapping) dispatch(setTableRowFilters({ id: activeTableMapping.id, rowFilters: next }));
  };
  const FILTER_OPERATORS: FilterOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'];
  const opNeedsValue = (op: FilterOperator) => op !== 'IS NULL' && op !== 'IS NOT NULL';

  // Joins: additional source tables (everything after the primary sourceTables[0]).
  const allSourceTables = activeTableMapping ? getSourceTablesArray(activeTableMapping) : [];
  const primarySourceTable = allSourceTables[0];
  const joinableTables = allSourceTables.slice(1);
  const joins: JoinSpec[] = activeTableMapping?.joins ?? [];
  const updateJoins = (next: JoinSpec[]) => {
    if (activeTableMapping) dispatch(setTableJoins({ id: activeTableMapping.id, joins: next }));
  };
  const columnsOfTable = (tn: string) =>
    sourceTables.find((x) => x.name === tn)?.columns.map((c) => c.name) ?? [];

  const groupByColumns: string[] = activeTableMapping?.groupByColumns ?? [];
  const updateGroupBy = (next: string[]) => {
    if (activeTableMapping) dispatch(setTableGroupBy({ id: activeTableMapping.id, groupByColumns: next }));
  };
  const groupByMode: 'dedup' | 'all' = activeTableMapping?.groupByMode ?? 'dedup';
  const updateGroupByMode = (mode: 'dedup' | 'all') => {
    if (activeTableMapping) dispatch(setTableGroupByMode({ id: activeTableMapping.id, groupByMode: mode }));
  };
  const groupMinColumns: string[] = activeTableMapping?.groupMinColumns ?? [];
  const updateGroupMin = (next: string[]) => {
    if (activeTableMapping) dispatch(setTableGroupMin({ id: activeTableMapping.id, groupMinColumns: next }));
  };
  // Collapsed by default — the Group-by section is advanced/optional.
  const [groupBySectionOpen, setGroupBySectionOpen] = useState(false);
  const orderBy: OrderBySpec[] = activeTableMapping?.orderBy ?? [];
  const updateOrderBy = (next: OrderBySpec[]) => {
    if (activeTableMapping) dispatch(setTableOrderBy({ id: activeTableMapping.id, orderBy: next }));
  };
  // Target columns of the primary target table — for the "auto-assign id" picker.
  const primaryTargetTable = activeTableMapping ? getTargetTablesArray(activeTableMapping)[0] : undefined;
  const targetTableColumns = primaryTargetTable
    ? (targetTables.find((t) => t.name === primaryTargetTable)?.columns ?? [])
    : [];
  const detectedTargetPk = targetTableColumns.find((c) => c.isPrimaryKey)?.name;
  const autoIdColumn: string = activeTableMapping?.autoIdColumn ?? '';
  const updateAutoIdColumn = (col: string) => {
    if (activeTableMapping) dispatch(setTableAutoIdColumn({ id: activeTableMapping.id, autoIdColumn: col }));
  };

  if (!bothSchemasLoaded) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', bgcolor: 'neutral.100' }}>
        <Typography variant="h1" sx={{ mb: 2, color: 'neutral.400' }}>⚡</Typography>
        <Typography variant="h3Medium" sx={{ color: 'primary.main', mb: 1 }}>Load Both Schemas</Typography>
        <Typography variant="body1" sx={{ color: 'neutral.500' }}>
          Upload source and target schema JSON files to start mapping
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: 'neutral.100', gap: 2, p: 2 }}>
      {/* Left Side - Table Mappings */}
      <Paper sx={{ 
        width: 320,
        flexShrink: 0,
        display: 'flex', 
        flexDirection: 'column', 
        bgcolor: 'white.main', 
        overflow: 'hidden', 
        border: 1, 
        borderColor: 'neutral.200' 
      }}>
        {/* Header */}
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          p: 2,
          borderBottom: 1,
          borderColor: 'neutral.200',
          bgcolor: 'neutral.100'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography variant="h3Bold" noWrap sx={{ color: 'primary.main' }}>Table Mappings</Typography>
            <Chip
              label={tableMappings.length}
              // size="small"
              sx={{
                flexShrink: 0,
                bgcolor: 'primary.main',
                color: 'white.main',
                height: 20,
                minWidth: 24,
                fontSize: '0.7rem',
                fontWeight: 700,
                textAlign: "center"
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <Tooltip title={jsonCopied ? 'Copied!' : 'Copy mappings JSON'}>
              <span>
                <IconButton
                  size="small"
                  onClick={handleCopyMappingsJson}
                  disabled={tableMappings.length === 0}
                  sx={{ border: 1, borderColor: 'neutral.400', borderRadius: 1, color: jsonCopied ? 'success.main' : 'neutral.700' }}
                >
                  {jsonCopied ? <CheckIcon sx={{ fontSize: 18 }} /> : <ContentCopyIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Import mappings from JSON">
              <IconButton
                size="small"
                onClick={() => { setImportText(''); setImportError(null); setImportOpen(true); }}
                sx={{ border: 1, borderColor: 'neutral.400', borderRadius: 1, color: 'neutral.700' }}
              >
                <UploadIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Preview source and target tables">
              <Button
                variant="outlined"
                size="small"
                onClick={() => setPreviewTablesModalOpen(true)}
                sx={{
                  minWidth: 0,
                  px: 1,
                  borderColor: 'neutral.400',
                  color: 'neutral.700',
                  '&:hover': { borderColor: 'neutral.600', bgcolor: 'neutral.100' }
                }}
              >
                <VisibilityIcon fontSize="small" />
              </Button>
            </Tooltip>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setIsAddingTableMapping(true)}
              sx={{ 
                bgcolor: 'secondary.main',
                '&:hover': { bgcolor: 'secondary.dark' }
              }}
            >
              <Typography variant="caption1Bold">Add</Typography>
            </Button>
          </Box>
        </Box>

        {/* Tables not in any mapping (suggestion) */}
        

        {/* Search */}
        {tableMappings.length > 0 && (
          <Box sx={{ px: 2, pt: 1.5 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search source / target table…"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              sx={{
                '& .MuiInputBase-input': { color: 'primary.main' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' },
              }}
            />
          </Box>
        )}

        {/* Table Mappings List */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {tableMappings.length === 0 ? (
            <Box sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed',
              borderColor: 'neutral.300',
              borderRadius: 1
            }}>
              <Typography variant="body1" sx={{ color: 'neutral.500', textAlign: 'center' }}>
                No table mappings yet.<br />Create one to start mapping columns.
              </Typography>
            </Box>
          ) : filteredTableMappings.length === 0 ? (
            <Box sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed',
              borderColor: 'neutral.300',
              borderRadius: 1,
              p: 2,
            }}>
              <Typography variant="body2" sx={{ color: 'neutral.500', textAlign: 'center' }}>
                No tables match “{tableSearch}”.
              </Typography>
            </Box>
          ) : (
            filteredTableMappings.map(mapping => (
              <Paper
                key={mapping.id}
                onClick={() => dispatch(setActiveTableMapping(mapping.id))}
                sx={{
                  p: 1.5,
                  mb: 1,
                  cursor: 'pointer',
                  bgcolor: mapping.id === activeTableMappingId ? 'secondary.100' : 'white.main',
                  border: 1,
                  borderColor: mapping.id === activeTableMappingId ? 'secondary.main' : 'neutral.200',
                  '&:hover': { bgcolor: mapping.id === activeTableMappingId ? 'secondary.200' : 'neutral.100' },
                  overflow: 'hidden',
                }}
              >
                {/* Row 1: Table names and action buttons */}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                  {/* Table chips - allow wrapping */}
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 0.5, 
                    flexWrap: 'wrap',
                    flex: 1,
                    minWidth: 0,
                  }}>
                    <Chip 
                      label={getSourceTablesDisplay(mapping)}
                      size="small"
                      sx={{ 
                        bgcolor: 'primary.100', 
                        color: 'primary.main', 
                        fontSize: '0.65rem',
                        height: 18,
                        maxWidth: '100%',
                        '& .MuiChip-label': {
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }
                      }}
                    />
                    <ArrowForwardIcon sx={{ fontSize: 12, color: 'neutral.400', flexShrink: 0 }} />
                    <Chip 
                      label={getTargetTablesDisplay(mapping)}
                      size="small"
                      sx={{ 
                        bgcolor: 'secondary.100', 
                        color: 'secondary.main', 
                        fontSize: '0.65rem',
                        height: 18,
                        maxWidth: '100%',
                        '& .MuiChip-label': {
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }
                      }}
                    />
                  </Box>
                  {/* Action buttons - fixed size */}
                  <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
                    <Tooltip title={copiedMappingId === mapping.id ? 'Copied!' : 'Copy this mapping (JSON)'}>
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); handleCopySingleMapping(mapping); }}
                        sx={{ color: copiedMappingId === mapping.id ? 'success.main' : 'neutral.500', '&:hover': { bgcolor: 'neutral.100' }, p: 0.25 }}
                      >
                        {copiedMappingId === mapping.id
                          ? <CheckIcon sx={{ fontSize: 14 }} />
                          : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); handleEditTableMapping(mapping); }}
                      sx={{ color: 'info.main', '&:hover': { bgcolor: 'info.100' }, p: 0.25 }}
                    >
                      <EditIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    <IconButton 
                      size="small" 
                      onClick={(e) => { e.stopPropagation(); handleDeleteTableMapping(mapping.id); }}
                      sx={{ color: 'warning.main', '&:hover': { bgcolor: 'warning.100' }, p: 0.25 }}
                    >
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                </Box>
                {/* Row 2: Column count and description */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Chip
                    label={`${mapping.columnMappings.length} col${mapping.columnMappings.length !== 1 ? 's' : ''}`}
                    size="small"
                    sx={{ 
                      bgcolor: 'neutral.200', 
                      color: 'neutral.600', 
                      height: 16,
                      fontSize: '0.6rem',
                      fontWeight: 600,
                    }}
                  />
                  {mapping.description && (
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: 'neutral.400', 
                        fontSize: '0.6rem', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap',
                        flex: 1,
                        textAlign: 'right',
                      }}
                    >
                      {mapping.description}
                    </Typography>
                  )}
                </Box>
              </Paper>
            ))
          )}
        </Box>
      </Paper>

      {/* Right Side - Column Mappings & SQL Preview */}
      <Paper sx={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        bgcolor: 'white.main', 
        overflow: 'hidden', 
        border: 1, 
        borderColor: 'neutral.200' 
      }}>
        {/* Header with Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'neutral.200', bgcolor: 'neutral.100' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1 }}>
            <Box>
              <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
                {rightPanelTab === 0 ? 'Column Mappings' : rightPanelTab === 1 ? 'SQL Preview' : 'Python Script'}
              </Typography>
              {activeTableMapping && (
                <Typography variant="caption1" sx={{ color: 'secondary.main' }}>
                  {getSourceTablesDisplay(activeTableMapping)} → {getTargetTablesDisplay(activeTableMapping)}
                </Typography>
              )}
            </Box>
            {activeTableMapping && rightPanelTab === 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tooltip title="Import a mapping from JSON">
                  <IconButton
                    size="small"
                    onClick={() => { setImportText(''); setImportError(null); setImportAppend(true); setImportOpen(true); }}
                    sx={{ border: 1, borderColor: 'neutral.400', borderRadius: 1, color: 'neutral.700' }}
                  >
                    <UploadIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setIsAddingColumnMapping(true)}
                  sx={{
                    bgcolor: 'secondary.main',
                    '&:hover': { bgcolor: 'secondary.dark' }
                  }}
                >
                  <Typography variant="caption1Bold">Add Column</Typography>
                </Button>
              </Box>
            )}
          </Box>
          <Tabs 
            value={rightPanelTab} 
            onChange={(_, val) => setRightPanelTab(val)}
            sx={{ 
              minHeight: 36,
              '& .MuiTab-root': { 
                color: 'neutral.500', 
                minHeight: 36, 
                textTransform: 'none',
                py: 0
              },
              '& .Mui-selected': { color: 'primary.main' }
            }}
          >
            <Tab 
              label={<Typography variant="body2Medium">Columns</Typography>} 
              icon={<Box component="span" sx={{ mr: 0.5 }}>📋</Box>}
              iconPosition="start"
            />
            <Tab
              label={<Typography variant="body2Medium">SQL Query</Typography>}
              icon={<CodeIcon sx={{ fontSize: 16, mr: 0.5 }} />}
              iconPosition="start"
            />
            <Tab
              label={<Typography variant="body2Medium">Python Script</Typography>}
              icon={<Box component="span" sx={{ mr: 0.5 }}>🐍</Box>}
              iconPosition="start"
            />
          </Tabs>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {!activeTableMapping ? (
            <Box sx={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              border: '1px dashed',
              borderColor: 'neutral.300',
              borderRadius: 1
            }}>
              <Typography variant="body1" sx={{ color: 'neutral.500', textAlign: 'center' }}>
                Select a table mapping<br />to view column mappings and SQL preview.
              </Typography>
            </Box>
          ) : rightPanelTab === 0 ? (
            // Column Mappings Tab
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Mapping-level conflict handling */}
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'neutral.100', borderColor: 'neutral.300', border: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Checkbox
                    size="small"
                    checked={activeTableMapping.conflictStrategy === 'upsert'}
                    onChange={(e) =>
                      dispatch(setTableConflictStrategy({
                        id: activeTableMapping.id,
                        conflictStrategy: e.target.checked ? 'upsert' : 'skip',
                      }))
                    }
                    sx={{ p: 0.5, color: 'secondary.main', '&.Mui-checked': { color: 'secondary.main' } }}
                  />
                  <Box>
                    <Typography variant="body2Bold" sx={{ color: 'primary.main' }}>
                      Update the row if it already exists (upsert)
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block' }}>
                      When a row with the same key exists in the target, replace its values in place instead of inserting a duplicate row.
                    </Typography>
                  </Box>
                </Box>

                {activeTableMapping.conflictStrategy === 'upsert' && (
                  <Box sx={{ mt: 1.5, pl: 4 }}>
                    <Typography variant="caption" sx={{ color: 'neutral.700', fontWeight: 600, display: 'block', mb: 0.5 }}>
                      Match on key column(s) — leave empty to use the target's primary key
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {mappedTargetColumns.length === 0 ? (
                        <Typography variant="caption" sx={{ color: 'neutral.500' }}>
                          Add column mappings first.
                        </Typography>
                      ) : (
                        mappedTargetColumns.map((col) => {
                          const selected = (activeTableMapping.conflictKeyColumns ?? []).includes(col);
                          return (
                            <Chip
                              key={col}
                              label={col}
                              size="small"
                              variant={selected ? 'filled' : 'outlined'}
                              onClick={() => {
                                const current = activeTableMapping.conflictKeyColumns ?? [];
                                const next = selected
                                  ? current.filter((c) => c !== col)
                                  : [...current, col];
                                dispatch(setTableConflictKeyColumns({
                                  id: activeTableMapping.id,
                                  conflictKeyColumns: next,
                                }));
                              }}
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                bgcolor: selected ? 'secondary.main' : 'transparent',
                                color: selected ? 'common.white' : 'neutral.700',
                                borderColor: 'neutral.300',
                                '&:hover': { bgcolor: selected ? 'secondary.dark' : 'neutral.200' },
                              }}
                            />
                          );
                        })
                      )}
                    </Box>
                  </Box>
                )}
              </Paper>

              {/* Mapping-level row filter */}
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'neutral.100', borderColor: 'neutral.300', border: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Box>
                    <Typography variant="body2Bold" sx={{ color: 'primary.main' }}>
                      Row filter
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block' }}>
                      Only source rows matching ALL conditions are transferred. Leave empty to transfer every row.
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => updateRowFilters([...rowFilters, { column: sourceColumnsForFilter[0] ?? '', operator: '=', value: '' }])}
                    sx={{ color: 'secondary.main', flexShrink: 0 }}
                  >
                    <Typography variant="caption1Bold">Add condition</Typography>
                  </Button>
                </Box>

                {rowFilters.map((f, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                    {i > 0 && (
                      <Typography variant="caption" sx={{ color: 'neutral.500', width: 28 }}>AND</Typography>
                    )}
                    <TextField
                      select size="small" label="Column"
                      value={sourceColumnsForFilter.includes(f.column) ? f.column : ''}
                      onChange={(e) => updateRowFilters(rowFilters.map((x, xi) => xi === i ? { ...x, column: e.target.value } : x))}
                      sx={{ minWidth: 130, '& .MuiInputBase-input': { color: 'primary.main' } }}
                    >
                      {sourceColumnsForFilter.map((c) => (
                        <MenuItem key={c} value={c}>{c}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select size="small" label="Operator"
                      value={f.operator}
                      onChange={(e) => updateRowFilters(rowFilters.map((x, xi) => xi === i ? { ...x, operator: e.target.value as FilterOperator } : x))}
                      sx={{ minWidth: 100, '& .MuiInputBase-input': { color: 'primary.main' } }}
                    >
                      {FILTER_OPERATORS.map((op) => (
                        <MenuItem key={op} value={op}>{op}</MenuItem>
                      ))}
                    </TextField>
                    {opNeedsValue(f.operator) && (
                      <TextField
                        size="small" label="Value"
                        value={f.value ?? ''}
                        placeholder={f.operator === 'IN' || f.operator === 'NOT IN' ? 'a, b, c' : ''}
                        onChange={(e) => updateRowFilters(rowFilters.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x))}
                        sx={{ flex: 1, minWidth: 120, '& .MuiInputBase-input': { color: 'primary.main' } }}
                      />
                    )}
                    <IconButton
                      size="small"
                      onClick={() => updateRowFilters(rowFilters.filter((_, xi) => xi !== i))}
                      sx={{ color: 'neutral.400', '&:hover': { color: 'warning.main', bgcolor: 'warning.100' } }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Paper>

              {/* Joins: combine extra source tables (filter + pull columns) */}
              {joinableTables.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'neutral.100', borderColor: 'neutral.300', border: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Box>
                      <Typography variant="body2Bold" sx={{ color: 'primary.main' }}>Joins</Typography>
                      <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block' }}>
                        Join other source tables to <b>{primarySourceTable}</b>. Then map columns from joined
                        tables (pick the table in the column's Source Table) and filter using table.column.
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => updateJoins([...joins, { table: joinableTables[0] ?? '', type: 'INNER', leftColumn: sourceColumnsForFilter[0] ?? '', rightColumn: '' }])}
                      sx={{ color: 'secondary.main', flexShrink: 0 }}
                    >
                      <Typography variant="caption1Bold">Add join</Typography>
                    </Button>
                  </Box>

                  {joins.map((j, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                      <TextField
                        select size="small" label="Type"
                        value={j.type}
                        onChange={(e) => updateJoins(joins.map((x, xi) => xi === i ? { ...x, type: e.target.value as JoinType } : x))}
                        sx={{ minWidth: 90 }}
                      >
                        <MenuItem value="INNER">INNER</MenuItem>
                        <MenuItem value="LEFT">LEFT</MenuItem>
                        <MenuItem value="RIGHT">RIGHT</MenuItem>
                      </TextField>
                      <TextField
                        select size="small" label="Join table"
                        value={joinableTables.includes(j.table) ? j.table : ''}
                        onChange={(e) => updateJoins(joins.map((x, xi) => xi === i ? { ...x, table: e.target.value, rightColumn: '' } : x))}
                        sx={{ minWidth: 130 }}
                      >
                        {joinableTables.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                      </TextField>
                      <TextField
                        select size="small" label="On (table.column)"
                        value={sourceColumnsForFilter.includes(j.leftColumn) ? j.leftColumn : ''}
                        onChange={(e) => updateJoins(joins.map((x, xi) => xi === i ? { ...x, leftColumn: e.target.value } : x))}
                        sx={{ minWidth: 160 }}
                      >
                        {sourceColumnsForFilter.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                      </TextField>
                      <Typography variant="caption" sx={{ color: 'neutral.500' }}>=</Typography>
                      <TextField
                        select size="small" label={`${j.table || 'table'} column`}
                        value={columnsOfTable(j.table).includes(j.rightColumn) ? j.rightColumn : ''}
                        onChange={(e) => updateJoins(joins.map((x, xi) => xi === i ? { ...x, rightColumn: e.target.value } : x))}
                        sx={{ minWidth: 130 }}
                      >
                        {columnsOfTable(j.table).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                      </TextField>
                      <IconButton
                        size="small"
                        onClick={() => updateJoins(joins.filter((_, xi) => xi !== i))}
                        sx={{ color: 'neutral.400', '&:hover': { color: 'warning.main', bgcolor: 'warning.100' } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Paper>
              )}

              {/* Group By: collapse duplicate source rows (dedup) */}
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'neutral.100', borderColor: 'neutral.300', border: 1 }}>
                {/* Clickable header toggles the section open/closed */}
                <Box
                  onClick={() => setGroupBySectionOpen((v) => !v)}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2Bold" sx={{ color: 'primary.main' }}>Group by (dedup)</Typography>
                    {(groupByColumns.length > 0 || groupByMode === 'all') && (
                      <Chip
                        size="small"
                        label={groupByMode === 'all' ? 'all rows' : `${groupByColumns.length} col${groupByColumns.length === 1 ? '' : 's'}`}
                        color="secondary"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                    )}
                  </Box>
                  <IconButton size="small" sx={{ color: 'neutral.500' }}>
                    {groupBySectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </Box>

                <Collapse in={groupBySectionOpen} timeout="auto" unmountOnExit>
                <Box sx={{ mb: 0.5, mt: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block' }}>
                    Collapse duplicate source rows to one per distinct combination of these columns.
                    Keeps one full row per group (the first, by primary key) so all mapped columns are
                    preserved. Requires the source to be MySQL 8.0+ or PostgreSQL.
                  </Typography>
                </Box>

                {/* Output mode: one row per group (parent) vs every row (child) */}
                <TextField
                  select size="small" label="Output rows"
                  value={groupByMode}
                  onChange={(e) => updateGroupByMode(e.target.value as 'dedup' | 'all')}
                  sx={{ minWidth: 260, mb: 1, '& .MuiInputBase-input': { color: 'primary.main' } }}
                >
                  <MenuItem value="dedup">Grouped rows only — one row per group</MenuItem>
                  <MenuItem value="all">All rows — keep every source row</MenuItem>
                </TextField>
                {groupByMode === 'all' && (
                  <Typography variant="caption" sx={{ color: 'warning.main', display: 'block', mb: 1 }}>
                    All source rows are kept (no dedup). The group columns below define the groups
                    used by “Replace with group minimum”. Use this for a child mapping that reuses the
                    same join / computed id on every row.
                  </Typography>
                )}

                {sourceColumnsForFilter.length === 0 ? (
                  <Typography variant="caption" sx={{ color: 'neutral.500' }}>No source columns available.</Typography>
                ) : (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                    {sourceColumnsForFilter.map((col) => {
                      const selected = groupByColumns.includes(col);
                      return (
                        <Chip
                          key={col}
                          label={col}
                          size="small"
                          variant={selected ? 'filled' : 'outlined'}
                          color={selected ? 'secondary' : 'default'}
                          onClick={() => updateGroupBy(
                            selected ? groupByColumns.filter((c) => c !== col) : [...groupByColumns, col]
                          )}
                          sx={{ fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer' }}
                        />
                      );
                    })}
                  </Box>
                )}

                {/* Keep-all mode: replace a column's value with the group MIN on every row. */}
                {groupByMode === 'all' && (
                  <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'neutral.200' }}>
                    <Typography variant="caption" sx={{ color: 'neutral.700', fontWeight: 600, display: 'block', mb: 0.5 }}>
                      Replace with group minimum
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block', mb: 1 }}>
                      For the picked columns, every row in a group gets the MIN value of that column
                      across the group — i.e. <code>MIN(col) OVER (PARTITION BY the group columns)</code>.
                      Use this to set a child row's foreign key to the parent's id (the parent keeps the
                      lowest-id row).
                    </Typography>
                    {groupByColumns.length === 0 ? (
                      <Typography variant="caption" sx={{ color: 'warning.main' }}>
                        Pick at least one group column above first — it defines the groups.
                      </Typography>
                    ) : (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {sourceColumnsForFilter.map((col) => {
                          const selected = groupMinColumns.includes(col);
                          return (
                            <Chip
                              key={col}
                              label={col}
                              size="small"
                              variant={selected ? 'filled' : 'outlined'}
                              color={selected ? 'info' : 'default'}
                              onClick={() => updateGroupMin(
                                selected ? groupMinColumns.filter((c) => c !== col) : [...groupMinColumns, col]
                              )}
                              sx={{ fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer' }}
                            />
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Fresh unique id for grouped rows: omit a column so the target DB auto-assigns it. */}
                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'neutral.200' }}>
                  <Typography variant="caption" sx={{ color: 'neutral.700', fontWeight: 600, display: 'block', mb: 0.5 }}>
                    Auto-assign unique id
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block', mb: 1 }}>
                    After grouping, the source id is collapsed away. Pick the target id column to leave out
                    of the insert so the database fills it (must be an auto-increment / identity / serial column).
                    {detectedTargetPk ? ` Detected primary key: ${detectedTargetPk}.` : ''}
                  </Typography>
                  <TextField
                    select size="small" label="Target id column"
                    value={targetTableColumns.some((c) => c.name === autoIdColumn) ? autoIdColumn : ''}
                    onChange={(e) => updateAutoIdColumn(e.target.value)}
                    sx={{ minWidth: 220, '& .MuiInputBase-input': { color: 'primary.main' } }}
                  >
                    <MenuItem value="">
                      <em>None — insert the mapped value</em>
                    </MenuItem>
                    {targetTableColumns.map((c) => (
                      <MenuItem key={c.name} value={c.name}>
                        {c.name}{c.isPrimaryKey ? '  (PK)' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                </Collapse>
              </Paper>

              {/* Order By: sort source rows before reading */}
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'neutral.100', borderColor: 'neutral.300', border: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Box>
                    <Typography variant="body2Bold" sx={{ color: 'primary.main' }}>Order by</Typography>
                    <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block' }}>
                      Sort source rows before they're read. Note: this uses streamed reads instead of
                      keyset pagination, so very large tables migrate more slowly.
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    disabled={sourceColumnsForFilter.length === 0}
                    onClick={() => updateOrderBy([...orderBy, { column: sourceColumnsForFilter[0] ?? '', direction: 'ASC' }])}
                    sx={{ color: 'secondary.main', flexShrink: 0 }}
                  >
                    <Typography variant="caption1Bold">Add sort</Typography>
                  </Button>
                </Box>

                {orderBy.map((o, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                    {i > 0 && (
                      <Typography variant="caption" sx={{ color: 'neutral.500', width: 28 }}>THEN</Typography>
                    )}
                    <TextField
                      select size="small" label="Column"
                      value={sourceColumnsForFilter.includes(o.column) ? o.column : ''}
                      onChange={(e) => updateOrderBy(orderBy.map((x, xi) => xi === i ? { ...x, column: e.target.value } : x))}
                      sx={{ minWidth: 160, '& .MuiInputBase-input': { color: 'primary.main' } }}
                    >
                      {sourceColumnsForFilter.map((c) => (
                        <MenuItem key={c} value={c}>{c}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select size="small" label="Direction"
                      value={o.direction}
                      onChange={(e) => updateOrderBy(orderBy.map((x, xi) => xi === i ? { ...x, direction: e.target.value as OrderBySpec['direction'] } : x))}
                      sx={{ minWidth: 100, '& .MuiInputBase-input': { color: 'primary.main' } }}
                    >
                      <MenuItem value="ASC">ASC</MenuItem>
                      <MenuItem value="DESC">DESC</MenuItem>
                    </TextField>
                    <IconButton
                      size="small"
                      onClick={() => updateOrderBy(orderBy.filter((_, xi) => xi !== i))}
                      sx={{ color: 'neutral.400', '&:hover': { color: 'warning.main', bgcolor: 'warning.100' } }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Paper>

              {/* Unmapped columns suggestion */}
              {(unmappedSuggestions.unmappedSource.length > 0 || unmappedSuggestions.unmappedTarget.length > 0) && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    bgcolor: 'info.50',
                    borderColor: 'info.200',
                    border: 1,
                  }}
                >
                  <Typography variant="body2Bold" sx={{ color: 'info.dark', mb: 1 }}>
                    Suggestions — columns not yet mapped
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Box sx={{ flex: 1, minWidth: 160 }}>
                      <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
                        Source ({unmappedSuggestions.unmappedSource.length})
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Search source columns…"
                        value={unmappedSrcSearch}
                        onChange={(e) => setUnmappedSrcSearch(e.target.value)}
                        sx={{ my: 0.5, '& .MuiInputBase-input': { fontSize: '0.7rem', py: 0.5 } }}
                      />
                      <Box
                        component="ul"
                        sx={{
                          m: 0,
                          pl: 2,
                          py: 0.5,
                          maxHeight: 120,
                          overflow: 'auto',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          color: 'neutral.700',
                        }}
                      >
                        {unmappedSuggestions.unmappedSource
                          .filter(({ table, column }) => `${table}.${column}`.toLowerCase().includes(unmappedSrcSearch.trim().toLowerCase()))
                          .map(({ table, column }) => (
                            <li key={`${table}.${column}`}>
                              {table}.{column}
                            </li>
                          ))}
                      </Box>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 160 }}>
                      <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 600 }}>
                        Target ({unmappedSuggestions.unmappedTarget.length})
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Search target columns…"
                        value={unmappedTgtSearch}
                        onChange={(e) => setUnmappedTgtSearch(e.target.value)}
                        sx={{ my: 0.5, '& .MuiInputBase-input': { fontSize: '0.7rem', py: 0.5 } }}
                      />
                      <Box
                        component="ul"
                        sx={{
                          m: 0,
                          pl: 2,
                          py: 0.5,
                          maxHeight: 120,
                          overflow: 'auto',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          color: 'neutral.700',
                        }}
                      >
                        {unmappedSuggestions.unmappedTarget
                          .filter(({ table, column }) => `${table}.${column}`.toLowerCase().includes(unmappedTgtSearch.trim().toLowerCase()))
                          .map(({ table, column }) => (
                            <li key={`${table}.${column}`}>
                              {table}.{column}
                            </li>
                          ))}
                      </Box>
                    </Box>
                  </Box>
                </Paper>
              )}
              {activeTableMapping.columnMappings.length === 0 ? (
                <Box sx={{ 
                  flex: 1,
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: '1px dashed',
                  borderColor: 'neutral.300',
                  borderRadius: 1,
                  minHeight: 120,
                }}>
                  <Typography variant="body1" sx={{ color: 'neutral.500', textAlign: 'center' }}>
                    No column mappings yet.<br />Add mappings to define how data flows.
                  </Typography>
                </Box>
              ) : (
                activeTableMapping.columnMappings.map((colMapping) => (
                  <ColumnMappingRow
                    key={colMapping.id}
                    mapping={colMapping}
                    onRemove={() => handleRemoveColumnMapping(colMapping.id)}
                    onEdit={() => handleEditColumnMapping(colMapping)}
                  />
                ))
              )}
            </Box>
          ) : rightPanelTab === 1 ? (
            // SQL Preview Tab
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1, 
                mb: 2,
                p: 1.5,
                bgcolor: 'warning.100',
                borderRadius: 1,
                border: 1,
                borderColor: 'warning.main'
              }}>
                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                  ⚠️ This is a preview only. Actual SQL execution is handled by the backend.
                </Typography>
              </Box>
              <Paper sx={{ 
                flex: 1, 
                bgcolor: 'primary.800', 
                p: 2, 
                overflow: 'auto',
                borderRadius: 1
              }}>
                <Typography 
                  component="pre" 
                  sx={{ 
                    fontFamily: 'monospace', 
                    fontSize: '13px',
                    color: 'primary.100',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    m: 0,
                    lineHeight: 1.6
                  }}
                >
                  {sqlPreview}
                </Typography>
              </Paper>
            </Box>
          ) : (
            // Python Script Tab
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 2,
                p: 1.5,
                bgcolor: 'warning.100',
                borderRadius: 1,
                border: 1,
                borderColor: 'warning.main'
              }}>
                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                  🐍 Generated pandas + SQLAlchemy script for this mapping. Preview only — set the connection URLs and run it standalone.
                </Typography>
              </Box>
              <Paper sx={{
                flex: 1,
                bgcolor: 'primary.800',
                p: 2,
                overflow: 'auto',
                borderRadius: 1
              }}>
                <Typography
                  component="pre"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    color: 'primary.100',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    m: 0,
                    lineHeight: 1.6
                  }}
                >
                  {pythonPreview}
                </Typography>
              </Paper>
            </Box>
          )}
        </Box>
      </Paper>

      {/* Preview tables modal */}
      <Dialog
        open={previewTablesModalOpen}
        onClose={() => setPreviewTablesModalOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
          <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
            Preview tables
          </Typography>
          <Typography variant="body2" sx={{ color: 'neutral.500', mt: 0.5 }}>
            Tables not in any mapping (source and target)
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Paper variant="outlined" sx={{ flex: 1, minWidth: 200, p: 2, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
              <Typography variant="subtitle2" sx={{ color: 'primary.main', mb: 1.5, fontWeight: 600 }}>
                Source not mapped ({unmappedTablesSuggestion.unmappedSourceTables.length})
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2, maxHeight: 320, overflow: 'auto' }}>
                {unmappedTablesSuggestion.unmappedSourceTables.map((name) => {
                  const t = sourceTables.find((x) => x.name === name);
                  return (
                    <Box component="li" key={name} sx={{ py: 0.5, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {name}
                      {t && (
                        <Typography component="span" variant="caption" sx={{ color: 'neutral.500', ml: 1 }}>
                          ({t.columns.length} cols)
                        </Typography>
                      )}
                    </Box>
                  );
                })}
                {unmappedTablesSuggestion.unmappedSourceTables.length === 0 && (
                  <Typography variant="body2" sx={{ color: 'neutral.500' }}>All source tables are mapped</Typography>
                )}
              </Box>
            </Paper>
            <Paper variant="outlined" sx={{ flex: 1, minWidth: 200, p: 2, bgcolor: 'secondary.50', borderColor: 'secondary.200' }}>
              <Typography variant="subtitle2" sx={{ color: 'secondary.main', mb: 1.5, fontWeight: 600 }}>
                Target not mapped ({unmappedTablesSuggestion.unmappedTargetTables.length})
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2, maxHeight: 320, overflow: 'auto' }}>
                {unmappedTablesSuggestion.unmappedTargetTables.map((name) => {
                  const t = targetTables.find((x) => x.name === name);
                  return (
                    <Box component="li" key={name} sx={{ py: 0.5, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {name}
                      {t && (
                        <Typography component="span" variant="caption" sx={{ color: 'neutral.500', ml: 1 }}>
                          ({t.columns.length} cols)
                        </Typography>
                      )}
                    </Box>
                  );
                })}
                {unmappedTablesSuggestion.unmappedTargetTables.length === 0 && (
                  <Typography variant="body2" sx={{ color: 'neutral.500' }}>All target tables are mapped</Typography>
                )}
              </Box>
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setPreviewTablesModalOpen(false)} variant="contained" sx={{ bgcolor: 'neutral.600', '&:hover': { bgcolor: 'neutral.700' } }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Table Mapping Dialog */}
      <Dialog 
        open={isAddingTableMapping || isEditingTableMapping} 
        onClose={handleCloseTableMappingDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'white.main' } }}
      >
        <DialogTitle>
          <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
            {isEditingTableMapping ? 'Edit Table Mapping' : 'Create Table Mapping'}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Description Field */}
            <TextField
              label="Description (optional)"
              placeholder="e.g., User accounts migration"
              value={mappingDescription}
              onChange={(e) => setMappingDescription(e.target.value)}
              fullWidth
              size="small"
              sx={{ 
                '& .MuiOutlinedInput-root': { 
                  bgcolor: 'neutral.100',
                },
              }}
            />
            
            {/* Source and Target Tables */}
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1Bold" sx={{ color: 'primary.main', mb: 1 }}>
                  Source Tables ({selectedSourceTables.length} selected)
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search source tables…"
                  value={createSrcSearch}
                  onChange={(e) => setCreateSrcSearch(e.target.value)}
                  sx={{ mb: 1, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                />
                <Paper sx={{ bgcolor: 'neutral.100', p: 1.5, maxHeight: 250, overflow: 'auto', border: 1, borderColor: 'neutral.200' }}>
                  {sourceTables
                    .filter(table => table.name.toLowerCase().includes(createSrcSearch.trim().toLowerCase()))
                    .map(table => (
                    <Box 
                      key={table.name}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 1, 
                        py: 0.5,
                        px: 1,
                        borderRadius: 1,
                        cursor: 'pointer',
                        bgcolor: selectedSourceTables.includes(table.name) ? 'primary.50' : 'transparent',
                        '&:hover': { bgcolor: 'primary.50' },
                      }}
                      onClick={() => setSelectedSourceTables(prev => 
                        prev.includes(table.name) 
                          ? prev.filter(t => t !== table.name)
                          : [...prev, table.name]
                      )}
                    >
                      <Checkbox
                        checked={selectedSourceTables.includes(table.name)}
                        size="small"
                        sx={{ 
                          p: 0.5, 
                          color: 'primary.main', 
                          '&.Mui-checked': { color: 'primary.main' } 
                        }}
                      />
                      <TruncatedText text={table.name} color="primary.main" placement="right" />
                    </Box>
                  ))}
                </Paper>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <ArrowForwardIcon sx={{ fontSize: 32, color: 'neutral.400' }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1Bold" sx={{ color: 'secondary.main', mb: 1 }}>
                  Target Tables ({selectedTargetTables.length} selected)
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search target tables…"
                  value={createTgtSearch}
                  onChange={(e) => setCreateTgtSearch(e.target.value)}
                  sx={{ mb: 1, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                />
                <Paper sx={{ bgcolor: 'neutral.100', p: 1.5, maxHeight: 250, overflow: 'auto', border: 1, borderColor: 'neutral.200' }}>
                  {targetTables
                    .filter(table => table.name.toLowerCase().includes(createTgtSearch.trim().toLowerCase()))
                    .map(table => (
                    <Box 
                      key={table.name}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 1, 
                        py: 0.5,
                        px: 1,
                        borderRadius: 1,
                        cursor: 'pointer',
                        bgcolor: selectedTargetTables.includes(table.name) ? 'secondary.50' : 'transparent',
                        '&:hover': { bgcolor: 'secondary.50' },
                      }}
                      onClick={() => setSelectedTargetTables(prev => 
                        prev.includes(table.name) 
                          ? prev.filter(t => t !== table.name)
                          : [...prev, table.name]
                      )}
                    >
                      <Checkbox
                        checked={selectedTargetTables.includes(table.name)}
                        size="small"
                        sx={{ 
                          p: 0.5, 
                          color: 'secondary.main', 
                          '&.Mui-checked': { color: 'secondary.main' } 
                        }}
                      />
                      <TruncatedText text={table.name} color="secondary.main" placement="right" />
                    </Box>
                  ))}
                </Paper>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCloseTableMappingDialog} sx={{ color: 'neutral.500' }}>
            <Typography variant="body2Medium">Cancel</Typography>
          </Button>
          <Button
            variant="contained"
            onClick={isEditingTableMapping ? handleUpdateTableMapping : handleCreateTableMapping}
            disabled={selectedSourceTables.length === 0 || selectedTargetTables.length === 0}
            sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.dark' } }}
          >
            <Typography variant="body2Medium">
              {isEditingTableMapping ? 'Update Mapping' : 'Create Mapping'}
            </Typography>
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Column Mapping Modal */}
      {isAddingColumnMapping && activeTableMapping && (
        <AddColumnMappingModal
          sourceTables={getSourceTablesArray(activeTableMapping)}
          targetTables={getTargetTablesArray(activeTableMapping)}
          existingMappings={activeTableMapping.columnMappings}
          editingMapping={editingColumnMapping ?? undefined}
          onAdd={handleAddColumnMapping}
          onClose={() => {
            setIsAddingColumnMapping(false);
            setEditingColumnMapping(null);
          }}
        />
      )}

      {/* Import mappings from JSON */}
      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Import table mappings (JSON)</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'neutral.600', mb: 1 }}>
            Paste JSON copied from “Copy mappings JSON” or a single mapping’s copy button, or choose a file.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
            <Checkbox
              size="small"
              checked={importAppend}
              onChange={(e) => setImportAppend(e.target.checked)}
              sx={{ p: 0.5, color: 'secondary.main', '&.Mui-checked': { color: 'secondary.main' } }}
            />
            <Typography variant="caption" sx={{ color: 'neutral.700' }}>
              Add to existing mappings (an imported source→target replaces a matching one). Uncheck to <b>replace all</b>.
            </Typography>
          </Box>
          <Button component="label" variant="outlined" size="small" startIcon={<UploadIcon />} sx={{ mb: 1.5 }}>
            Choose JSON file
            <input type="file" accept="application/json,.json" hidden onChange={handleImportFile} />
          </Button>
          <TextField
            fullWidth
            multiline
            minRows={10}
            placeholder='{ "tableMappings": [ ... ] }'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '12px' } }}
          />
          {importError && (
            <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 1 }}>
              {importError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setImportOpen(false)} sx={{ color: 'neutral.500' }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleImportMappings}
            disabled={!importText.trim()}
            sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.dark' } }}
          >
            Import
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
