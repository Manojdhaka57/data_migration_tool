import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Tooltip,
  Autocomplete,
  TextField,
  Tabs,
  Tab,
  Snackbar,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Select,
  MenuItem,
  FormControl,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Download as DownloadIcon,
  Transform as TransformIcon,
  TableChart as TableIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Error as ErrorIcon,
  CheckCircle as SuccessIcon,
  PlayArrow as PlayIcon,
  ArrowForward as ArrowIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { selectTableMappings, selectColumnMappings } from '../mapping/mappingSlice';
import { selectSourceSchema } from '../sourceSchema/sourceSchemaSlice';
import { selectTargetSchema } from '../targetSchema/targetSchemaSlice';
import {
  setSourceData,
  setSourceTableName,
  setTargetTableName,
  setSelectedTables,
  setTransformedData,
  setMultiTableResults,
  addToHistory,
  clearData,
  selectSourceData,
  selectSuccessData,
  selectFailedData,
  selectSourceFileName,
  selectSourceTableName,
  selectTargetTableName,
  selectStats,
  selectIsMultiTableMode,
  selectDetectedTables,
  selectSelectedTables,
  selectTableResults,
  selectMultiTableStats,
} from './dataTransformerSlice';
import {
  parseCSV,
  transformDataWithValidation,
  transformMultiTableData,
  dataToCSV,
  getSourceTables,
  getTargetTables,
  findTableMapping,
  detectTableColumn,
  combineMultiTableData,
} from '../../utils/csvTransformer';
import type { DataRow } from './dataTransformerSlice';

export const DataTransformerPage = () => {
  const dispatch = useAppDispatch();
  
  // Redux state
  const tableMappings = useAppSelector(selectTableMappings);
  const columnMappings = useAppSelector(selectColumnMappings);
  const sourceSchema = useAppSelector(selectSourceSchema);
  const targetSchema = useAppSelector(selectTargetSchema);
  const sourceData = useAppSelector(selectSourceData);
  const successData = useAppSelector(selectSuccessData);
  const failedData = useAppSelector(selectFailedData);
  const sourceFileName = useAppSelector(selectSourceFileName);
  const sourceTableName = useAppSelector(selectSourceTableName);
  const targetTableName = useAppSelector(selectTargetTableName);
  const stats = useAppSelector(selectStats);
  
  // Multi-table state
  const isMultiTableMode = useAppSelector(selectIsMultiTableMode);
  const detectedTables = useAppSelector(selectDetectedTables);
  const selectedTables = useAppSelector(selectSelectedTables);
  const tableResults = useAppSelector(selectTableResults);
  const multiTableStats = useAppSelector(selectMultiTableStats);
  
  // Local state
  const [dragActive, setDragActive] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedTableView, setSelectedTableView] = useState<string | null>(null);
  const [sourcePage, setSourcePage] = useState(0);
  const [sourceRowsPerPage, setSourceRowsPerPage] = useState(10);
  const [successPage, setSuccessPage] = useState(0);
  const [successRowsPerPage, setSuccessRowsPerPage] = useState(10);
  const [failedPage, setFailedPage] = useState(0);
  const [failedRowsPerPage, setFailedRowsPerPage] = useState(10);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  
  // Raw CSV content for re-parsing
  const [rawCsvContent, setRawCsvContent] = useState<string>('');
  
  // Detected table headers state
  interface DetectedHeader {
    rowIndex: number;
    columns: string[];
    mappedTable: string | null;
    matchPercent: number;
    dataRowCount: number;
    selected: boolean;
  }
  const [detectedHeaders, setDetectedHeaders] = useState<DetectedHeader[]>([]);
  const [showHeaderMapping, setShowHeaderMapping] = useState(false);
  
  // Get available source tables from mappings
  const availableSourceTables = useMemo(() => getSourceTables(tableMappings), [tableMappings]);
  
  // Get all source schema table names
  const sourceSchemaTableNames = useMemo(() => 
    sourceSchema?.tables?.map(t => t.name) || [],
    [sourceSchema]
  );
  
  // Get target tables for selected source
  const availableTargetTables = useMemo(() => 
    sourceTableName ? getTargetTables(tableMappings, sourceTableName) : [],
    [tableMappings, sourceTableName]
  );
  
  // Get source columns from data
  const sourceColumns = useMemo(() => 
    sourceData.length > 0 ? Object.keys(sourceData[0]) : [],
    [sourceData]
  );
  
  // Get current view data for multi-table mode
  const currentTableResult = useMemo(() => 
    selectedTableView && tableResults[selectedTableView] ? tableResults[selectedTableView] : null,
    [selectedTableView, tableResults]
  );
  
  // Get success/failed columns
  const successColumns = useMemo(() => {
    if (isMultiTableMode && currentTableResult) {
      return currentTableResult.successData.length > 0 
        ? Object.keys(currentTableResult.successData[0]).filter(k => !k.startsWith('_'))
        : [];
    }
    return successData.length > 0 
      ? Object.keys(successData[0]).filter(k => !k.startsWith('_'))
      : [];
  }, [isMultiTableMode, currentTableResult, successData]);
  
  const failedColumns = useMemo(() => {
    if (isMultiTableMode && currentTableResult) {
      return currentTableResult.failedData.length > 0 
        ? Object.keys(currentTableResult.failedData[0]).filter(k => k !== '_original_row')
        : [];
    }
    return failedData.length > 0 
      ? Object.keys(failedData[0]).filter(k => k !== '_original_row')
      : [];
  }, [isMultiTableMode, currentTableResult, failedData]);
  
  // Current success/failed data
  const currentSuccessData = useMemo(() => 
    isMultiTableMode && currentTableResult ? currentTableResult.successData : successData,
    [isMultiTableMode, currentTableResult, successData]
  );
  
  const currentFailedData = useMemo(() =>
    isMultiTableMode && currentTableResult ? currentTableResult.failedData : failedData,
    [isMultiTableMode, currentTableResult, failedData]
  );
  
  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      processFile(file);
    }
  }, []);
  
  // Handle file input
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, []);
  
  // Calculate column match percentage between CSV columns and schema table
  const calculateMatchPercent = (csvColumns: string[], schemaTableName: string): number => {
    const schemaTable = sourceSchema?.tables?.find(t => t.name === schemaTableName);
    if (!schemaTable) return 0;
    const schemaColumns = schemaTable.columns.map(c => c.name.toLowerCase());
    const csvColsLower = csvColumns.map(c => c.toLowerCase());
    const matchCount = csvColsLower.filter(c => schemaColumns.includes(c)).length;
    return Math.round((matchCount / Math.max(csvColsLower.length, schemaColumns.length)) * 100);
  };

  // Get mapped and unmapped columns for a source table mapping to target
  const getColumnMappingInfo = (sourceTableName: string, csvColumns: string[]): {
    mapped: string[];
    unmapped: string[];
    targetColumns: string[];
    missingInSource: string[];
  } => {
    // Find table mapping that includes this source table
    const tableMapping = findTableMapping(tableMappings, sourceTableName);
    if (!tableMapping) {
      return { mapped: [], unmapped: csvColumns, targetColumns: [], missingInSource: [] };
    }
    
    // Get target table name
    const targets = getTargetTables(tableMappings, sourceTableName);
    const targetTableName = targets[0] || '';
    
    // Get column mappings from this table mapping
    const tableColumnMappings = tableMapping.columnMappings || [];
    
    // Get target table columns
    const targetTable = targetSchema?.tables?.find((t: { name: string }) => t.name === targetTableName);
    const targetColumns = targetTable?.columns?.map((c: { name: string }) => c.name) || [];
    
    // Determine mapped and unmapped columns
    const mappedSourceCols = tableColumnMappings
      .filter(cm => cm.source?.table === sourceTableName)
      .map(cm => cm.source?.column?.toLowerCase() || '');
    
    const mapped = csvColumns.filter(col => mappedSourceCols.includes(col.toLowerCase()));
    const unmapped = csvColumns.filter(col => !mappedSourceCols.includes(col.toLowerCase()));
    
    // Check which target columns don't have a source mapping
    const mappedTargetCols = tableColumnMappings.map(cm => cm.target.column.toLowerCase());
    const missingInSource = targetColumns.filter((col: string) => !mappedTargetCols.includes(col.toLowerCase()));
    
    return { mapped, unmapped, targetColumns, missingInSource };
  };

  // Helper function to find best matching table for columns
  const findBestMatchingTable = (columnNames: string[]): { table: string | null; percent: number } => {
    if (!sourceSchema?.tables) return { table: null, percent: 0 };
    
    let bestMatch = { table: '', score: 0, percent: 0 };
    for (const schemaTable of sourceSchema.tables) {
      const schemaColumns = schemaTable.columns.map(c => c.name.toLowerCase());
      const csvColumns = columnNames.map(c => c.toLowerCase());
      const matchCount = csvColumns.filter(c => schemaColumns.includes(c)).length;
      const score = matchCount / Math.max(csvColumns.length, schemaColumns.length);
      const percent = Math.round(score * 100);
      if (score > bestMatch.score && score > 0.3) {
        bestMatch = { table: schemaTable.name, score, percent };
      }
    }
    return bestMatch.table ? { table: bestMatch.table, percent: bestMatch.percent } : { table: null, percent: 0 };
  };

  // Process uploaded file
  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setRawCsvContent(content);
      
      // Parse CSV to get all rows
      const { headers, rows } = parseCSV(content);
      
      // Store all data first
      dispatch(setSourceData({ 
        data: rows, 
        fileName: file.name,
        detectedTables: [],
      }));
      
      // Find all "id" header row indices in the data
      const idHeaderIndices: number[] = [];
      rows.forEach((row, idx) => {
        const firstColKey = headers[0];
        const firstColValue = row[firstColKey];
        if (firstColValue !== null && firstColValue !== undefined && 
            String(firstColValue).toLowerCase().trim() === 'id') {
          idHeaderIndices.push(idx);
        }
      });
      
      const headers_detected: DetectedHeader[] = [];
      
      if (idHeaderIndices.length === 0) {
        // Single table mode - Row 1 is the only header (CSV column names)
        const row1Match = findBestMatchingTable(headers);
        headers_detected.push({
          rowIndex: 0,
          columns: headers,
          mappedTable: row1Match.table,
          matchPercent: row1Match.percent,
          dataRowCount: rows.length,
          selected: row1Match.table !== null && row1Match.percent >= 50,
        });
      } else {
        // Multi-table mode - first check if Row 1 has data before first "id" row
        const firstIdIndex = idHeaderIndices[0];
        
        if (firstIdIndex > 0) {
          // There's data between Row 1 header and first "id" row
          const row1Match = findBestMatchingTable(headers);
          headers_detected.push({
            rowIndex: 0,
            columns: headers,
            mappedTable: row1Match.table,
            matchPercent: row1Match.percent,
            dataRowCount: firstIdIndex, // Data rows from 0 to first "id" row
            selected: row1Match.table !== null && row1Match.percent >= 50,
          });
        }
        
        // Process each "id" header row
        idHeaderIndices.forEach((idIdx, i) => {
          const row = rows[idIdx];
          const columnNames = headers.map(h => String(row[h] || h));
          const match = findBestMatchingTable(columnNames);
          
          // Calculate data row count: from (idIdx + 1) to next "id" row or end
          const startDataIdx = idIdx + 1;
          const endDataIdx = i < idHeaderIndices.length - 1 
            ? idHeaderIndices[i + 1] 
            : rows.length;
          const dataRowCount = endDataIdx - startDataIdx;
          
          headers_detected.push({
            rowIndex: idIdx + 1, // +1 for display (1-indexed)
            columns: columnNames,
            mappedTable: match.table,
            matchPercent: match.percent,
            dataRowCount: dataRowCount,
            selected: match.table !== null && match.percent >= 50,
          });
        });
      }
      
      setDetectedHeaders(headers_detected);
      setShowHeaderMapping(true);
      
      const multiTable = headers_detected.length > 1;
      setSnackbar({ 
        open: true, 
        message: multiTable 
          ? `Found ${headers_detected.length} table headers in CSV (including Row 1). Map them to source schema tables.`
          : `CSV loaded with ${headers.length} columns, ${rows.length} data rows. Map to source schema table.`
      });
    };
    reader.readAsText(file);
  };
  
  // Update header mapping
  const updateHeaderMapping = (index: number, tableName: string | null) => {
    setDetectedHeaders(prev => prev.map((h, i) => {
      if (i !== index) return h;
      const matchPercent = tableName ? calculateMatchPercent(h.columns, tableName) : 0;
      return { ...h, mappedTable: tableName, matchPercent };
    }));
  };

  // Toggle header selection
  const toggleHeaderSelection = (index: number) => {
    setDetectedHeaders(prev => prev.map((h, i) => 
      i === index ? { ...h, selected: !h.selected } : h
    ));
  };

  // Select all headers
  const selectAllHeaders = (selected: boolean) => {
    setDetectedHeaders(prev => prev.map(h => ({ ...h, selected: h.mappedTable !== null && selected })));
  };
  
  // Generate tables from selected mapped headers
  const generateTablesFromHeaders = useCallback(() => {
    if (!rawCsvContent || detectedHeaders.length === 0) return;
    
    const selectedHeaders = detectedHeaders.filter(h => h.selected && h.mappedTable);
    if (selectedHeaders.length === 0) {
      setSnackbar({ open: true, message: 'Please select at least one table mapping' });
      return;
    }
    
    const { headers, rows } = parseCSV(rawCsvContent);
    const generatedTables: string[] = [];
    const allRows: DataRow[] = [];
    
    selectedHeaders.forEach((header) => {
      const tableName = header.mappedTable!;
      generatedTables.push(tableName);
      
      // Calculate start and end indices based on rowIndex
      let startIdx: number;
      let endIdx: number;
      
      if (header.rowIndex === 0) {
        // Row 1 header (CSV column names) - data starts from index 0
        startIdx = 0;
        endIdx = header.dataRowCount; // Use dataRowCount directly
      } else {
        // "id" header rows - rowIndex is 1-indexed display value
        // Actual data index = rowIndex - 1 (for the header row itself)
        // Data starts after the header row
        const actualHeaderIdx = header.rowIndex - 1; // Convert back to 0-indexed
        startIdx = actualHeaderIdx + 1; // Data starts after header
        endIdx = startIdx + header.dataRowCount;
      }
      
      // Add rows with _table column
      for (let i = startIdx; i < endIdx && i < rows.length; i++) {
        const row = rows[i];
        // Skip rows where first column is "id" (they are headers, not data)
        const firstColKey = headers[0];
        const firstColValue = row[firstColKey];
        if (firstColValue !== null && String(firstColValue).toLowerCase().trim() === 'id') {
          continue;
        }
        
        const newRow: DataRow = { _table: tableName };
        for (const key of Object.keys(row)) {
          const val = row[key];
          newRow[key] = val !== undefined ? val : null;
        }
        allRows.push(newRow);
      }
    });
    
    dispatch(setSourceData({ 
      data: allRows, 
      fileName: sourceFileName || 'uploaded.csv',
      detectedTables: generatedTables,
    }));
    
    dispatch(setSelectedTables(generatedTables));
    setSelectedTableView(generatedTables[0]);
    setShowHeaderMapping(false);
    
    setSnackbar({ 
      open: true, 
      message: `Generated ${generatedTables.length} tables: ${generatedTables.join(', ')}` 
    });
  }, [rawCsvContent, detectedHeaders, dispatch, sourceFileName]);
  
  // Handle transformation
  const handleTransform = useCallback(() => {
    if (isMultiTableMode && selectedTables.length > 0) {
      // Multi-table transformation
      const tableColumn = detectTableColumn(Object.keys(sourceData[0] || {}));
      if (!tableColumn) return;
      
      // Pass targetSchema so each table can get its specific target columns
      const result = transformMultiTableData(
        sourceData,
        tableColumn,
        columnMappings,
        tableMappings,
        undefined, // Will get specific columns per table
        targetSchema?.tables || []
      );
      
      dispatch(setMultiTableResults({
        tableResults: result.tableResults,
        multiTableStats: result.totalStats,
        errors: result.allErrors,
      }));
      
      // Select first table with data for viewing
      const firstTable = Object.keys(result.tableResults)[0];
      if (firstTable) {
        setSelectedTableView(firstTable);
      }
      
      setActiveTab(1);
    } else if (sourceTableName && sourceData.length > 0) {
      // Single table transformation
      // Get target table columns from target schema
      const targetTable = targetSchema?.tables?.find(
        (t: { name: string }) => t.name === targetTableName
      );
      const targetColumns = targetTable?.columns || [];
      
      // Find table mapping to get table-level column mappings (including CONSTANT/default values)
      const tableMapping = findTableMapping(tableMappings, sourceTableName);
      const tableLevelMappings = tableMapping?.columnMappings || [];
      
      // Combine global columnMappings with table-level mappings
      const allMappings = [...columnMappings, ...tableLevelMappings];
      
      const result = transformDataWithValidation(
        sourceData,
        allMappings,
        sourceTableName,
        targetColumns
      );
      
      dispatch(setTransformedData({
        successData: result.successData,
        failedData: result.failedData,
        errors: result.errors,
        stats: result.stats,
      }));
      
      dispatch(addToHistory({
        sourceTable: sourceTableName,
        targetTable: targetTableName || 'unknown',
        originalData: sourceData,
        successData: result.successData,
        failedData: result.failedData,
        errors: result.errors,
        stats: result.stats,
      }));
      
      setActiveTab(result.successData.length > 0 ? 1 : 2);
    }
  }, [dispatch, sourceData, sourceTableName, targetTableName, columnMappings, tableMappings, isMultiTableMode, selectedTables]);
  
  // Download functions
  const handleDownloadSuccess = useCallback(() => {
    if (isMultiTableMode) {
      const combined = combineMultiTableData(tableResults, 'success');
      if (combined.length === 0) return;
      const csv = dataToCSV(combined, ['_original_row', '_error']);
      downloadCSV(csv, 'all_tables_success.csv');
      setSnackbar({ open: true, message: `Downloaded ${combined.length} successful rows from all tables` });
    } else {
      if (successData.length === 0) return;
      const csv = dataToCSV(successData, ['_original_row', '_error']);
      downloadCSV(csv, `${targetTableName || 'transformed'}_success.csv`);
      setSnackbar({ open: true, message: `Downloaded ${successData.length} successful rows` });
    }
  }, [isMultiTableMode, tableResults, successData, targetTableName]);
  
  const handleDownloadFailed = useCallback(() => {
    if (isMultiTableMode) {
      const combined = combineMultiTableData(tableResults, 'failed');
      if (combined.length === 0) return;
      const csv = dataToCSV(combined, ['_original_row']);
      downloadCSV(csv, 'all_tables_failed.csv');
      setSnackbar({ open: true, message: `Downloaded ${combined.length} failed rows from all tables` });
    } else {
      if (failedData.length === 0) return;
      const csv = dataToCSV(failedData, ['_original_row']);
      downloadCSV(csv, `${targetTableName || 'transformed'}_failed.csv`);
      setSnackbar({ open: true, message: `Downloaded ${failedData.length} failed rows` });
    }
  }, [isMultiTableMode, tableResults, failedData, targetTableName]);
  
  const handleDownloadTableSuccess = useCallback((tableName: string) => {
    const result = tableResults[tableName];
    if (!result || result.successData.length === 0) return;
    const csv = dataToCSV(result.successData, ['_original_row', '_error']);
    downloadCSV(csv, `${tableName}_success.csv`);
    setSnackbar({ open: true, message: `Downloaded ${result.successData.length} rows for ${tableName}` });
  }, [tableResults]);
  
  const handleDownloadTableFailed = useCallback((tableName: string) => {
    const result = tableResults[tableName];
    if (!result || result.failedData.length === 0) return;
    const csv = dataToCSV(result.failedData, ['_original_row']);
    downloadCSV(csv, `${tableName}_failed.csv`);
    setSnackbar({ open: true, message: `Downloaded ${result.failedData.length} failed rows for ${tableName}` });
  }, [tableResults]);
  
  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Copy functions
  const handleCopySuccess = useCallback(() => {
    const data = isMultiTableMode 
      ? combineMultiTableData(tableResults, 'success')
      : successData;
    const csv = dataToCSV(data, ['_original_row', '_error']);
    navigator.clipboard.writeText(csv);
    setSnackbar({ open: true, message: 'Success data copied to clipboard!' });
  }, [isMultiTableMode, tableResults, successData]);
  
  const handleCopyFailed = useCallback(() => {
    const data = isMultiTableMode 
      ? combineMultiTableData(tableResults, 'failed')
      : failedData;
    const csv = dataToCSV(data, ['_original_row']);
    navigator.clipboard.writeText(csv);
    setSnackbar({ open: true, message: 'Failed data copied to clipboard!' });
  }, [isMultiTableMode, tableResults, failedData]);
  
  // Toggle table selection
  const handleToggleTable = (tableName: string) => {
    const newSelected = selectedTables.includes(tableName)
      ? selectedTables.filter(t => t !== tableName)
      : [...selectedTables, tableName];
    dispatch(setSelectedTables(newSelected));
  };
  
  // Clear data
  const handleClear = useCallback(() => {
    dispatch(clearData());
    setActiveTab(0);
    setSelectedTableView(null);
  }, [dispatch]);
  
  const hasTransformedData = isMultiTableMode 
    ? Object.keys(tableResults).length > 0
    : successData.length > 0 || failedData.length > 0;
  
  const totalSuccessCount = isMultiTableMode && multiTableStats
    ? multiTableStats.totalSuccessRows
    : successData.length;
  
  const totalFailedCount = isMultiTableMode && multiTableStats
    ? multiTableStats.totalFailedRows
    : failedData.length;
  
  // Check if a row is a header row (first column value is "id")
  const isHeaderRow = useCallback((row: Record<string, unknown>): boolean => {
    if (sourceColumns.length === 0) return false;
    const firstColValue = row[sourceColumns[0]];
    return firstColValue !== null && 
           firstColValue !== undefined && 
           String(firstColValue).toLowerCase().trim() === 'id';
  }, [sourceColumns]);
  
  // Count header rows in visible data
  const headerRowCount = useMemo(() => {
    return sourceData.filter(row => isHeaderRow(row)).length;
  }, [sourceData, isHeaderRow]);
  
  return (
    <Box sx={{ 
      height: '100%', 
      display: 'flex',
      bgcolor: '#F9FAFB',
    }}>
      {/* Left Panel */}
      <Box sx={{ 
        width: 320, 
        borderRight: '1px solid #E5E7EB',
        display: 'flex', 
        flexDirection: 'column',
        bgcolor: '#FFFFFF',
      }}>
        {/* Header */}
        <Box sx={{ 
          p: 2, 
          bgcolor: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ 
              p: 1, 
              borderRadius: 1.5, 
              bgcolor: '#DBEAFE',
              display: 'flex',
            }}>
              <TransformIcon sx={{ color: '#2563EB', fontSize: 24 }} />
            </Box>
            <Box>
              <Typography variant="h3Bold" sx={{ color: '#1F2937' }}>
                Data Transformer
              </Typography>
              <Typography variant="caption1" sx={{ color: '#6B7280' }}>
                {isMultiTableMode 
                  ? `${detectedTables.length} tables detected`
                  : 'Transform CSV data'}
              </Typography>
            </Box>
          </Box>
        </Box>
        
        {/* Upload Section */}
        <Box sx={{ p: 2, borderBottom: '1px solid #E5E7EB' }}>
          <Typography variant="body2Bold" sx={{ color: '#1F2937', mb: 1.5 }}>
            📁 Upload CSV File
          </Typography>
          <Paper
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onClick={() => document.getElementById('csv-upload')?.click()}
            sx={{
              p: 2.5,
              border: '2px dashed',
              borderColor: dragActive ? '#3B82F6' : '#E5E7EB',
              bgcolor: dragActive ? '#EFF6FF' : '#F9FAFB',
              borderRadius: 2,
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s ease',
              '&:hover': { borderColor: '#3B82F6', bgcolor: '#EFF6FF' },
            }}
          >
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              hidden
              onChange={handleFileInput}
            />
            <UploadIcon sx={{ fontSize: 36, color: '#3B82F6', mb: 1 }} />
            <Typography variant="body2" sx={{ color: '#4B5563' }}>
              {sourceFileName || 'Drop CSV file here'}
            </Typography>
            <Typography variant="caption1" sx={{ color: '#9CA3AF', display: 'block', mt: 0.5 }}>
              or click to browse
            </Typography>
          </Paper>
          
          {sourceFileName && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1.5 }}>
              <Chip
                label={sourceFileName}
                size="small"
                sx={{ bgcolor: '#DBEAFE', color: '#1E40AF', fontWeight: 500 }}
              />
              <Button
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handleClear}
                sx={{ color: '#DC2626', '&:hover': { bgcolor: '#FEE2E2' } }}
              >
                Clear
              </Button>
            </Box>
          )}
        </Box>
        
        {/* Detected Headers Summary - Left Panel */}
        {showHeaderMapping && detectedHeaders.length > 0 && (
          <Box sx={{ flex: 1, overflow: 'auto', borderBottom: '1px solid #E5E7EB' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
              <Typography variant="body2Bold" sx={{ color: '#92400E' }}>
                🔍 {detectedHeaders.length} Table{detectedHeaders.length > 1 ? 's' : ''} Detected
              </Typography>
              <Typography variant="caption1" sx={{ color: '#78350F', display: 'block', mt: 0.5 }}>
                Map tables in right panel
              </Typography>
            </Box>
            
            {/* Simple Table List */}
            <List dense disablePadding sx={{ p: 1 }}>
              {detectedHeaders.map((header, idx) => (
                <ListItem key={idx} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton 
                    onClick={() => toggleHeaderSelection(idx)}
                    disabled={!header.mappedTable}
                    dense
                    sx={{
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: header.selected ? '#10B981' : (header.mappedTable ? '#E5E7EB' : '#FEE2E2'),
                      bgcolor: header.selected ? '#ECFDF5' : '#FFFFFF',
                      '&:hover': { bgcolor: header.selected ? '#D1FAE5' : '#F9FAFB' },
                      py: 1,
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <Checkbox
                        checked={header.selected}
                        disabled={!header.mappedTable}
                        size="small"
                        sx={{ p: 0, color: '#D1D5DB', '&.Mui-checked': { color: '#10B981' } }}
                      />
                    </ListItemIcon>
                    <ListItemText 
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Chip 
                            label={header.rowIndex === 0 ? '1' : header.rowIndex + 1}
                            size="small"
                            sx={{ 
                              height: 18, 
                              fontSize: '10px',
                              bgcolor: header.rowIndex === 0 ? '#3B82F6' : '#F59E0B', 
                              color: '#FFFFFF', 
                              fontWeight: 600,
                            }}
                          />
                          <Typography variant="body2" sx={{ color: '#1F2937', fontWeight: 500, fontSize: '12px' }}>
                            {header.mappedTable || 'Not mapped'}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '10px' }}>
                          {header.dataRowCount} rows • {header.columns.length} cols
                        </Typography>
                      }
                    />
                    {header.mappedTable && (
                      <Chip 
                        label={`${header.matchPercent}%`}
                        size="small"
                        sx={{ 
                          height: 18, 
                          fontSize: '9px',
                          bgcolor: header.matchPercent >= 70 ? '#D1FAE5' : 
                                   header.matchPercent >= 50 ? '#FEF3C7' : '#FEE2E2',
                          color: header.matchPercent >= 70 ? '#065F46' : 
                                 header.matchPercent >= 50 ? '#92400E' : '#991B1B',
                        }}
                      />
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
        )}
        
        {/* Transform Button - Header Mapping Mode */}
        {showHeaderMapping && detectedHeaders.length > 0 && (
          <Box sx={{ p: 2, borderTop: '1px solid #E5E7EB' }}>
            <Button
              fullWidth
              variant="contained"
              onClick={generateTablesFromHeaders}
              disabled={detectedHeaders.filter(h => h.selected && h.mappedTable).length === 0}
              startIcon={<TransformIcon />}
              sx={{ 
                bgcolor: '#10B981', 
                '&:hover': { bgcolor: '#059669' },
                '&.Mui-disabled': { bgcolor: '#E5E7EB', color: '#9CA3AF' },
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              Transform {detectedHeaders.filter(h => h.selected && h.mappedTable).length} Table{detectedHeaders.filter(h => h.selected && h.mappedTable).length !== 1 ? 's' : ''}
            </Button>
          </Box>
        )}
        
        {/* Table Selection Header */}
        {!showHeaderMapping && (
          <Box sx={{ px: 2, py: 1.5, bgcolor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
            <Typography variant="body2Bold" sx={{ color: '#1F2937' }}>
              {isMultiTableMode ? '📋 Select Tables' : '🔗 Table Mapping'}
            </Typography>
          </Box>
        )}
        
        {/* Table Selection */}
        {!showHeaderMapping && (
          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {isMultiTableMode ? (
            <List dense disablePadding>
              {detectedTables.map((tableName) => (
                <ListItem key={tableName} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton 
                    onClick={() => handleToggleTable(tableName)} 
                    dense
                    sx={{
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: selectedTables.includes(tableName) ? '#8B5CF6' : '#E5E7EB',
                      bgcolor: selectedTables.includes(tableName) ? '#F5F3FF' : '#FFFFFF',
                      '&:hover': { bgcolor: selectedTables.includes(tableName) ? '#EDE9FE' : '#F9FAFB' },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <Checkbox
                        checked={selectedTables.includes(tableName)}
                        size="small"
                        sx={{ p: 0, color: '#D1D5DB', '&.Mui-checked': { color: '#8B5CF6' } }}
                      />
                    </ListItemIcon>
                    <ListItemText 
                      primary={tableName}
                      sx={{ '& .MuiListItemText-primary': { color: '#1F2937', fontSize: '13px', fontWeight: 500 } }}
                    />
                    {tableResults[tableName] && (
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Chip 
                          label={tableResults[tableName].successData.length} 
                          size="small" 
                          sx={{ height: 18, fontSize: '10px', bgcolor: '#D1FAE5', color: '#065F46' }} 
                        />
                        {tableResults[tableName].failedData.length > 0 && (
                          <Chip 
                            label={tableResults[tableName].failedData.length} 
                            size="small" 
                            sx={{ height: 18, fontSize: '10px', bgcolor: '#FEE2E2', color: '#991B1B' }} 
                          />
                        )}
                      </Box>
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          ) : (
            <>
              <Autocomplete
                size="small"
                options={availableSourceTables}
                value={sourceTableName}
                onChange={(_, value) => {
                  dispatch(setSourceTableName(value || ''));
                  if (value) {
                    const targets = getTargetTables(tableMappings, value);
                    if (targets.length > 0) {
                      dispatch(setTargetTableName(targets[0]));
                    }
                  }
                }}
                renderInput={(params) => (
                  <TextField 
                    {...params} 
                    label="Source Table" 
                    placeholder="Select source table"
                  />
                )}
                sx={{ mb: 2 }}
              />
              
              <Autocomplete
                size="small"
                options={availableTargetTables}
                value={targetTableName}
                onChange={(_, value) => dispatch(setTargetTableName(value || ''))}
                disabled={!sourceTableName}
                renderInput={(params) => (
                  <TextField 
                    {...params} 
                    label="Target Table" 
                    placeholder="Select target table"
                  />
                )}
              />
              
              {sourceTableName && targetTableName && (
                <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1, p: 1.5, bgcolor: '#F9FAFB', borderRadius: 1 }}>
                  <Chip 
                    label={sourceTableName}
                    size="small"
                    sx={{ bgcolor: '#DBEAFE', color: '#1E40AF' }}
                  />
                  <ArrowIcon sx={{ fontSize: 14, color: '#9CA3AF' }} />
                  <Chip 
                    label={targetTableName}
                    size="small"
                    sx={{ bgcolor: '#F5F3FF', color: '#6D28D9' }}
                  />
                </Box>
              )}
            </>
          )}
          </Box>
        )}
        
        {/* Action Button */}
        {!showHeaderMapping && (
          <Box sx={{ p: 2, borderTop: '1px solid #E5E7EB' }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<PlayIcon />}
              onClick={handleTransform}
              disabled={isMultiTableMode ? selectedTables.length === 0 : !sourceTableName || sourceData.length === 0}
              sx={{ 
                bgcolor: '#8B5CF6', 
                '&:hover': { bgcolor: '#7C3AED' },
                '&.Mui-disabled': { bgcolor: '#E5E7EB', color: '#9CA3AF' },
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              Transform {isMultiTableMode ? `(${selectedTables.length} Tables)` : '& Validate'}
            </Button>
          </Box>
        )}
        
        {/* Stats */}
        {(stats || multiTableStats) && (
          <Box sx={{ p: 2, borderTop: '1px solid #E5E7EB', bgcolor: '#F9FAFB' }}>
            <Typography variant="body2Bold" sx={{ color: '#1F2937', mb: 1.5 }}>
              📊 Results
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
              <Box sx={{ bgcolor: '#FFFFFF', border: '1px solid #E5E7EB', p: 1.5, borderRadius: 1 }}>
                <Typography variant="caption1" sx={{ color: '#6B7280' }}>Total</Typography>
                <Typography variant="h3Bold" sx={{ color: '#1F2937' }}>
                  {isMultiTableMode ? multiTableStats?.totalRows : stats?.totalRows}
                </Typography>
              </Box>
              <Box sx={{ bgcolor: '#DBEAFE', border: '1px solid #BFDBFE', p: 1.5, borderRadius: 1 }}>
                <Typography variant="caption1" sx={{ color: '#1E40AF' }}>
                  {isMultiTableMode ? 'Tables' : 'Columns'}
                </Typography>
                <Typography variant="h3Bold" sx={{ color: '#1E40AF' }}>
                  {isMultiTableMode ? multiTableStats?.totalTables : stats?.columnsTransformed}
                </Typography>
              </Box>
              <Box 
                sx={{ bgcolor: '#D1FAE5', border: '1px solid #A7F3D0', p: 1.5, borderRadius: 1, cursor: 'pointer' }} 
                onClick={() => setActiveTab(1)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <SuccessIcon sx={{ fontSize: 12, color: '#059669' }} />
                  <Typography variant="caption1" sx={{ color: '#065F46' }}>Success</Typography>
                </Box>
                <Typography variant="h3Bold" sx={{ color: '#059669' }}>
                  {totalSuccessCount}
                </Typography>
              </Box>
              <Box 
                sx={{ bgcolor: '#FEE2E2', border: '1px solid #FECACA', p: 1.5, borderRadius: 1, cursor: 'pointer' }} 
                onClick={() => setActiveTab(2)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ErrorIcon sx={{ fontSize: 12, color: '#DC2626' }} />
                  <Typography variant="caption1" sx={{ color: '#991B1B' }}>Failed</Typography>
                </Box>
                <Typography variant="h3Bold" sx={{ color: '#DC2626' }}>
                  {totalFailedCount}
                </Typography>
              </Box>
            </Box>
            
            {/* Download Buttons */}
            {hasTransformedData && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {totalSuccessCount > 0 && (
                  <Button
                    fullWidth
                    variant="contained"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownloadSuccess}
                    sx={{ bgcolor: '#10B981', '&:hover': { bgcolor: '#059669' }, textTransform: 'none' }}
                  >
                    Download Success ({totalSuccessCount})
                  </Button>
                )}
                {totalFailedCount > 0 && (
                  <Button
                    fullWidth
                    variant="outlined"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownloadFailed}
                    sx={{ color: '#DC2626', borderColor: '#DC2626', '&:hover': { bgcolor: '#FEE2E2' }, textTransform: 'none' }}
                  >
                    Download Failed ({totalFailedCount})
                  </Button>
                )}
              </Box>
            )}
          </Box>
        )}
        
        {/* Per-Table Downloads (Multi-table mode) */}
        {isMultiTableMode && Object.keys(tableResults).length > 0 && (
          <Box sx={{ p: 2, borderTop: '1px solid #E5E7EB', maxHeight: 180, overflow: 'auto' }}>
            <Typography variant="body2Bold" sx={{ color: '#1F2937', mb: 1 }}>
              📥 Per Table
            </Typography>
            
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {Object.entries(tableResults).map(([tableName, result]) => (
                <Box
                  key={tableName}
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: selectedTableView === tableName ? '#F5F3FF' : '#FFFFFF',
                    border: '1px solid',
                    borderColor: selectedTableView === tableName ? '#8B5CF6' : '#E5E7EB',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: selectedTableView === tableName ? '#EDE9FE' : '#F9FAFB' },
                  }}
                  onClick={() => setSelectedTableView(tableName)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2Bold" sx={{ color: '#1F2937', fontSize: '12px' }}>
                      {tableName}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {result.successData.length > 0 && (
                        <Chip
                          label={`✓${result.successData.length}`}
                          size="small"
                          onClick={(e) => { e.stopPropagation(); handleDownloadTableSuccess(tableName); }}
                          sx={{ height: 18, fontSize: '9px', bgcolor: '#D1FAE5', color: '#065F46', cursor: 'pointer', '&:hover': { bgcolor: '#A7F3D0' } }}
                        />
                      )}
                      {result.failedData.length > 0 && (
                        <Chip
                          label={`✗${result.failedData.length}`}
                          size="small"
                          onClick={(e) => { e.stopPropagation(); handleDownloadTableFailed(tableName); }}
                          sx={{ height: 18, fontSize: '9px', bgcolor: '#FEE2E2', color: '#991B1B', cursor: 'pointer', '&:hover': { bgcolor: '#FECACA' } }}
                        />
                      )}
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
      
      {/* Right Panel - Data Preview */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header Mapping Table - Right Panel (when in header mapping mode) */}
        {showHeaderMapping && detectedHeaders.length > 0 && (
          <Box sx={{ bgcolor: '#FFFFFF', borderBottom: '1px solid #E5E7EB' }}>
            <Box sx={{ px: 3, py: 2, bgcolor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h3Bold" sx={{ color: '#1F2937' }}>
                    📋 Table Mapping
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#6B7280', mt: 0.5 }}>
                    Map CSV headers to source schema tables. Select tables to include in transformation.
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip 
                    label={`${detectedHeaders.filter(h => h.selected).length} selected`}
                    size="small"
                    sx={{ bgcolor: '#10B981', color: '#FFFFFF', fontWeight: 500 }}
                  />
                  <Chip 
                    label={`${detectedHeaders.filter(h => h.mappedTable).length}/${detectedHeaders.length} mapped`}
                    size="small"
                    sx={{ bgcolor: '#DBEAFE', color: '#1E40AF', fontWeight: 500 }}
                  />
                </Box>
              </Box>
            </Box>
            
            {/* Header Mapping Table */}
            <TableContainer sx={{ maxHeight: 'calc(100vh - 400px)' }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#F3F4F6' }}>
                    <TableCell padding="checkbox" sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB' }}>
                      <Checkbox
                        size="small"
                        indeterminate={
                          detectedHeaders.filter(h => h.selected).length > 0 && 
                          detectedHeaders.filter(h => h.selected).length < detectedHeaders.filter(h => h.mappedTable).length
                        }
                        checked={
                          detectedHeaders.filter(h => h.mappedTable).length > 0 &&
                          detectedHeaders.filter(h => h.selected && h.mappedTable).length === 
                          detectedHeaders.filter(h => h.mappedTable).length
                        }
                        onChange={(e) => selectAllHeaders(e.target.checked)}
                        sx={{ color: '#6B7280' }}
                      />
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', width: 70 }}>
                      Row #
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', width: 100 }}>
                      Type
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', minWidth: 250 }}>
                      Columns (Header Content)
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', width: 80 }}>
                      Rows
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', minWidth: 200 }}>
                      Map to Table
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', textAlign: 'center', width: 80 }}>
                      Match %
                    </TableCell>
                    <TableCell sx={{ bgcolor: '#F3F4F6', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', minWidth: 150 }}>
                      Column Status
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detectedHeaders.map((header, idx) => (
                    <TableRow 
                      key={idx}
                      sx={{ 
                        bgcolor: header.selected ? '#ECFDF5' : (header.mappedTable ? '#FFFFFF' : '#FEF2F2'),
                        '&:hover': { bgcolor: header.selected ? '#D1FAE5' : '#F9FAFB' },
                        transition: 'background-color 0.2s',
                        borderLeft: header.selected ? '4px solid #10B981' : '4px solid transparent',
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={header.selected}
                          disabled={!header.mappedTable}
                          onChange={() => toggleHeaderSelection(idx)}
                          sx={{ 
                            color: header.mappedTable ? '#10B981' : '#D1D5DB',
                            '&.Mui-checked': { color: '#10B981' },
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={header.rowIndex === 0 ? '1' : header.rowIndex + 1}
                          size="small"
                          sx={{ 
                            height: 26, 
                            minWidth: 40,
                            bgcolor: header.rowIndex === 0 ? '#3B82F6' : '#F59E0B', 
                            color: '#FFFFFF', 
                            fontWeight: 700,
                            fontSize: '13px',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={header.rowIndex === 0 ? 'CSV Header' : 'ID Header'}
                          size="small"
                          sx={{ 
                            height: 24, 
                            bgcolor: header.rowIndex === 0 ? '#DBEAFE' : '#FEF3C7', 
                            color: header.rowIndex === 0 ? '#1E40AF' : '#92400E', 
                            fontWeight: 600,
                            fontSize: '11px',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Tooltip 
                          title={
                            <Box sx={{ p: 1 }}>
                              <Typography variant="body2Bold" sx={{ mb: 1, display: 'block' }}>
                                All Columns ({header.columns.length}):
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {header.columns.map((col, i) => (
                                  <Chip 
                                    key={i} 
                                    label={col} 
                                    size="small" 
                                    sx={{ height: 18, fontSize: '10px', bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} 
                                  />
                                ))}
                              </Box>
                            </Box>
                          }
                          placement="top"
                          arrow
                        >
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, cursor: 'help' }}>
                            {header.columns.slice(0, 5).map((col, colIdx) => (
                              <Chip 
                                key={colIdx}
                                label={col}
                                size="small"
                                sx={{ 
                                  height: 22, 
                                  fontSize: '11px', 
                                  bgcolor: '#DBEAFE', 
                                  color: '#1E40AF',
                                  fontWeight: 500,
                                }}
                              />
                            ))}
                            {header.columns.length > 5 && (
                              <Chip 
                                label={`+${header.columns.length - 5}`}
                                size="small"
                                sx={{ height: 22, fontSize: '11px', bgcolor: '#E5E7EB', color: '#6B7280', fontWeight: 600 }}
                              />
                            )}
                          </Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: '#4B5563', fontWeight: 600 }}>
                          {header.dataRowCount}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <FormControl size="small" sx={{ minWidth: 180, width: '100%' }}>
                          <Select
                            value={header.mappedTable || ''}
                            onChange={(e) => updateHeaderMapping(idx, e.target.value || null)}
                            displayEmpty
                            sx={{
                              bgcolor: '#FFFFFF',
                              fontSize: '13px',
                              '& .MuiOutlinedInput-notchedOutline': { 
                                borderColor: header.mappedTable ? '#10B981' : '#EF4444',
                                borderWidth: 2,
                              },
                              '&:hover .MuiOutlinedInput-notchedOutline': { 
                                borderColor: header.mappedTable ? '#059669' : '#DC2626',
                              },
                              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { 
                                borderColor: '#3B82F6',
                              },
                            }}
                          >
                            <MenuItem value="" sx={{ color: '#9CA3AF', fontSize: '12px' }}>
                              <em>Select table...</em>
                            </MenuItem>
                            {sourceSchemaTableNames.map((tableName) => (
                              <MenuItem 
                                key={tableName} 
                                value={tableName}
                                sx={{ 
                                  fontSize: '12px',
                                  '&:hover': { bgcolor: '#DBEAFE' },
                                  '&.Mui-selected': { bgcolor: '#D1FAE5', '&:hover': { bgcolor: '#A7F3D0' } },
                                }}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <TableIcon sx={{ fontSize: 16, color: '#6B7280' }} />
                                  <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>{tableName}</Typography>
                                  <Chip 
                                    label={`${calculateMatchPercent(header.columns, tableName)}%`}
                                    size="small"
                                    sx={{ 
                                      height: 20, 
                                      fontSize: '10px',
                                      fontWeight: 600,
                                      bgcolor: calculateMatchPercent(header.columns, tableName) >= 70 ? '#D1FAE5' : 
                                               calculateMatchPercent(header.columns, tableName) >= 50 ? '#FEF3C7' : '#FEE2E2',
                                      color: calculateMatchPercent(header.columns, tableName) >= 70 ? '#065F46' : 
                                             calculateMatchPercent(header.columns, tableName) >= 50 ? '#92400E' : '#991B1B',
                                    }}
                                  />
                                </Box>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell sx={{ textAlign: 'center' }}>
                        {header.mappedTable ? (
                          <Chip
                            label={`${header.matchPercent}%`}
                            size="small"
                            sx={{
                              height: 26,
                              fontWeight: 700,
                              fontSize: '12px',
                              bgcolor: header.matchPercent >= 70 ? '#D1FAE5' : 
                                       header.matchPercent >= 50 ? '#FEF3C7' : '#FEE2E2',
                              color: header.matchPercent >= 70 ? '#065F46' : 
                                     header.matchPercent >= 50 ? '#92400E' : '#991B1B',
                              border: '2px solid',
                              borderColor: header.matchPercent >= 70 ? '#10B981' : 
                                           header.matchPercent >= 50 ? '#F59E0B' : '#EF4444',
                            }}
                          />
                        ) : (
                          <Chip label="—" size="small" sx={{ height: 26, bgcolor: '#FEE2E2', color: '#991B1B' }} />
                        )}
                      </TableCell>
                      <TableCell>
                        {header.mappedTable ? (
                          (() => {
                            const colInfo = getColumnMappingInfo(header.mappedTable, header.columns);
                            const hasUnmapped = colInfo.unmapped.length > 0;
                            const hasMissing = colInfo.missingInSource.length > 0;
                            return (
                              <Tooltip
                                title={
                                  <Box sx={{ p: 1 }}>
                                    <Typography variant="body2Bold" sx={{ color: '#10B981', mb: 1 }}>
                                      ✓ Mapped ({colInfo.mapped.length}):
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                                      {colInfo.mapped.length > 0 ? colInfo.mapped.map((col, i) => (
                                        <Chip key={i} label={col} size="small" sx={{ height: 16, fontSize: '9px', bgcolor: '#D1FAE5', color: '#065F46' }} />
                                      )) : <Typography variant="caption" sx={{ color: '#9CA3AF' }}>None</Typography>}
                                    </Box>
                                    
                                    {colInfo.unmapped.length > 0 && (
                                      <>
                                        <Typography variant="body2Bold" sx={{ color: '#F59E0B', mb: 1 }}>
                                          ⚠ Not Migrated ({colInfo.unmapped.length}):
                                        </Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                                          {colInfo.unmapped.map((col, i) => (
                                            <Chip key={i} label={col} size="small" sx={{ height: 16, fontSize: '9px', bgcolor: '#FEF3C7', color: '#92400E' }} />
                                          ))}
                                        </Box>
                                      </>
                                    )}
                                    
                                    {colInfo.missingInSource.length > 0 && (
                                      <>
                                        <Typography variant="body2Bold" sx={{ color: '#EF4444', mb: 1 }}>
                                          ✗ Missing in Source ({colInfo.missingInSource.length}):
                                        </Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                          {colInfo.missingInSource.map((col, i) => (
                                            <Chip key={i} label={col} size="small" sx={{ height: 16, fontSize: '9px', bgcolor: '#FEE2E2', color: '#991B1B' }} />
                                          ))}
                                        </Box>
                                      </>
                                    )}
                                  </Box>
                                }
                                placement="left"
                                arrow
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
                                  <Chip 
                                    label={`${colInfo.mapped.length}✓`}
                                    size="small"
                                    sx={{ height: 22, fontSize: '10px', bgcolor: '#D1FAE5', color: '#065F46', fontWeight: 600 }}
                                  />
                                  {hasUnmapped && (
                                    <Chip 
                                      label={`${colInfo.unmapped.length}⚠`}
                                      size="small"
                                      sx={{ height: 22, fontSize: '10px', bgcolor: '#FEF3C7', color: '#92400E', fontWeight: 600 }}
                                    />
                                  )}
                                  {hasMissing && (
                                    <Chip 
                                      label={`${colInfo.missingInSource.length}✗`}
                                      size="small"
                                      sx={{ height: 22, fontSize: '10px', bgcolor: '#FEE2E2', color: '#991B1B', fontWeight: 600 }}
                                    />
                                  )}
                                </Box>
                              </Tooltip>
                            );
                          })()
                        ) : (
                          <Typography variant="caption" sx={{ color: '#9CA3AF' }}>—</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            
            {/* Match Legend */}
            <Box sx={{ p: 2, bgcolor: '#F9FAFB', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                Match: 
                <Chip label="≥70% Good" size="small" sx={{ height: 20, fontSize: '10px', bgcolor: '#D1FAE5', color: '#065F46', mx: 0.5 }} />
                <Chip label="50-69% Fair" size="small" sx={{ height: 20, fontSize: '10px', bgcolor: '#FEF3C7', color: '#92400E', mx: 0.5 }} />
                <Chip label="&lt;50% Low" size="small" sx={{ height: 20, fontSize: '10px', bgcolor: '#FEE2E2', color: '#991B1B', mx: 0.5 }} />
              </Typography>
              <Typography variant="body2" sx={{ color: '#4B5563', fontWeight: 500 }}>
                Total: {detectedHeaders.reduce((sum, h) => sum + h.dataRowCount, 0)} data rows
              </Typography>
            </Box>
          </Box>
        )}
        
        {/* Tabs Header */}
        <Box sx={{ borderBottom: '1px solid #E5E7EB', bgcolor: '#FFFFFF' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{
              '& .MuiTab-root': { color: '#6B7280', minHeight: 48, textTransform: 'none' },
              '& .Mui-selected': { color: '#1F2937 !important', fontWeight: 600 },
              '& .MuiTabs-indicator': { bgcolor: '#8B5CF6' },
            }}
          >
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TableIcon sx={{ fontSize: 18 }} />
                  Source Data
                  {sourceData.length > 0 && (
                    <Chip label={sourceData.length} size="small" sx={{ height: 18, fontSize: '10px', bgcolor: '#DBEAFE', color: '#1E40AF' }} />
                  )}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SuccessIcon sx={{ fontSize: 18, color: totalSuccessCount > 0 ? '#10B981' : 'inherit' }} />
                  Success
                  {totalSuccessCount > 0 && (
                    <Chip label={totalSuccessCount} size="small" sx={{ height: 18, fontSize: '10px', bgcolor: '#D1FAE5', color: '#065F46' }} />
                  )}
                </Box>
              }
              disabled={totalSuccessCount === 0}
            />
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ErrorIcon sx={{ fontSize: 18, color: totalFailedCount > 0 ? '#DC2626' : 'inherit' }} />
                  Failed
                  {totalFailedCount > 0 && (
                    <Chip label={totalFailedCount} size="small" sx={{ height: 18, fontSize: '10px', bgcolor: '#FEE2E2', color: '#991B1B' }} />
                  )}
                </Box>
              }
              disabled={totalFailedCount === 0}
            />
          </Tabs>
        </Box>
        
        {/* Multi-table selector */}
        {isMultiTableMode && hasTransformedData && activeTab > 0 && (
          <Box sx={{ p: 1.5, bgcolor: '#F5F3FF', borderBottom: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="caption1Bold" sx={{ color: '#6D28D9' }}>
              Viewing:
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {Object.keys(tableResults).map(tableName => (
                <Chip
                  key={tableName}
                  label={tableName}
                  size="small"
                  onClick={() => setSelectedTableView(tableName)}
                  sx={{
                    bgcolor: selectedTableView === tableName ? '#8B5CF6' : '#FFFFFF',
                    color: selectedTableView === tableName ? '#FFFFFF' : '#6D28D9',
                    border: '1px solid #8B5CF6',
                    '&:hover': { bgcolor: selectedTableView === tableName ? '#7C3AED' : '#EDE9FE' },
                  }}
                />
              ))}
            </Box>
          </Box>
        )}
        
        {/* Tab Content */}
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', bgcolor: '#FFFFFF' }}>
          {/* Source Data Tab */}
          {activeTab === 0 && (
            <>
              {sourceData.length === 0 ? (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, bgcolor: '#F9FAFB' }}>
                  <TableIcon sx={{ fontSize: 64, color: '#D1D5DB' }} />
                  <Typography variant="body1" sx={{ color: '#6B7280' }}>
                    Upload a CSV file to preview data
                  </Typography>
                </Box>
              ) : (
                <>
                  {/* Info banner for header rows */}
                  {headerRowCount > 0 && (
                    <Box sx={{ 
                      p: 1.5, 
                      bgcolor: '#FFFBEB', 
                      borderBottom: '1px solid #FDE68A', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 2 
                    }}>
                      <Chip 
                        label={`${headerRowCount} Table Header${headerRowCount > 1 ? 's' : ''}`}
                        size="small"
                        sx={{ bgcolor: '#FEF3C7', color: '#92400E', fontWeight: 600 }}
                      />
                      <Typography variant="caption1" sx={{ color: '#92400E' }}>
                        Rows with "id" in first column indicate table headers (highlighted in yellow)
                      </Typography>
                    </Box>
                  )}
                  <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
                    <Table stickyHeader size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ bgcolor: '#3B82F6', color: '#FFFFFF', fontWeight: 600, width: 60 }}>#</TableCell>
                          <TableCell sx={{ bgcolor: '#3B82F6', color: '#FFFFFF', fontWeight: 600, width: 80 }}>Type</TableCell>
                          {sourceColumns.map((col) => (
                            <TableCell key={col} sx={{ bgcolor: '#3B82F6', color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {col}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sourceData.slice(sourcePage * sourceRowsPerPage, (sourcePage + 1) * sourceRowsPerPage).map((row, idx) => {
                          const isHeader = isHeaderRow(row);
                          const rowNum = sourcePage * sourceRowsPerPage + idx + 1;
                          return (
                            <TableRow 
                              key={idx} 
                              sx={{ 
                                '&:hover': { bgcolor: isHeader ? '#FEF3C7' : '#EFF6FF' }, 
                                bgcolor: isHeader ? '#FFFBEB' : (idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB'),
                                borderLeft: isHeader ? '4px solid #F59E0B' : 'none',
                              }}
                            >
                              <TableCell sx={{ color: isHeader ? '#92400E' : '#6B7280', fontWeight: isHeader ? 600 : 400 }}>
                                {rowNum}
                              </TableCell>
                              <TableCell>
                                {isHeader ? (
                                  <Chip 
                                    label="HEADER" 
                                    size="small" 
                                    sx={{ 
                                      height: 20, 
                                      fontSize: '10px', 
                                      bgcolor: '#F59E0B', 
                                      color: '#FFFFFF',
                                      fontWeight: 700,
                                    }} 
                                  />
                                ) : (
                                  <Typography variant="caption1" sx={{ color: '#9CA3AF' }}>
                                    Data
                                  </Typography>
                                )}
                              </TableCell>
                              {sourceColumns.map((col) => (
                                <TableCell 
                                  key={col} 
                                  sx={{ 
                                    color: isHeader ? '#92400E' : '#1F2937', 
                                    fontWeight: isHeader ? 600 : 400,
                                    maxWidth: 200, 
                                    overflow: 'hidden', 
                                    textOverflow: 'ellipsis', 
                                    whiteSpace: 'nowrap',
                                    bgcolor: isHeader ? '#FEF3C7' : 'inherit',
                                  }}
                                >
                                  {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <TablePagination
                    component="div"
                    count={sourceData.length}
                    page={sourcePage}
                    onPageChange={(_, p) => setSourcePage(p)}
                    rowsPerPage={sourceRowsPerPage}
                    onRowsPerPageChange={(e) => { setSourceRowsPerPage(parseInt(e.target.value, 10)); setSourcePage(0); }}
                    sx={{ color: '#4B5563', borderTop: '1px solid #E5E7EB', bgcolor: '#F9FAFB' }}
                  />
                </>
              )}
            </>
          )}
          
          {/* Success Data Tab */}
          {activeTab === 1 && (
            <>
              <Box sx={{ p: 1.5, bgcolor: '#D1FAE5', borderBottom: '1px solid #A7F3D0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2Bold" sx={{ color: '#065F46' }}>
                  ✓ {currentSuccessData.length} rows passed validation
                  {isMultiTableMode && selectedTableView && ` (${selectedTableView})`}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" startIcon={<CopyIcon />} onClick={handleCopySuccess} sx={{ color: '#059669', '&:hover': { bgcolor: '#A7F3D0' } }}>Copy</Button>
                  <Button size="small" variant="contained" startIcon={<DownloadIcon />} onClick={handleDownloadSuccess} sx={{ bgcolor: '#10B981', '&:hover': { bgcolor: '#059669' }, textTransform: 'none' }}>Download</Button>
                </Box>
              </Box>
              <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: '#10B981', color: '#FFFFFF', fontWeight: 600, width: 60 }}>#</TableCell>
                      {successColumns.map((col) => (
                        <TableCell key={col} sx={{ bgcolor: '#10B981', color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap' }}>{col}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currentSuccessData.slice(successPage * successRowsPerPage, (successPage + 1) * successRowsPerPage).map((row, idx) => (
                      <TableRow key={idx} sx={{ '&:hover': { bgcolor: '#ECFDF5' }, bgcolor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <TableCell sx={{ color: '#059669' }}>{successPage * successRowsPerPage + idx + 1}</TableCell>
                        {successColumns.map((col) => (
                          <TableCell key={col} sx={{ color: '#1F2937', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={currentSuccessData.length}
                page={successPage}
                onPageChange={(_, p) => setSuccessPage(p)}
                rowsPerPage={successRowsPerPage}
                onRowsPerPageChange={(e) => { setSuccessRowsPerPage(parseInt(e.target.value, 10)); setSuccessPage(0); }}
                sx={{ color: '#4B5563', borderTop: '1px solid #E5E7EB', bgcolor: '#ECFDF5' }}
              />
            </>
          )}
          
          {/* Failed Data Tab */}
          {activeTab === 2 && (
            <>
              <Box sx={{ p: 1.5, bgcolor: '#FEE2E2', borderBottom: '1px solid #FECACA', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2Bold" sx={{ color: '#991B1B' }}>
                  ✗ {currentFailedData.length} rows failed validation
                  {isMultiTableMode && selectedTableView && ` (${selectedTableView})`}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" startIcon={<CopyIcon />} onClick={handleCopyFailed} sx={{ color: '#DC2626', '&:hover': { bgcolor: '#FECACA' } }}>Copy</Button>
                  <Button size="small" variant="contained" startIcon={<DownloadIcon />} onClick={handleDownloadFailed} sx={{ bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' }, textTransform: 'none' }}>Download</Button>
                </Box>
              </Box>
              <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: '#DC2626', color: '#FFFFFF', fontWeight: 600, width: 60 }}>Row</TableCell>
                      {failedColumns.map((col) => (
                        <TableCell key={col} sx={{ bgcolor: col === '_error' ? '#B91C1C' : '#DC2626', color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap', minWidth: col === '_error' ? 300 : 'auto' }}>
                          {col === '_error' ? 'Error Details' : col}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currentFailedData.slice(failedPage * failedRowsPerPage, (failedPage + 1) * failedRowsPerPage).map((row, idx) => (
                      <TableRow key={idx} sx={{ '&:hover': { bgcolor: '#FEF2F2' }, bgcolor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <TableCell sx={{ color: '#DC2626' }}>{row['_original_row'] as number || failedPage * failedRowsPerPage + idx + 1}</TableCell>
                        {failedColumns.map((col) => (
                          <TableCell key={col} sx={{ color: col === '_error' ? '#991B1B' : '#1F2937', bgcolor: col === '_error' ? '#FEF2F2' : 'inherit', maxWidth: col === '_error' ? 400 : 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: col === '_error' ? 'normal' : 'nowrap', fontSize: col === '_error' ? '11px' : 'inherit' }}>
                            <Tooltip title={row[col] !== null ? String(row[col]) : ''} arrow>
                              <span>{row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}</span>
                            </Tooltip>
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={currentFailedData.length}
                page={failedPage}
                onPageChange={(_, p) => setFailedPage(p)}
                rowsPerPage={failedRowsPerPage}
                onRowsPerPageChange={(e) => { setFailedRowsPerPage(parseInt(e.target.value, 10)); setFailedPage(0); }}
                sx={{ color: '#4B5563', borderTop: '1px solid #E5E7EB', bgcolor: '#FEF2F2' }}
              />
            </>
          )}
        </Box>
      </Box>
      
      {/* Snackbar */}
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

export default DataTransformerPage;
