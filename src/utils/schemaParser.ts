import type { DatabaseSchema } from '../types';

/**
 * Parses and validates a JSON string as a DatabaseSchema
 * Supports both formats:
 * - Simple: { database: "...", tables: [{ name, columns: [{ name, type }] }] }
 * - Extended: { databaseName: "...", tables: [{ name, columns: [{ name, dataType }] }] }
 */
export function parseSchemaJson(jsonString: string): { 
  success: boolean; 
  data?: DatabaseSchema; 
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);
    
    // Support both "database" and "databaseName" field names
    const databaseName = parsed.database || parsed.databaseName;
    
    if (!databaseName || typeof databaseName !== 'string') {
      return { success: false, error: 'Missing or invalid "database" field' };
    }

    if (!Array.isArray(parsed.tables)) {
      return { success: false, error: 'Missing or invalid "tables" field (must be array)' };
    }

    // Normalize the schema structure
    const normalizedSchema: DatabaseSchema = {
      database: databaseName,
      tables: [],
    };

    // Validate and normalize each table
    for (let i = 0; i < parsed.tables.length; i++) {
      const table = parsed.tables[i];
      
      if (!table.name || typeof table.name !== 'string') {
        return { success: false, error: `Table at index ${i} is missing "name" field` };
      }

      if (!Array.isArray(table.columns)) {
        return { success: false, error: `Table "${table.name}" is missing "columns" field` };
      }

      const normalizedColumns = [];

      // Validate and normalize each column
      for (let j = 0; j < table.columns.length; j++) {
        const column = table.columns[j];
        
        if (!column.name || typeof column.name !== 'string') {
          return { 
            success: false, 
            error: `Column at index ${j} in table "${table.name}" is missing "name" field` 
          };
        }

        // Support both "type" and "dataType" field names
        const columnType = column.type || column.dataType;
        
        if (!columnType || typeof columnType !== 'string') {
          return { 
            success: false, 
            error: `Column "${column.name}" in table "${table.name}" is missing "type" field` 
          };
        }

        normalizedColumns.push({
          name: column.name,
          type: columnType,
          nullable: column.nullable ?? true,
          isPrimaryKey: column.isPrimaryKey ?? false,
          isForeignKey: column.isForeignKey ?? false,
          foreignKeyRef: column.foreignKeyRef,
          defaultValue: column.defaultValue,
        });
      }

      normalizedSchema.tables.push({
        name: table.name,
        columns: normalizedColumns,
        sampleData: table.sampleData,
      });
    }

    return { success: true, data: normalizedSchema };
  } catch (e) {
    return { 
      success: false, 
      error: e instanceof Error ? e.message : 'Invalid JSON format' 
    };
  }
}

/**
 * Generates a prettified JSON string from schema
 */
export function stringifySchema(schema: DatabaseSchema): string {
  return JSON.stringify(schema, null, 2);
}

/**
 * Reads a File and returns its contents as string
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
