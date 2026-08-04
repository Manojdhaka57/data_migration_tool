import type { SQLTable, SQLColumn, SQLForeignKey, SQLIndex } from '../features/sqlAnalyzer/sqlAnalyzerSlice';

/**
 * Detect if content is from pg_dump format (extracted strings from binary dump)
 */
function isPgDumpFormat(content: string): boolean {
  // Check for pg_dump specific markers
  const pgDumpMarkers = [
    /^PGDMP/m,                           // Magic header
    /^PostgreSQL database dump/mi,       // Header comment
    /^DROP TABLE public\./m,             // pg_dump specific pattern
    /^TABLE\s+\w+\s*$/m,                 // Metadata line pattern
    /\nheap\n/,                          // Storage type marker
    /\npostgres\n.*\nfalse\n/,           // Owner/boolean markers
  ];
  
  // If content has multiple pg_dump markers, it's likely pg_dump format
  const markerCount = pgDumpMarkers.filter(marker => marker.test(content)).length;
  return markerCount >= 2;
}

/**
 * Parse SQL file content and extract CREATE TABLE statements
 * Supports MySQL, PostgreSQL, SQLite, and pg_dump extracted content
 * Automatically detects pg_dump format and uses appropriate parser
 */
export function parseSQL(sql: string): SQLTable[] {
  // Check if this looks like pg_dump extracted content
  if (isPgDumpFormat(sql)) {
    const pgTables = parsePgDump(sql);
    if (pgTables.length > 0) {
      return pgTables;
    }
  }
  
  // Standard SQL parsing
  const tables: SQLTable[] = [];
  
  // Normalize SQL - remove comments and extra whitespace
  const cleanSQL = removeComments(sql);
  
  // Find all CREATE TABLE statements
  // Supports: CREATE TABLE name, CREATE TABLE schema.name, CREATE TABLE "name", CREATE TABLE `name`
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w]+\.)?[`"']?(\w+)[`"']?\s*\(([\s\S]*?)\)(?:\s*(?:ENGINE|TABLESPACE|WITH|INHERITS|;|$))/gi;
  
  let match;
  while ((match = createTableRegex.exec(cleanSQL)) !== null) {
    const tableName = match[1];
    const tableBody = match[2];
    const rawSQL = match[0];
    
    const table = parseTableDefinition(tableName, tableBody, rawSQL);
    tables.push(table);
  }
  
  // If standard parsing found nothing, try pg_dump parser as fallback
  if (tables.length === 0) {
    const pgTables = parsePgDump(sql);
    if (pgTables.length > 0) {
      return pgTables;
    }
  }
  
  return tables;
}

/**
 * Parse PostgreSQL pg_dump binary content (extracted via strings command)
 * This handles the specific format of pg_dump -Fc extracted content
 */
export function parsePgDump(content: string): SQLTable[] {
  const tables: SQLTable[] = [];
  const lines = content.split('\n');
  
  let inTable = false;
  let currentTableName = '';
  let currentTableLines: string[] = [];
  let parenDepth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Detect start of CREATE TABLE
    const createMatch = trimmed.match(/^CREATE\s+TABLE\s+(?:[\w]+\.)?[`"']?(\w+)[`"']?\s*\(/i);
    if (createMatch && !inTable) {
      inTable = true;
      currentTableName = createMatch[1];
      currentTableLines = [];
      parenDepth = 1; // We're inside the opening (
      
      // Check if there's content after the ( on the same line
      const afterParen = trimmed.substring(trimmed.indexOf('(') + 1).trim();
      if (afterParen) {
        currentTableLines.push(afterParen);
        parenDepth += (afterParen.match(/\(/g) || []).length;
        parenDepth -= (afterParen.match(/\)/g) || []).length;
      }
      continue;
    }
    
    if (inTable) {
      // Check for end markers (metadata that follows table definition in pg_dump)
      if (/^(DROP\s+TABLE|public$|heap$|postgres$|false$|true$|TABLE\s+\w+$|\d+$|GRANT\s+)/i.test(trimmed)) {
        // End of table definition
        if (currentTableLines.length > 0) {
          const tableBody = currentTableLines.join('\n');
          const rawSQL = `CREATE TABLE ${currentTableName} (\n${tableBody}\n);`;
          const table = parseTableDefinition(currentTableName, tableBody, rawSQL);
          if (table.columns.length > 0) {
            tables.push(table);
          }
        }
        inTable = false;
        currentTableName = '';
        currentTableLines = [];
        parenDepth = 0;
        continue;
      }
      
      // Track parentheses depth
      parenDepth += (trimmed.match(/\(/g) || []).length;
      parenDepth -= (trimmed.match(/\)/g) || []).length;
      
      // Add line to current table (if it's valid SQL content)
      if (trimmed && !isMetadataLine(trimmed)) {
        currentTableLines.push(line);
      }
      
      // If we've closed all parens, table definition is complete
      if (parenDepth <= 0) {
        if (currentTableLines.length > 0) {
          // Remove trailing ) from last line if present
          const lastLine = currentTableLines[currentTableLines.length - 1];
          if (lastLine.trim().endsWith(')')) {
            currentTableLines[currentTableLines.length - 1] = lastLine.replace(/\)\s*$/, '');
          }
          
          const tableBody = currentTableLines.join('\n');
          const rawSQL = `CREATE TABLE ${currentTableName} (\n${tableBody}\n);`;
          const table = parseTableDefinition(currentTableName, tableBody, rawSQL);
          if (table.columns.length > 0) {
            tables.push(table);
          }
        }
        inTable = false;
        currentTableName = '';
        currentTableLines = [];
        parenDepth = 0;
      }
    }
  }
  
  return tables;
}

/**
 * Check if a line is PostgreSQL dump metadata (not SQL)
 */
function isMetadataLine(line: string): boolean {
  const metadataPatterns = [
    /^(public|postgres|heap|false|true)$/i,
    /^\d+$/,
    /^TABLE\s+\w+$/i,
    /^SEQUENCE\s+\w+$/i,
    /^SCHEMA\s+\w+$/i,
  ];
  return metadataPatterns.some(pattern => pattern.test(line.trim()));
}

/**
 * Remove SQL comments
 */
function removeComments(sql: string): string {
  // Remove single-line comments (-- and #)
  let result = sql.replace(/--.*$/gm, '');
  result = result.replace(/#.*$/gm, '');
  
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  
  return result;
}

/**
 * Parse table definition body
 */
function parseTableDefinition(tableName: string, body: string, rawSQL: string): SQLTable {
  const columns: SQLColumn[] = [];
  const foreignKeys: SQLForeignKey[] = [];
  const indexes: SQLIndex[] = [];
  let primaryKey: string[] = [];
  
  // Split by comma, but be careful with commas inside parentheses
  const lines = splitTableBody(body);
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    // Check for PRIMARY KEY constraint
    if (/^\s*PRIMARY\s+KEY/i.test(trimmedLine)) {
      const pkMatch = trimmedLine.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) {
        primaryKey = pkMatch[1].split(',').map(col => 
          col.trim().replace(/[`"']/g, '')
        );
      }
      continue;
    }
    
    // Check for FOREIGN KEY constraint
    if (/^\s*(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY/i.test(trimmedLine)) {
      const fk = parseForeignKey(trimmedLine);
      if (fk) foreignKeys.push(fk);
      continue;
    }
    
    // Check for INDEX/KEY
    if (/^\s*(?:UNIQUE\s+)?(?:INDEX|KEY)\s+/i.test(trimmedLine)) {
      const idx = parseIndex(trimmedLine);
      if (idx) indexes.push(idx);
      continue;
    }
    
    // Check for UNIQUE constraint
    if (/^\s*(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(/i.test(trimmedLine)) {
      const idx = parseUniqueConstraint(trimmedLine);
      if (idx) indexes.push(idx);
      continue;
    }
    
    // Skip other constraints
    if (/^\s*(?:CONSTRAINT|CHECK|UNIQUE|INDEX|KEY)\s+/i.test(trimmedLine)) {
      continue;
    }
    
    // Parse column definition
    const column = parseColumn(trimmedLine);
    if (column) {
      columns.push(column);
      if (column.isPrimaryKey) {
        primaryKey.push(column.name);
      }
    }
  }
  
  // Link foreign key info to columns (from FOREIGN KEY constraints)
  // This supplements any inline REFERENCES already parsed
  for (const fk of foreignKeys) {
    const column = columns.find(c => c.name === fk.columnName);
    if (column && !column.isForeignKey) {
      column.isForeignKey = true;
      column.foreignKeyRef = {
        table: fk.referencesTable,
        column: fk.referencesColumn,
      };
    }
  }
  
  // Also mark columns from primaryKey array as isPrimaryKey
  for (const pkCol of primaryKey) {
    const column = columns.find(c => c.name === pkCol);
    if (column) {
      column.isPrimaryKey = true;
    }
  }
  
  // INFER: If no primary key found, assume 'id' column is the primary key
  if (primaryKey.length === 0) {
    const idColumn = columns.find(c => c.name.toLowerCase() === 'id');
    if (idColumn) {
      idColumn.isPrimaryKey = true;
      primaryKey.push(idColumn.name);
    }
  }
  
  // INFER: Mark columns ending with '_id' or 'Id' as foreign keys
  for (const column of columns) {
    if (column.isForeignKey) continue; // Already marked
    
    const colName = column.name.toLowerCase();
    if (colName !== 'id' && (colName.endsWith('_id') || column.name.endsWith('Id'))) {
      column.isForeignKey = true;
      
      // Infer referenced table name
      let refTableName = '';
      if (colName.endsWith('_id')) {
        refTableName = colName.slice(0, -3); // Remove "_id"
      } else if (column.name.endsWith('Id')) {
        refTableName = column.name.slice(0, -2).toLowerCase(); // camelCase
      }
      
      column.foreignKeyRef = {
        table: refTableName || 'unknown',
        column: 'id',
      };
      
      // Also add to foreignKeys array for stats counting
      foreignKeys.push({
        columnName: column.name,
        referencesTable: refTableName || 'unknown',
        referencesColumn: 'id',
      });
    }
  }
  
  return {
    name: tableName,
    columns,
    primaryKey,
    foreignKeys,
    indexes,
    rawSQL,
  };
}

/**
 * Split table body by commas, respecting parentheses
 */
function splitTableBody(body: string): string[] {
  const lines: string[] = [];
  let current = '';
  let depth = 0;
  
  for (const char of body) {
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      lines.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    lines.push(current.trim());
  }
  
  return lines;
}

/**
 * Parse column definition
 * Supports MySQL, PostgreSQL, and SQLite column syntax
 */
function parseColumn(line: string): SQLColumn | null {
  // Match column name - handles quoted and unquoted names
  const nameMatch = line.match(/^[`"']?(\w+)[`"']?\s+/i);
  if (!nameMatch) return null;
  
  const name = nameMatch[1];
  
  // Extract the rest of the line after column name
  const restOfLine = line.substring(nameMatch[0].length).trim();
  
  // Extract type - match type with optional size/precision (e.g., VARCHAR(255), NUMERIC(10,2))
  // Handle compound types like "character varying(255)" or "double precision"
  // We need to find where the type ends, accounting for parentheses in type definitions
  let typeEndIndex = restOfLine.length;
  let parenDepth = 0;
  let inType = true;
  
  // Find where the type ends (before first constraint keyword)
  const constraintKeywords = ['NOT NULL', 'NULL', 'DEFAULT', 'PRIMARY KEY', 'UNIQUE', 'CHECK', 'REFERENCES', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'IDENTITY'];
  
  for (let i = 0; i < restOfLine.length; i++) {
    const char = restOfLine[i];
    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (parenDepth === 0 && inType) {
      // Check if we've hit a constraint keyword
      const remaining = restOfLine.substring(i).toUpperCase();
      for (const keyword of constraintKeywords) {
        if (remaining.startsWith(keyword)) {
          typeEndIndex = i;
          inType = false;
          break;
        }
      }
      if (!inType) break;
    }
  }
  
  let type = restOfLine.substring(0, typeEndIndex).trim();
  
  // Strip out any constraints that might have been included in the type
  // Remove NOT NULL, NULL, DEFAULT, PRIMARY KEY, UNIQUE, CHECK, etc. from type string
  type = type
    .replace(/\s+NOT\s+NULL/gi, '')
    .replace(/\s+NULL/gi, '')
    .replace(/\s+DEFAULT\s+[^\s,)]+/gi, '')
    .replace(/\s+PRIMARY\s+KEY/gi, '')
    .replace(/\s+UNIQUE/gi, '')
    .replace(/\s+CHECK\s+\([^)]+\)/gi, '')
    .trim();
  
  // Normalize PostgreSQL types
  type = type
    .replace(/CHARACTER\s+VARYING/gi, 'VARCHAR')
    .replace(/TIMESTAMP\s+WITH(?:OUT)?\s+TIME\s+ZONE/gi, 'TIMESTAMP')
    .replace(/TIME\s+WITH(?:OUT)?\s+TIME\s+ZONE/gi, 'TIME')
    .replace(/DOUBLE\s+PRECISION/gi, 'DOUBLE PRECISION')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  
  // Check for various attributes in the full line (not just type)
  const upperLine = line.toUpperCase();
  const nullable = !upperLine.includes('NOT NULL');
  const isPrimaryKey = upperLine.includes('PRIMARY KEY');
  const isUnique = upperLine.includes('UNIQUE') && !upperLine.includes('UNIQUE INDEX');
  const autoIncrement = upperLine.includes('AUTO_INCREMENT') || 
                        upperLine.includes('AUTOINCREMENT') ||
                        type.includes('SERIAL') ||
                        upperLine.includes('IDENTITY');
  
  // Extract default value
  let defaultValue: string | undefined;
  const defaultMatch = line.match(/DEFAULT\s+([^\s,)]+|'[^']*'|"[^"]*"|\([^)]+\))/i);
  if (defaultMatch) {
    defaultValue = defaultMatch[1].replace(/^['"]|['"]$/g, '');
  }
  
  // Check for inline REFERENCES (foreign key in column definition)
  let isForeignKey = false;
  let foreignKeyRef: { table: string; column: string } | undefined;
  const refMatch = line.match(/REFERENCES\s+[`"']?(\w+)[`"']?\s*(?:\([`"']?(\w+)[`"']?\))?/i);
  if (refMatch) {
    isForeignKey = true;
    foreignKeyRef = {
      table: refMatch[1],
      column: refMatch[2] || 'id', // Default to 'id' if column not specified
    };
  }
  
  return {
    name,
    type,
    nullable,
    defaultValue,
    isPrimaryKey,
    isUnique,
    autoIncrement,
    isForeignKey,
    foreignKeyRef,
  };
}

/**
 * Parse FOREIGN KEY constraint
 */
function parseForeignKey(line: string): SQLForeignKey | null {
  const fkMatch = line.match(
    /FOREIGN\s+KEY\s*\(\s*[`"']?(\w+)[`"']?\s*\)\s*REFERENCES\s+[`"']?(\w+)[`"']?\s*\(\s*[`"']?(\w+)[`"']?\s*\)/i
  );
  
  if (!fkMatch) return null;
  
  const fk: SQLForeignKey = {
    columnName: fkMatch[1],
    referencesTable: fkMatch[2],
    referencesColumn: fkMatch[3],
  };
  
  // Check for ON DELETE
  const onDeleteMatch = line.match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i);
  if (onDeleteMatch) {
    fk.onDelete = onDeleteMatch[1].toUpperCase();
  }
  
  // Check for ON UPDATE
  const onUpdateMatch = line.match(/ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i);
  if (onUpdateMatch) {
    fk.onUpdate = onUpdateMatch[1].toUpperCase();
  }
  
  return fk;
}

/**
 * Parse INDEX/KEY definition
 */
function parseIndex(line: string): SQLIndex | null {
  const isUnique = /^\s*UNIQUE/i.test(line);
  
  const indexMatch = line.match(/(?:UNIQUE\s+)?(?:INDEX|KEY)\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i);
  if (!indexMatch) return null;
  
  return {
    name: indexMatch[1],
    columns: indexMatch[2].split(',').map(col => col.trim().replace(/[`"']/g, '')),
    isUnique,
  };
}

/**
 * Parse UNIQUE constraint
 */
function parseUniqueConstraint(line: string): SQLIndex | null {
  const constraintMatch = line.match(/(?:CONSTRAINT\s+[`"']?(\w+)[`"']?\s+)?UNIQUE\s*\(([^)]+)\)/i);
  if (!constraintMatch) return null;
  
  return {
    name: constraintMatch[1] || 'unique_constraint',
    columns: constraintMatch[2].split(',').map(col => col.trim().replace(/[`"']/g, '')),
    isUnique: true,
  };
}

/**
 * Validate SQL content
 */
export function validateSQL(sql: string): { isValid: boolean; error?: string } {
  if (!sql || !sql.trim()) {
    return { isValid: false, error: 'SQL content is empty' };
  }
  
  if (!/CREATE\s+TABLE/i.test(sql)) {
    return { isValid: false, error: 'No CREATE TABLE statements found' };
  }
  
  return { isValid: true };
}
