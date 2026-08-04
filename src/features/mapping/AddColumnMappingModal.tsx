import { useState, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, TextField, Select, MenuItem,
  FormControl, InputLabel, ToggleButton, ToggleButtonGroup,
  Checkbox, FormControlLabel, Paper, Alert, IconButton
} from '@mui/material';
import { useAppSelector } from '../../store';
import { selectSourceTables } from '../sourceSchema/sourceSchemaSlice';
import { selectTargetTables } from '../targetSchema/targetSchemaSlice';
import type { 
  MappingType, 
  TransformationRule, 
  TransformationType
} from '../../types';

interface AddColumnMappingModalProps {
  sourceTables: string[];
  targetTables: string[];
  existingMappings?: Array<{ target: { table: string; column: string } }>;
  editingMapping?: {
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
  };
  onAdd: (
    target: { table: string; column: string },
    mappingType: MappingType,
    source?: { table: string; column: string },
    constantValue?: string | number | boolean | null,
    transformation?: TransformationRule,
    sourceColumns?: Array<{ table: string; column: string }>,
    options?: { convertDateToEpoch?: boolean; convertTinyintToBoolean?: boolean; zeroToNull?: boolean; encrypt?: boolean; useGroupMin?: boolean }
  ) => void;
  onClose: () => void;
}

const TRANSFORMATION_TYPES: TransformationType[] = ['UPPER', 'LOWER', 'CONCAT', 'DATE_FORMAT', 'CUSTOM', 'BUILD_JSON'];

interface JsonField { key: string; column: string; jsonKey: string }

// Value kinds a CONSTANT mapping can emit. 'date'/'json' are sent as their raw
// string and coerced by the DB driver into the target column type; 'null' inserts
// a real SQL NULL.
type ConstantType = 'string' | 'number' | 'boolean' | 'null' | 'date' | 'json' | 'epoch';
const CONSTANT_TYPES: ConstantType[] = ['string', 'number', 'boolean', 'null', 'date', 'json', 'epoch'];
const CONSTANT_TYPE_LABELS: Record<ConstantType, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
  date: 'date',
  json: 'json',
  epoch: 'epoch (date → seconds)',
};

/** Current local date/time formatted for a <input type="datetime-local">. */
function nowDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddColumnMappingModal({ 
  sourceTables: mappingSourceTables,
  targetTables: mappingTargetTables,
  existingMappings = [],
  editingMapping,
  onAdd, 
  onClose 
}: AddColumnMappingModalProps) {
  const allSourceTables = useAppSelector(selectSourceTables);
  const allTargetTables = useAppSelector(selectTargetTables);

  const isEditMode = !!editingMapping;

  const availableSourceTables = useMemo(() => 
    allSourceTables.filter(t => mappingSourceTables.includes(t.name)),
    [allSourceTables, mappingSourceTables]
  );
  
  const availableTargetTables = useMemo(() => 
    allTargetTables.filter(t => mappingTargetTables.includes(t.name)),
    [allTargetTables, mappingTargetTables]
  );

  // Initialize state with editing values if present
  const [mappingType, setMappingType] = useState<MappingType>(
    editingMapping?.mappingType ?? 'DIRECT'
  );
  const [selectedTargetTable, setSelectedTargetTable] = useState(
    editingMapping?.target.table ?? mappingTargetTables[0] ?? ''
  );
  const [selectedTargetColumn, setSelectedTargetColumn] = useState(
    editingMapping?.target.column ?? ''
  );
  const [selectedSourceTable, setSelectedSourceTable] = useState(
    editingMapping?.source?.table ?? mappingSourceTables[0] ?? ''
  );
  const [selectedSourceColumn, setSelectedSourceColumn] = useState(
    editingMapping?.source?.column ?? ''
  );
  const [constantType, setConstantType] = useState<ConstantType>(() => {
    const val = editingMapping?.constantValue;
    if (val === null) return 'null';
    if (typeof val === 'number') return 'number';
    if (typeof val === 'boolean') return 'boolean';
    return 'string';
  });
  const [constantValue, setConstantValue] = useState(
    editingMapping?.constantValue !== undefined ? String(editingMapping.constantValue) : ''
  );
  const [transformType, setTransformType] = useState<TransformationType>(
    editingMapping?.transformation?.type ?? 'UPPER'
  );
  const [sourceColSearch, setSourceColSearch] = useState('');
  const [targetColSearch, setTargetColSearch] = useState('');
  const [transformColSearch, setTransformColSearch] = useState('');
  const [transformSourceColumns, setTransformSourceColumns] = useState<Array<{ table: string; column: string }>>(
    editingMapping?.sourceColumns ?? []
  );
  const [transformParams, setTransformParams] = useState<Record<string, string>>(
    (editingMapping?.transformation?.params as Record<string, string>) ?? {}
  );
  // BUILD_JSON: map target JSON keys to source columns (optionally a sub-key of a source JSON column).
  const [jsonFields, setJsonFields] = useState<JsonField[]>(() => {
    const raw = (editingMapping?.transformation?.params as any)?.jsonFields;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(raw) ? raw : [];
  });
  const [convertDateToEpoch, setConvertDateToEpoch] = useState(editingMapping?.convertDateToEpoch ?? false);
  const [convertTinyintToBoolean, setConvertTinyintToBoolean] = useState(editingMapping?.convertTinyintToBoolean ?? false);
  const [encrypt, setEncrypt] = useState(editingMapping?.encrypt ?? false);
  const [zeroToNull, setZeroToNull] = useState(editingMapping?.zeroToNull ?? false);
  const [useGroupMin, setUseGroupMin] = useState(editingMapping?.useGroupMin ?? false);

  const targetColumns = useMemo(() => 
    availableTargetTables.find(t => t.name === selectedTargetTable)?.columns ?? [],
    [availableTargetTables, selectedTargetTable]
  );
  
  const sourceColumns = useMemo(() => 
    availableSourceTables.find(t => t.name === selectedSourceTable)?.columns ?? [],
    [availableSourceTables, selectedSourceTable]
  );

  const allSourceColumns = useMemo(() => {
    const cols: Array<{ table: string; column: string }> = [];
    availableSourceTables.forEach(table => {
      table.columns.forEach(col => {
        cols.push({ table: table.name, column: col.name });
      });
    });
    return cols;
  }, [availableSourceTables]);

  const handleSubmit = () => {
    if (!selectedTargetTable || !selectedTargetColumn) return;

    const target = { table: selectedTargetTable, column: selectedTargetColumn };

    const options = { convertDateToEpoch, convertTinyintToBoolean, zeroToNull, encrypt, useGroupMin };
    if (mappingType === 'DIRECT') {
      onAdd(target, mappingType, { table: selectedSourceTable, column: selectedSourceColumn }, undefined, undefined, undefined, options);
    } else if (mappingType === 'CONSTANT') {
      let value: string | number | boolean | null = constantValue;
      if (constantType === 'number') value = Number(constantValue);
      else if (constantType === 'boolean') value = constantValue.toLowerCase() === 'true';
      else if (constantType === 'null') value = null;
      else if (constantType === 'epoch') {
        // Picked date (or now if empty) → fixed Unix epoch SECONDS stored as a number.
        const d = constantValue ? new Date(constantValue) : new Date();
        value = Number.isNaN(d.getTime()) ? constantValue : Math.floor(d.getTime() / 1000);
      }
      // 'string' | 'date' | 'json' are sent as the raw string — the DB driver coerces
      // the date / JSON text into the target column type on insert.
      onAdd(target, mappingType, undefined, value, undefined, undefined, options);
    } else if (mappingType === 'TRANSFORM') {
      let params: Record<string, any> | undefined =
        Object.keys(transformParams).length > 0 ? transformParams : undefined;
      if (transformType === 'BUILD_JSON') {
        const valid = jsonFields.filter((f) => f.key.trim() && f.column);
        params = { jsonFields: JSON.stringify(valid) };
      }
      const transformation: TransformationRule = { type: transformType, params };
      onAdd(target, mappingType, undefined, undefined, transformation, transformSourceColumns, options);
    }
  };

  // Check if this target column is already mapped (for validation)
  const isDuplicateMapping = useMemo(() => {
    if (!selectedTargetTable || !selectedTargetColumn) return false;
    
    // In edit mode, allow the same target if it's the one being edited
    if (isEditMode && 
        editingMapping?.target.table === selectedTargetTable && 
        editingMapping?.target.column === selectedTargetColumn) {
      return false;
    }
    
    return existingMappings.some(
      m => m.target.table === selectedTargetTable && m.target.column === selectedTargetColumn
    );
  }, [selectedTargetTable, selectedTargetColumn, existingMappings, isEditMode, editingMapping]);

  const isValid = () => {
    if (!selectedTargetTable || !selectedTargetColumn) return false;
    if (isDuplicateMapping) return false;
    
    switch (mappingType) {
      case 'DIRECT': return !!selectedSourceTable && !!selectedSourceColumn;
      case 'CONSTANT': return constantType === 'null' || constantValue !== '';
      case 'TRANSFORM':
        if (transformType === 'CONCAT') return transformSourceColumns.length >= 2;
        if (transformType === 'DATE_FORMAT') return !!transformParams.format && transformSourceColumns.length > 0;
        if (transformType === 'CUSTOM') return !!transformParams.expression;
        if (transformType === 'BUILD_JSON') return jsonFields.some((f) => f.key.trim() && f.column);
        return transformSourceColumns.length > 0;
      default: return false;
    }
  };

  const toggleTransformColumn = (table: string, column: string) => {
    setTransformSourceColumns(prev => {
      const exists = prev.some(s => s.table === table && s.column === column);
      return exists 
        ? prev.filter(s => !(s.table === table && s.column === column))
        : [...prev, { table, column }];
    });
  };

  return (
    <Dialog 
      open 
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { bgcolor: 'white.main' } }}
    >
      <DialogTitle>
        <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
          {isEditMode ? 'Edit Column Mapping' : 'Add Column Mapping'}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
          {/* Duplicate Warning */}
          {isDuplicateMapping && (
            <Alert severity="error" sx={{ py: 0.5 }}>
              This target column is already mapped. Please choose a different target column.
            </Alert>
          )}
          {/* Mapping Type */}
          <Box>
            <Typography variant="body2Bold" sx={{ color: 'primary.main', mb: 1, display: 'block' }}>
              MAPPING TYPE
            </Typography>
            <ToggleButtonGroup
              value={mappingType}
              exclusive
              onChange={(_, val) => val && setMappingType(val)}
              fullWidth
              sx={{ '& .MuiToggleButton-root': { color: 'neutral.500', borderColor: 'neutral.300' } }}
            >
              <ToggleButton value="DIRECT" sx={{ '&.Mui-selected': { bgcolor: 'primary.100', color: 'primary.main', borderColor: 'primary.main' } }}>
                <Typography variant="body2Medium">Direct</Typography>
              </ToggleButton>
              <ToggleButton value="CONSTANT" sx={{ '&.Mui-selected': { bgcolor: 'warning.100', color: 'warning.main', borderColor: 'warning.main' } }}>
                <Typography variant="body2Medium">Constant</Typography>
              </ToggleButton>
              <ToggleButton value="TRANSFORM" sx={{ '&.Mui-selected': { bgcolor: 'secondary.100', color: 'secondary.main', borderColor: 'secondary.main' } }}>
                <Typography variant="body2Medium">Transform</Typography>
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Target Selection */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel sx={{ color: 'neutral.500' }}>Target Table</InputLabel>
              <Select
                value={selectedTargetTable}
                label="Target Table"
                onChange={(e) => { setSelectedTargetTable(e.target.value); setSelectedTargetColumn(''); }}
                sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
              >
                {mappingTargetTables.map(name => (
                  <MenuItem key={name} value={name}>{name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel sx={{ color: 'neutral.500' }}>Target Column</InputLabel>
              <Select
                value={selectedTargetColumn}
                label="Target Column"
                onChange={(e) => setSelectedTargetColumn(e.target.value)}
                onClose={() => setTargetColSearch('')}
                MenuProps={{ autoFocus: false, PaperProps: { sx: { maxHeight: 320 } } }}
                sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
              >
                <Box
                  sx={{ px: 1, py: 0.5, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <TextField
                    fullWidth
                    size="small"
                    autoFocus
                    placeholder="Search columns…"
                    value={targetColSearch}
                    onChange={(e) => setTargetColSearch(e.target.value)}
                  />
                </Box>
                {targetColumns
                  .filter(col => col.name.toLowerCase().includes(targetColSearch.trim().toLowerCase()))
                  .map(col => (
                    <MenuItem key={col.name} value={col.name}>{col.name}</MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Box>

          {/* Direct Mapping */}
          {mappingType === 'DIRECT' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel sx={{ color: 'neutral.500' }}>Source Table</InputLabel>
                  <Select
                    value={selectedSourceTable}
                    label="Source Table"
                    onChange={(e) => { setSelectedSourceTable(e.target.value); setSelectedSourceColumn(''); }}
                    sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                  >
                    {mappingSourceTables.map(name => (
                      <MenuItem key={name} value={name}>{name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel sx={{ color: 'neutral.500' }}>Source Column</InputLabel>
                  <Select
                    value={selectedSourceColumn}
                    label="Source Column"
                    onChange={(e) => setSelectedSourceColumn(e.target.value)}
                    onClose={() => setSourceColSearch('')}
                    MenuProps={{ autoFocus: false, PaperProps: { sx: { maxHeight: 320 } } }}
                    sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                  >
                    <Box
                      sx={{ px: 1, py: 0.5, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 }}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <TextField
                        fullWidth
                        size="small"
                        autoFocus
                        placeholder="Search columns…"
                        value={sourceColSearch}
                        onChange={(e) => setSourceColSearch(e.target.value)}
                      />
                    </Box>
                    {sourceColumns
                      .filter(col => col.name.toLowerCase().includes(sourceColSearch.trim().toLowerCase()))
                      .map(col => (
                        <MenuItem key={col.name} value={col.name}>{col.name}</MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Box>
              <Typography variant="body2Bold" sx={{ color: 'primary.main', mb: 0.5, display: 'block' }}>
                VALUE CONVERSIONS (MySQL → PG)
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={convertDateToEpoch}
                      onChange={(e) => setConvertDateToEpoch(e.target.checked)}
                      size="small"
                      sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                    />
                  }
                  label={<Typography variant="caption1" sx={{ color: 'neutral.700' }}>Convert date/datetime string → epoch (seconds)</Typography>}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={convertTinyintToBoolean}
                      onChange={(e) => setConvertTinyintToBoolean(e.target.checked)}
                      size="small"
                      sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                    />
                  }
                  label={<Typography variant="caption1" sx={{ color: 'neutral.700' }}>Convert tinyint (0/1) → boolean</Typography>}
                />
              </Box>
            </Box>
          )}

          {/* Constant Mapping */}
          {mappingType === 'CONSTANT' && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel sx={{ color: 'neutral.500' }}>Type</InputLabel>
                <Select
                  value={constantType}
                  label="Type"
                  onChange={(e) => setConstantType(e.target.value as ConstantType)}
                  sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                >
                  {CONSTANT_TYPES.map((t) => (
                    <MenuItem key={t} value={t}>{CONSTANT_TYPE_LABELS[t]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {constantType === 'boolean' ? (
                <FormControl fullWidth size="small">
                  <InputLabel sx={{ color: 'neutral.500' }}>Value</InputLabel>
                  <Select
                    value={constantValue}
                    label="Value"
                    onChange={(e) => setConstantValue(e.target.value)}
                    sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                  >
                    <MenuItem value="true">true</MenuItem>
                    <MenuItem value="false">false</MenuItem>
                  </Select>
                </FormControl>
              ) : constantType === 'null' ? (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'neutral.500' }}>
                    Inserts a SQL <b>NULL</b> — the target column is left empty for every row.
                  </Typography>
                </Box>
              ) : constantType === 'epoch' ? (
                <Box sx={{ flex: 1, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Date / time"
                    type="datetime-local"
                    value={constantValue}
                    onChange={(e) => setConstantValue(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    helperText={
                      constantValue && !Number.isNaN(new Date(constantValue).getTime())
                        ? `= ${Math.floor(new Date(constantValue).getTime() / 1000)} (epoch seconds)`
                        : 'Pick a date or click Now'
                    }
                    sx={{
                      '& .MuiInputBase-input': { color: 'primary.main' },
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' },
                      '& .MuiInputLabel-root': { color: 'neutral.500' },
                    }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setConstantValue(nowDatetimeLocal())}
                    sx={{ mt: 0.5, whiteSpace: 'nowrap' }}
                  >
                    Now
                  </Button>
                </Box>
              ) : (
                <TextField
                  fullWidth
                  size="small"
                  label="Value"
                  type={constantType === 'number' ? 'number' : constantType === 'date' ? 'datetime-local' : 'text'}
                  multiline={constantType === 'json'}
                  minRows={constantType === 'json' ? 2 : undefined}
                  placeholder={constantType === 'json' ? '{"key": "value"}' : undefined}
                  value={constantValue}
                  onChange={(e) => setConstantValue(e.target.value)}
                  InputLabelProps={constantType === 'date' ? { shrink: true } : undefined}
                  sx={{
                    '& .MuiInputBase-input': { color: 'primary.main' },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' },
                    '& .MuiInputLabel-root': { color: 'neutral.500' }
                  }}
                />
              )}
            </Box>
          )}

          {/* Transform Mapping */}
          {mappingType === 'TRANSFORM' && (
            <>
              <FormControl fullWidth size="small">
                <InputLabel sx={{ color: 'neutral.500' }}>Transformation Type</InputLabel>
                <Select
                  value={transformType}
                  label="Transformation Type"
                  onChange={(e) => {
                    setTransformType(e.target.value as TransformationType);
                    setTransformParams({});
                    setTransformSourceColumns([]);
                  }}
                  sx={{ color: 'primary.main', '.MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' } }}
                >
                  {TRANSFORMATION_TYPES.map(type => (
                    <MenuItem key={type} value={type}>{type}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {transformType !== 'BUILD_JSON' && (
              <Box>
                <Typography variant="body2Bold" sx={{ color: 'primary.main', mb: 1, display: 'block' }}>
                  SOURCE COLUMNS
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search source columns…"
                  value={transformColSearch}
                  onChange={(e) => setTransformColSearch(e.target.value)}
                  sx={{ mb: 1 }}
                />
                <Paper sx={{ bgcolor: 'neutral.100', p: 1.5, maxHeight: 120, overflow: 'auto', border: 1, borderColor: 'neutral.200' }}>
                  {allSourceColumns
                    .filter(({ table, column }) => `${table}.${column}`.toLowerCase().includes(transformColSearch.trim().toLowerCase()))
                    .map(({ table, column }) => (
                    <FormControlLabel
                      key={`${table}.${column}`}
                      control={
                        <Checkbox
                          checked={transformSourceColumns.some(s => s.table === table && s.column === column)}
                          onChange={() => toggleTransformColumn(table, column)}
                          size="small"
                          sx={{ color: 'secondary.main', '&.Mui-checked': { color: 'secondary.main' } }}
                        />
                      }
                      label={
                        <Typography variant="caption1" sx={{ color: 'primary.main', fontFamily: 'monospace' }}>
                          {table}.{column}
                        </Typography>
                      }
                    />
                  ))}
                </Paper>
              </Box>
              )}

              {transformType === 'BUILD_JSON' && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2Bold" sx={{ color: 'primary.main' }}>
                      JSON FIELDS (key → source)
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => setJsonFields(prev => [...prev, { key: '', column: '', jsonKey: '' }])}
                    >
                      + Add field
                    </Button>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'neutral.500', display: 'block', mb: 1 }}>
                    Builds a JSON object for a json/jsonb target. Leave “sub-key” empty to use the whole column;
                    set it to pull one key out of a source JSON/JSONB column.
                  </Typography>
                  {jsonFields.length === 0 && (
                    <Typography variant="caption" sx={{ color: 'neutral.500' }}>No fields yet — click “Add field”.</Typography>
                  )}
                  {jsonFields.map((f, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="Key"
                        value={f.key}
                        onChange={(e) => setJsonFields(prev => prev.map((x, xi) => xi === i ? { ...x, key: e.target.value } : x))}
                        sx={{ flex: 1 }}
                      />
                      <FormControl size="small" sx={{ flex: 1.3 }}>
                        <InputLabel sx={{ color: 'neutral.500' }}>Source column</InputLabel>
                        <Select
                          label="Source column"
                          value={f.column}
                          onChange={(e) => setJsonFields(prev => prev.map((x, xi) => xi === i ? { ...x, column: e.target.value } : x))}
                        >
                          {[...new Set(allSourceColumns.map(c => c.column))].map(name => (
                            <MenuItem key={name} value={name}>{name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        size="small"
                        label="Sub-key (opt)"
                        placeholder="e.g. name"
                        value={f.jsonKey}
                        onChange={(e) => setJsonFields(prev => prev.map((x, xi) => xi === i ? { ...x, jsonKey: e.target.value } : x))}
                        sx={{ flex: 1 }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => setJsonFields(prev => prev.filter((_, xi) => xi !== i))}
                        sx={{ color: 'warning.main' }}
                      >
                        ✕
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              {transformType === 'CONCAT' && (
                <TextField
                  fullWidth
                  size="small"
                  label="Separator"
                  placeholder="e.g., ', ' or ' - '"
                  value={transformParams.separator ?? ''}
                  onChange={(e) => setTransformParams(prev => ({ ...prev, separator: e.target.value }))}
                  sx={{ 
                    '& .MuiInputBase-input': { color: 'primary.main' },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' },
                    '& .MuiInputLabel-root': { color: 'neutral.500' }
                  }}
                />
              )}

              {transformType === 'DATE_FORMAT' && (
                <TextField
                  fullWidth
                  size="small"
                  label="Date Format"
                  placeholder="e.g., YYYY-MM-DD"
                  value={transformParams.format ?? ''}
                  onChange={(e) => setTransformParams(prev => ({ ...prev, format: e.target.value }))}
                  sx={{ 
                    '& .MuiInputBase-input': { color: 'primary.main' },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' },
                    '& .MuiInputLabel-root': { color: 'neutral.500' }
                  }}
                />
              )}

              {transformType === 'CUSTOM' && (
                <TextField
                  fullWidth
                  size="small"
                  label="Custom Expression"
                  placeholder="Enter SQL expression..."
                  multiline
                  rows={2}
                  value={transformParams.expression ?? ''}
                  onChange={(e) => setTransformParams(prev => ({ ...prev, expression: e.target.value }))}
                  sx={{ 
                    '& .MuiInputBase-input': { color: 'primary.main', fontFamily: 'monospace' },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'neutral.300' },
                    '& .MuiInputLabel-root': { color: 'neutral.500' }
                  }}
                />
              )}
              <Typography variant="body2Bold" sx={{ color: 'primary.main', mb: 0.5, display: 'block' }}>
                VALUE CONVERSIONS (MySQL → PG)
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={convertDateToEpoch}
                      onChange={(e) => setConvertDateToEpoch(e.target.checked)}
                      size="small"
                      sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                    />
                  }
                  label={<Typography variant="caption1" sx={{ color: 'neutral.700' }}>Convert date/datetime string → epoch (seconds)</Typography>}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={convertTinyintToBoolean}
                      onChange={(e) => setConvertTinyintToBoolean(e.target.checked)}
                      size="small"
                      sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                    />
                  }
                  label={<Typography variant="caption1" sx={{ color: 'neutral.700' }}>Convert tinyint (0/1) → boolean</Typography>}
                />
              </Box>
            </>
          )}

          {/* Value rules — apply to any mapping type */}
          <Box sx={{ mt: 1, pt: 1.5, borderTop: 1, borderColor: 'neutral.200' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={zeroToNull}
                  onChange={(e) => setZeroToNull(e.target.checked)}
                  size="small"
                  sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                />
              }
              label={
                <Typography variant="caption1" sx={{ color: 'neutral.700' }}>
                  If the value is <b>0</b>, insert <b>NULL</b> instead (e.g. 0 used as “no value / no foreign key”).
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={encrypt}
                  onChange={(e) => setEncrypt(e.target.checked)}
                  size="small"
                  sx={{ color: 'warning.main', '&.Mui-checked': { color: 'warning.main' } }}
                />
              }
              label={
                <Typography variant="caption1" sx={{ color: 'neutral.700' }}>
                  🔒 Encrypt this column (AES-256) — the value is encrypted with the key entered on the
                  Run Migration page before it's inserted. Target column should be text/varchar.
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={useGroupMin}
                  onChange={(e) => setUseGroupMin(e.target.checked)}
                  size="small"
                  sx={{ color: 'info.main', '&.Mui-checked': { color: 'info.main' } }}
                />
              }
              label={
                <Typography variant="caption1" sx={{ color: 'neutral.700' }}>
                  Use <b>group minimum</b> — take MIN of this source column across its group
                  (needs the table mapping in “All rows” mode with group columns set). Use it to
                  set a child row's foreign key to the parent's lowest id.
                </Typography>
              }
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} sx={{ color: 'neutral.500' }}>
          <Typography variant="body2Medium">Cancel</Typography>
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!isValid()}
          sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.dark' } }}
        >
          <Typography variant="body2Medium">
            {isEditMode ? 'Update Mapping' : 'Add Mapping'}
          </Typography>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
