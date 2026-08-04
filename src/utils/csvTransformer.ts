import type { ColumnMapping, TableMapping, Column } from '../types';
import type { DataRow, TransformError, TransformStats } from '../features/dataTransformer/dataTransformerSlice';

/**
 * Expected data types for validation
 */
export type ExpectedDataType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'email' | 'uuid' | 'any';

export interface ColumnValidation {
  column: string;
  expectedType: ExpectedDataType;
  required: boolean;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface TransformResult {
  successData: DataRow[];
  failedData: DataRow[];
  errors: TransformError[];
  stats: TransformStats;
}

/**
 * Parse CSV content into data rows
 */
export function parseCSV(content: string): { headers: string[]; rows: DataRow[] } {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  
  // Parse header line
  const headers = parseCSVLine(lines[0]);
  
  // Parse data rows
  const rows: DataRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: DataRow = {};
    
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? null;
    }
    
    rows.push(row);
  }
  
  return { headers, rows };
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Infer expected data type from column name and sample values
 */
export function inferDataType(columnName: string, sampleValues: (string | number | boolean | null)[]): ExpectedDataType {
  const name = columnName.toLowerCase();
  
  // Check by column name patterns
  if (name === 'id' || name.endsWith('_id')) {
    return 'integer';
  }
  if (name.includes('email')) {
    return 'email';
  }
  if (name.includes('date') || name.includes('_at') || name === 'created' || name === 'updated') {
    return 'date';
  }
  if (name.includes('uuid') || name.includes('guid')) {
    return 'uuid';
  }
  if (name.includes('price') || name.includes('amount') || name.includes('total') || name.includes('cost')) {
    return 'number';
  }
  if (name.includes('count') || name.includes('quantity') || name.includes('age') || name.includes('year')) {
    return 'integer';
  }
  if (name.includes('is_') || name.includes('has_') || name === 'active' || name === 'enabled' || name === 'status') {
    return 'boolean';
  }
  
  // Check by sample values
  const nonNullValues = sampleValues.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNullValues.length > 0) {
    const allNumbers = nonNullValues.every(v => !isNaN(Number(v)));
    if (allNumbers) {
      const allIntegers = nonNullValues.every(v => Number.isInteger(Number(v)));
      return allIntegers ? 'integer' : 'number';
    }
  }
  
  return 'string';
}

/**
 * Validate a value against expected data type
 */
export function validateValue(
  value: string | number | boolean | null,
  expectedType: ExpectedDataType,
  columnName: string
): ValidationResult {
  const errors: string[] = [];
  
  // Handle null/empty
  if (value === null || value === undefined || value === '') {
    return { isValid: true, errors: [] }; // Null is valid, required check is separate
  }
  
  const strValue = String(value);
  
  switch (expectedType) {
    case 'integer': {
      const num = Number(strValue);
      if (isNaN(num)) {
        errors.push(`"${columnName}" expected integer but got "${strValue}"`);
      } else if (!Number.isInteger(num)) {
        errors.push(`"${columnName}" expected integer but got decimal "${strValue}"`);
      }
      break;
    }
    
    case 'number': {
      const num = Number(strValue);
      if (isNaN(num)) {
        errors.push(`"${columnName}" expected number but got "${strValue}"`);
      }
      break;
    }
    
    case 'boolean': {
      const lower = strValue.toLowerCase();
      const validBooleans = ['true', 'false', '1', '0', 'yes', 'no', 'y', 'n', 'active', 'inactive'];
      if (!validBooleans.includes(lower)) {
        errors.push(`"${columnName}" expected boolean but got "${strValue}"`);
      }
      break;
    }
    
    case 'date': {
      const date = new Date(strValue);
      if (isNaN(date.getTime())) {
        // Try common date formats
        const datePatterns = [
          /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
          /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
          /^\d{2}-\d{2}-\d{4}$/, // DD-MM-YYYY
          /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
        ];
        const isValidFormat = datePatterns.some(p => p.test(strValue));
        if (!isValidFormat) {
          errors.push(`"${columnName}" expected date but got "${strValue}"`);
        }
      }
      break;
    }
    
    case 'email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(strValue)) {
        errors.push(`"${columnName}" expected email but got "${strValue}"`);
      }
      break;
    }
    
    case 'uuid': {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(strValue)) {
        errors.push(`"${columnName}" expected UUID but got "${strValue}"`);
      }
      break;
    }
    
    case 'string':
    case 'any':
    default:
      // String accepts anything
      break;
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * Generate column validations from target schema columns
 */
export function generateValidations(
  targetColumns: Column[],
  columnMappings: ColumnMapping[]
): Map<string, ColumnValidation> {
  const validations = new Map<string, ColumnValidation>();
  
  for (const mapping of columnMappings) {
    const targetCol = targetColumns.find(c => c.name === mapping.target.column);
    if (targetCol) {
      let expectedType: ExpectedDataType = 'any';
      
      // Map database types to validation types
      const dbType = targetCol.type.toLowerCase();
      if (dbType.includes('int')) {
        expectedType = 'integer';
      } else if (dbType.includes('decimal') || dbType.includes('numeric') || dbType.includes('float') || dbType.includes('double')) {
        expectedType = 'number';
      } else if (dbType.includes('bool')) {
        expectedType = 'boolean';
      } else if (dbType.includes('date') || dbType.includes('time')) {
        expectedType = 'date';
      } else if (dbType.includes('uuid')) {
        expectedType = 'uuid';
      }
      
      validations.set(mapping.target.column, {
        column: mapping.target.column,
        expectedType,
        required: !targetCol.nullable,
      });
    }
  }
  
  return validations;
}

/**
 * Transform data with validation - returns success and failed rows separately
 */
export function transformDataWithValidation(
  sourceData: DataRow[],
  columnMappings: ColumnMapping[],
  sourceTable: string,
  targetColumns?: Column[]
): TransformResult {
  const errors: TransformError[] = [];
  const successData: DataRow[] = [];
  const failedData: DataRow[] = [];
  
  // Generate validations from target columns if available
  const validations = targetColumns 
    ? generateValidations(targetColumns, columnMappings)
    : new Map<string, ColumnValidation>();
  
  // Auto-infer validations from column names if no target columns
  if (!targetColumns && sourceData.length > 0) {
    for (const mapping of columnMappings) {
      if (!validations.has(mapping.target.column)) {
        const sampleValues = sourceData.slice(0, 10).map(row => {
          if (mapping.source) {
            return row[mapping.source.column];
          }
          return null;
        });
        
        const inferredType = inferDataType(mapping.target.column, sampleValues);
        validations.set(mapping.target.column, {
          column: mapping.target.column,
          expectedType: inferredType,
          required: mapping.target.column === 'id' || mapping.target.column.endsWith('_id'),
        });
      }
    }
  }
  
  // Filter mappings for this source table
  // Include: DIRECT mappings for this source table, CONSTANT mappings (default values), and TRANSFORM mappings
  const relevantMappings = columnMappings.filter(cm => {
    // Include CONSTANT mappings (default values) - they apply to all tables
    if (cm.mappingType === 'CONSTANT') {
      return true;
    }
    // Include DIRECT mappings where source table matches
    if (cm.source?.table === sourceTable) {
      return true;
    }
    // Include TRANSFORM mappings where any source column is from this table
    if (cm.sourceColumns?.some(sc => sc.table === sourceTable)) {
      return true;
    }
    return false;
  });
  
  // Get all target column names (from target schema columns if available)
  const allTargetColumnNames: string[] = [];
  if (targetColumns && targetColumns.length > 0) {
    // Use all target schema columns
    allTargetColumnNames.push(...targetColumns.map(c => c.name));
  }
  
  // Also include any mapped columns that might not be in targetColumns
  for (const mapping of relevantMappings) {
    if (!allTargetColumnNames.includes(mapping.target.column)) {
      allTargetColumnNames.push(mapping.target.column);
    }
  }
  
  for (let rowIndex = 0; rowIndex < sourceData.length; rowIndex++) {
    const sourceRow = sourceData[rowIndex];
    const transformedRow: DataRow = {};
    const rowErrors: TransformError[] = [];
    let rowHasError = false;
    
    // Add original row index for reference
    transformedRow['_original_row'] = rowIndex + 1;
    
    // Initialize ALL target columns with null first
    for (const colName of allTargetColumnNames) {
      transformedRow[colName] = null;
    }
    
    // Apply mappings to fill in values
    for (const mapping of relevantMappings) {
      try {
        const value = applyMapping(sourceRow, mapping, rowIndex, rowErrors);
        transformedRow[mapping.target.column] = value;
        
        // Validate the transformed value
        const validation = validations.get(mapping.target.column);
        if (validation) {
          // Check required
          if (validation.required && (value === null || value === undefined || value === '')) {
            rowErrors.push({
              rowIndex,
              column: mapping.target.column,
              message: `Required column "${mapping.target.column}" is empty`,
              severity: 'error',
            });
            rowHasError = true;
          }
          
          // Check data type
          const typeValidation = validateValue(value, validation.expectedType, mapping.target.column);
          if (!typeValidation.isValid) {
            for (const errMsg of typeValidation.errors) {
              rowErrors.push({
                rowIndex,
                column: mapping.target.column,
                message: errMsg,
                severity: 'error',
              });
              rowHasError = true;
            }
          }
        }
      } catch (error) {
        rowErrors.push({
          rowIndex,
          column: mapping.target.column,
          message: error instanceof Error ? error.message : 'Unknown error',
          severity: 'error',
        });
        transformedRow[mapping.target.column] = null;
        rowHasError = true;
      }
    }
    
    // Add error message to failed rows
    if (rowHasError) {
      transformedRow['_error'] = rowErrors.map(e => e.message).join('; ');
      failedData.push(transformedRow);
    } else {
      // Remove internal fields from success data
      delete transformedRow['_original_row'];
      successData.push(transformedRow);
    }
    
    errors.push(...rowErrors);
  }
  
  const stats: TransformStats = {
    totalRows: sourceData.length,
    successRows: successData.length,
    errorRows: failedData.length,
    warningRows: errors.filter(e => e.severity === 'warning').length,
    columnsTransformed: relevantMappings.length,
  };
  
  return { successData, failedData, errors, stats };
}

/**
 * Transform data according to column mappings (legacy - returns combined data)
 */
export function transformData(
  sourceData: DataRow[],
  columnMappings: ColumnMapping[],
  sourceTable: string
): { data: DataRow[]; errors: TransformError[]; stats: TransformStats } {
  const result = transformDataWithValidation(sourceData, columnMappings, sourceTable);
  
  // Combine success and failed data for backward compatibility
  const allData = [...result.successData, ...result.failedData];
  
  return {
    data: allData,
    errors: result.errors,
    stats: result.stats,
  };
}

/**
 * Apply a single column mapping to get the transformed value
 */
function applyMapping(
  row: DataRow,
  mapping: ColumnMapping,
  _rowIndex: number,
  _errors: TransformError[]
): string | number | boolean | null {
  switch (mapping.mappingType) {
    case 'DIRECT': {
      if (!mapping.source) return null;
      const value = row[mapping.source.column];
      return value ?? null;
    }
    
    case 'CONSTANT': {
      return mapping.constantValue ?? null;
    }
    
    case 'TRANSFORM': {
      if (!mapping.sourceColumns || mapping.sourceColumns.length === 0) {
        // Fallback to source column if sourceColumns not provided
        if (mapping.source) {
          const value = row[mapping.source.column];
          if (value === null || value === undefined) return null;
          return applyTransformation(String(value), mapping.transformation?.type || '');
        }
        return null;
      }
      
      // Handle CONCAT transformation type
      if (mapping.transformation?.type === 'CONCAT') {
        const values = mapping.sourceColumns.map(sc => {
          const val = row[sc.column];
          return val !== null && val !== undefined ? String(val) : '';
        });
        const separator = (mapping.transformation.params?.separator as string) || ' ';
        return values.join(separator);
      }
      
      // Regular transformation
      const sourceCol = mapping.sourceColumns[0];
      const value = row[sourceCol.column];
      
      if (value === null || value === undefined) return null;
      
      return applyTransformation(String(value), mapping.transformation?.type || '');
    }
    
    default:
      return null;
  }
}

/**
 * Apply transformation function to a value
 */
function applyTransformation(value: string, transformType: string): string {
  switch (transformType) {
    case 'UPPER':
      return value.toUpperCase();
    case 'LOWER':
      return value.toLowerCase();
    case 'TRIM':
      return value.trim();
    case 'DATE_FORMAT':
      try {
        const date = new Date(value);
        return date.toISOString().split('T')[0];
      } catch {
        return value;
      }
    case 'TIMESTAMP_TO_DATE':
      try {
        const ts = parseInt(value, 10);
        const date = new Date(ts);
        return date.toISOString();
      } catch {
        return value;
      }
    case 'COALESCE':
      return value || '';
    case 'NULLIF_EMPTY':
      return value.trim() === '' ? '' : value;
    default:
      return value;
  }
}

/**
 * Convert data rows to CSV string
 */
export function dataToCSV(data: DataRow[], excludeColumns?: string[]): string {
  if (data.length === 0) return '';
  
  // Get all unique headers (excluding internal columns)
  const headers = new Set<string>();
  for (const row of data) {
    Object.keys(row).forEach(key => {
      if (!excludeColumns?.includes(key)) {
        headers.add(key);
      }
    });
  }
  const headerArray = Array.from(headers);
  
  // Create CSV lines
  const lines: string[] = [];
  
  // Header line
  lines.push(headerArray.map(h => escapeCSVValue(h)).join(','));
  
  // Data lines
  for (const row of data) {
    const values = headerArray.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      return escapeCSVValue(String(value));
    });
    lines.push(values.join(','));
  }
  
  return lines.join('\n');
}

/**
 * Escape a value for CSV format
 */
function escapeCSVValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate sample data for preview
 */
export function generateSampleData(
  columnMappings: ColumnMapping[],
  sourceTable: string,
  rowCount: number = 5
): DataRow[] {
  const sampleData: DataRow[] = [];
  
  // Get source columns
  const sourceColumns = new Set<string>();
  for (const mapping of columnMappings) {
    if (mapping.source?.table === sourceTable) {
      sourceColumns.add(mapping.source.column);
    }
    if (mapping.sourceColumns) {
      for (const sc of mapping.sourceColumns) {
        if (sc.table === sourceTable) {
          sourceColumns.add(sc.column);
        }
      }
    }
  }
  
  // Generate sample rows
  for (let i = 0; i < rowCount; i++) {
    const row: DataRow = {};
    Array.from(sourceColumns).forEach((col) => {
      if (col === 'id') {
        row[col] = i + 1;
      } else if (col.endsWith('_id')) {
        row[col] = Math.floor(Math.random() * 100) + 1;
      } else if (col.includes('name')) {
        row[col] = `Sample Name ${i + 1}`;
      } else if (col.includes('email')) {
        row[col] = `sample${i + 1}@example.com`;
      } else if (col.includes('date') || col.includes('_at')) {
        row[col] = new Date().toISOString().split('T')[0];
      } else if (col.includes('status')) {
        row[col] = ['active', 'inactive', 'pending'][i % 3];
      } else {
        row[col] = `Value ${i + 1}`;
      }
    });
    sampleData.push(row);
  }
  
  return sampleData;
}

/**
 * Helper to get source tables from a mapping (handles both array and string formats)
 */
function getSourceTablesFromMapping(mapping: TableMapping): string[] {
  // Handle both sourceTable (string) and sourceTables (array) formats
  const mappingAny = mapping as TableMapping & { sourceTable?: string };
  if (mappingAny.sourceTable) {
    return [mappingAny.sourceTable];
  }
  return mapping.sourceTables || [];
}

/**
 * Helper to get target tables from a mapping (handles both array and string formats)
 */
function getTargetTablesFromMapping(mapping: TableMapping): string[] {
  // Handle both targetTable (string) and targetTables (array) formats
  const mappingAny = mapping as TableMapping & { targetTable?: string };
  if (mappingAny.targetTable) {
    return [mappingAny.targetTable];
  }
  return mapping.targetTables || [];
}

/**
 * Find matching table mapping for a source table
 */
export function findTableMapping(
  tableMappings: TableMapping[],
  sourceTable: string
): TableMapping | undefined {
  return tableMappings.find(tm => getSourceTablesFromMapping(tm).includes(sourceTable));
}

/**
 * Get available source tables from mappings
 */
export function getSourceTables(tableMappings: TableMapping[]): string[] {
  const tables = new Set<string>();
  for (const mapping of tableMappings) {
    getSourceTablesFromMapping(mapping).forEach(t => tables.add(t));
  }
  return Array.from(tables).sort();
}

/**
 * Get target tables for a source table
 */
export function getTargetTables(tableMappings: TableMapping[], sourceTable: string): string[] {
  const mapping = tableMappings.find(tm => getSourceTablesFromMapping(tm).includes(sourceTable));
  return mapping ? getTargetTablesFromMapping(mapping) : [];
}

// ============================================
// Multi-Table CSV Support
// ============================================

/**
 * Common column names that indicate table name in CSV
 */
const TABLE_COLUMN_NAMES = ['_table', 'table_name', 'table', 'entity', 'type', '_type', 'record_type'];

/**
 * Detect if CSV has a table identifier column
 */
export function detectTableColumn(headers: string[]): string | null {
  const lowerHeaders = headers.map(h => h.toLowerCase());
  for (const colName of TABLE_COLUMN_NAMES) {
    const idx = lowerHeaders.indexOf(colName);
    if (idx !== -1) {
      return headers[idx];
    }
  }
  return null;
}

// ============================================
// Multi-Table CSV with "id" Header Detection
// ============================================

export interface ParsedMultiTableCSV {
  tables: Record<string, {
    headers: string[];
    rows: DataRow[];
    matchedTableName: string | null;
    confidence: number;
  }>;
  tableNames: string[];
  isMultiTable: boolean;
}

/**
 * Check if a row is a header row (starts with "id" in first column)
 */
function isHeaderRow(values: string[]): boolean {
  if (values.length === 0) return false;
  const firstVal = values[0]?.toLowerCase().trim();
  return firstVal === 'id';
}

/**
 * Match columns to a table in the schema
 */
function matchColumnsToTable(
  headers: string[],
  schemaTables: Array<{ name: string; columns: Array<{ name: string }> }>
): { tableName: string | null; confidence: number } {
  if (!schemaTables || schemaTables.length === 0) {
    return { tableName: null, confidence: 0 };
  }
  
  let bestMatch: { tableName: string | null; confidence: number } = { tableName: null, confidence: 0 };
  const headerSet = new Set(headers.map(h => h.toLowerCase().trim()));
  
  for (const table of schemaTables) {
    const tableColumns = table.columns.map(c => c.name.toLowerCase().trim());
    const tableColumnSet = new Set(tableColumns);
    
    // Count matching columns
    let matchCount = 0;
    for (const header of headerSet) {
      if (tableColumnSet.has(header)) {
        matchCount++;
      }
    }
    
    // Calculate confidence based on how many headers match table columns
    const confidence = headers.length > 0 ? matchCount / headers.length : 0;
    
    // Also check if header count is similar (penalize very different column counts)
    const sizeSimilarity = Math.min(headers.length, tableColumns.length) / Math.max(headers.length, tableColumns.length);
    const adjustedConfidence = confidence * 0.7 + sizeSimilarity * 0.3;
    
    if (adjustedConfidence > bestMatch.confidence) {
      bestMatch = { tableName: table.name, confidence: adjustedConfidence };
    }
  }
  
  return bestMatch;
}

/**
 * Parse CSV with multiple tables where each table starts with a header row beginning with "id"
 */
export function parseMultiTableCSV(
  content: string,
  schemaTables?: Array<{ name: string; columns: Array<{ name: string }> }>
): ParsedMultiTableCSV {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length === 0) {
    return { tables: {}, tableNames: [], isMultiTable: false };
  }
  
  const tables: ParsedMultiTableCSV['tables'] = {};
  let currentHeaders: string[] = [];
  let currentRows: DataRow[] = [];
  let tableIndex = 0;
  let foundMultipleTables = false;
  
  for (let i = 0; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    
    if (isHeaderRow(values)) {
      // Save previous table if exists
      if (currentHeaders.length > 0 && currentRows.length > 0) {
        const match = matchColumnsToTable(currentHeaders, schemaTables || []);
        const tableName = match.tableName || `table_${tableIndex}`;
        
        tables[tableName] = {
          headers: currentHeaders,
          rows: currentRows,
          matchedTableName: match.tableName,
          confidence: match.confidence,
        };
        tableIndex++;
        foundMultipleTables = true;
      }
      
      // Start new table with this header row
      currentHeaders = values;
      currentRows = [];
    } else if (currentHeaders.length > 0) {
      // This is a data row for current table
      const row: DataRow = {};
      for (let j = 0; j < currentHeaders.length; j++) {
        row[currentHeaders[j]] = values[j] ?? null;
      }
      currentRows.push(row);
    } else {
      // First row is not a header, treat as single table CSV
      currentHeaders = values;
    }
  }
  
  // Save last table
  if (currentHeaders.length > 0 && currentRows.length > 0) {
    const match = matchColumnsToTable(currentHeaders, schemaTables || []);
    const tableName = match.tableName || `table_${tableIndex}`;
    
    tables[tableName] = {
      headers: currentHeaders,
      rows: currentRows,
      matchedTableName: match.tableName,
      confidence: match.confidence,
    };
  }
  
  const tableNames = Object.keys(tables);
  
  return {
    tables,
    tableNames,
    isMultiTable: foundMultipleTables || tableNames.length > 1,
  };
}

/**
 * Detect if CSV content has multiple tables (separated by "id" header rows)
 */
export function isMultiTableIdFormat(content: string): boolean {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  let idRowCount = 0;
  
  for (const line of lines) {
    const values = parseCSVLine(line);
    if (isHeaderRow(values)) {
      idRowCount++;
      if (idRowCount > 1) return true;
    }
  }
  
  return false;
}

/**
 * Get all rows from multi-table parsed CSV with table identifier
 */
export function flattenMultiTableCSV(parsed: ParsedMultiTableCSV): { 
  rows: DataRow[]; 
  tableColumn: string;
} {
  const rows: DataRow[] = [];
  const tableColumn = '_table';
  
  for (const [tableName, tableData] of Object.entries(parsed.tables)) {
    for (const row of tableData.rows) {
      rows.push({
        [tableColumn]: tableName,
        ...row,
      });
    }
  }
  
  return { rows, tableColumn };
}

/**
 * Detect tables from CSV data
 */
export function detectTablesInCSV(data: DataRow[], tableColumn?: string): string[] {
  if (data.length === 0) return [];
  
  // If table column specified, use it
  if (tableColumn && data[0][tableColumn] !== undefined) {
    const tables = new Set<string>();
    for (const row of data) {
      const tableName = row[tableColumn];
      if (tableName !== null && tableName !== undefined && tableName !== '') {
        tables.add(String(tableName));
      }
    }
    return Array.from(tables).sort();
  }
  
  // Auto-detect table column
  const headers = Object.keys(data[0]);
  const detectedCol = detectTableColumn(headers);
  
  if (detectedCol) {
    const tables = new Set<string>();
    for (const row of data) {
      const tableName = row[detectedCol];
      if (tableName !== null && tableName !== undefined && tableName !== '') {
        tables.add(String(tableName));
      }
    }
    return Array.from(tables).sort();
  }
  
  return [];
}

/**
 * Split CSV data by table
 */
export function splitDataByTable(
  data: DataRow[],
  tableColumn: string
): Record<string, DataRow[]> {
  const result: Record<string, DataRow[]> = {};
  
  for (const row of data) {
    const tableName = row[tableColumn];
    if (tableName !== null && tableName !== undefined && tableName !== '') {
      const name = String(tableName);
      if (!result[name]) {
        result[name] = [];
      }
      // Remove the table column from the data row
      const { [tableColumn]: _, ...rowWithoutTable } = row;
      result[name].push(rowWithoutTable);
    }
  }
  
  return result;
}

/**
 * Multi-table transform result
 */
export interface MultiTableTransformResult {
  tableResults: Record<string, {
    sourceTable: string;
    targetTable: string;
    sourceData: DataRow[];
    successData: DataRow[];
    failedData: DataRow[];
    errors: TransformError[];
    stats: TransformStats;
  }>;
  totalStats: {
    totalRows: number;
    totalTables: number;
    totalSuccessRows: number;
    totalFailedRows: number;
    perTable: Record<string, TransformStats>;
  };
  allErrors: TransformError[];
}

/**
 * Target schema table interface for multi-table transformation
 */
interface TargetSchemaTable {
  name: string;
  columns: Column[];
}

/**
 * Transform multi-table CSV data
 */
export function transformMultiTableData(
  data: DataRow[],
  tableColumn: string,
  columnMappings: ColumnMapping[],
  tableMappings: TableMapping[],
  _allTargetColumns?: Column[], // Deprecated, use targetSchemaTables instead
  targetSchemaTables?: TargetSchemaTable[]
): MultiTableTransformResult {
  // Split data by table
  const tableData = splitDataByTable(data, tableColumn);
  const tableNames = Object.keys(tableData);
  
  const tableResults: MultiTableTransformResult['tableResults'] = {};
  const perTableStats: Record<string, TransformStats> = {};
  const allErrors: TransformError[] = [];
  
  let totalSuccessRows = 0;
  let totalFailedRows = 0;
  
  for (const sourceTable of tableNames) {
    const rows = tableData[sourceTable];
    
    // Find target table name
    const targets = getTargetTables(tableMappings, sourceTable);
    const targetTableName = targets[0] || sourceTable;
    
    // Find table mapping to get all column mappings
    const tableMapping = findTableMapping(tableMappings, sourceTable);
    
    // Get ALL column mappings for this table (including CONSTANT/default values)
    const tableLevelMappings = tableMapping?.columnMappings || [];
    
    // Combine with global columnMappings
    const allMappingsForTable = [...columnMappings, ...tableLevelMappings];
    
    // Get target columns specifically for THIS target table from schema
    const targetSchemaTable = targetSchemaTables?.find(t => t.name === targetTableName);
    let targetColumnsForTable: Column[] = [];
    
    if (targetSchemaTable) {
      // Use the specific target table's columns from schema
      targetColumnsForTable = [...targetSchemaTable.columns];
    } else {
      // Fallback: build columns from mappings
      const targetColumnNames = new Set<string>();
      
      // Add all columns from table-level mappings
      tableLevelMappings.forEach(cm => {
        targetColumnNames.add(cm.target.column);
      });
      
      // Add columns from global mappings for this source table
      columnMappings.forEach(cm => {
        if (cm.source?.table === sourceTable || 
            cm.sourceColumns?.some(sc => sc.table === sourceTable) ||
            cm.mappingType === 'CONSTANT') {
          targetColumnNames.add(cm.target.column);
        }
      });
      
      // Convert to Column array
      targetColumnsForTable = Array.from(targetColumnNames).map(name => ({
        name, 
        type: 'string', 
        nullable: true
      }));
    }
    
    // Transform this table's data
    const result = transformDataWithValidation(
      rows,
      allMappingsForTable,
      sourceTable,
      targetColumnsForTable
    );
    
    // Add table name to errors
    const errorsWithTable = result.errors.map(e => ({
      ...e,
      tableName: sourceTable,
    }));
    
    tableResults[sourceTable] = {
      sourceTable,
      targetTable: targetTableName,
      sourceData: rows,
      successData: result.successData,
      failedData: result.failedData,
      errors: errorsWithTable,
      stats: result.stats,
    };
    
    perTableStats[sourceTable] = result.stats;
    allErrors.push(...errorsWithTable);
    totalSuccessRows += result.successData.length;
    totalFailedRows += result.failedData.length;
  }
  
  return {
    tableResults,
    totalStats: {
      totalRows: data.length,
      totalTables: tableNames.length,
      totalSuccessRows,
      totalFailedRows,
      perTable: perTableStats,
    },
    allErrors,
  };
}

/**
 * Export multi-table data to separate CSVs (as a zip-friendly structure)
 */
export function multiTableToCSVs(
  tableResults: MultiTableTransformResult['tableResults'],
  type: 'success' | 'failed' | 'both'
): Record<string, string> {
  const csvs: Record<string, string> = {};
  
  for (const [tableName, result] of Object.entries(tableResults)) {
    if (type === 'success' || type === 'both') {
      if (result.successData.length > 0) {
        csvs[`${tableName}_success.csv`] = dataToCSV(result.successData, ['_original_row', '_error']);
      }
    }
    if (type === 'failed' || type === 'both') {
      if (result.failedData.length > 0) {
        csvs[`${tableName}_failed.csv`] = dataToCSV(result.failedData, ['_original_row']);
      }
    }
  }
  
  return csvs;
}

/**
 * Combine all success/failed data with table name column
 */
export function combineMultiTableData(
  tableResults: MultiTableTransformResult['tableResults'],
  type: 'success' | 'failed'
): DataRow[] {
  const combined: DataRow[] = [];
  
  for (const [tableName, result] of Object.entries(tableResults)) {
    const data = type === 'success' ? result.successData : result.failedData;
    for (const row of data) {
      combined.push({
        _table: tableName,
        ...row,
      });
    }
  }
  
  return combined;
}
