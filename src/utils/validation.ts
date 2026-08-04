import type { 
  TableMapping, 
  ValidationError, 
  DatabaseSchema,
  Column 
} from '../types';

/**
 * Validates that each target column is mapped only once across all mappings
 */
export function validateUniqueTargetColumns(tableMappings: TableMapping[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const mappedColumns = new Map<string, { tableMappingId: string; columnMappingId: string }>();

  for (const tableMapping of tableMappings) {
    for (const columnMapping of tableMapping.columnMappings) {
      const key = `${columnMapping.target.table}.${columnMapping.target.column}`;
      const existing = mappedColumns.get(key);
      
      if (existing) {
        errors.push({
          type: 'error',
          field: key,
          message: `Target column "${columnMapping.target.column}" in table "${columnMapping.target.table}" is mapped multiple times`,
          tableMappingId: tableMapping.id,
          columnMappingId: columnMapping.id,
        });
      } else {
        mappedColumns.set(key, {
          tableMappingId: tableMapping.id,
          columnMappingId: columnMapping.id,
        });
      }
    }
  }

  return errors;
}

/**
 * Validates that all required (non-nullable, no default) target columns are mapped
 */
export function validateRequiredColumns(
  tableMappings: TableMapping[],
  targetSchema: DatabaseSchema
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // Get all mapped target columns
  const mappedColumns = new Set<string>();
  for (const tableMapping of tableMappings) {
    for (const columnMapping of tableMapping.columnMappings) {
      mappedColumns.add(`${columnMapping.target.table}.${columnMapping.target.column}`);
    }
  }

  // Check each target table for required columns
  for (const table of targetSchema.tables) {
    for (const column of table.columns) {
      const key = `${table.name}.${column.name}`;
      const isRequired = column.nullable === false && column.defaultValue === undefined;
      
      if (isRequired && !mappedColumns.has(key)) {
        errors.push({
          type: 'warning',
          field: key,
          message: `Required column "${column.name}" in table "${table.name}" is not mapped`,
        });
      }
    }
  }

  return errors;
}

/**
 * Validates that constant values are properly defined
 */
export function validateConstants(tableMappings: TableMapping[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const tableMapping of tableMappings) {
    for (const columnMapping of tableMapping.columnMappings) {
      if (columnMapping.mappingType === 'CONSTANT') {
        if (columnMapping.constantValue === undefined || columnMapping.constantValue === null) {
          errors.push({
            type: 'error',
            field: `${columnMapping.target.table}.${columnMapping.target.column}`,
            message: `Constant value is required for column "${columnMapping.target.column}"`,
            tableMappingId: tableMapping.id,
            columnMappingId: columnMapping.id,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validates transformation rules
 */
export function validateTransformations(tableMappings: TableMapping[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const tableMapping of tableMappings) {
    for (const columnMapping of tableMapping.columnMappings) {
      if (columnMapping.mappingType === 'TRANSFORM') {
        if (!columnMapping.transformation) {
          errors.push({
            type: 'error',
            field: `${columnMapping.target.table}.${columnMapping.target.column}`,
            message: `Transformation rule is required for column "${columnMapping.target.column}"`,
            tableMappingId: tableMapping.id,
            columnMappingId: columnMapping.id,
          });
          continue;
        }

        const { transformation, sourceColumns } = columnMapping;

        switch (transformation.type) {
          case 'CONCAT':
            if (!sourceColumns || sourceColumns.length < 2) {
              errors.push({
                type: 'error',
                field: `${columnMapping.target.table}.${columnMapping.target.column}`,
                message: `CONCAT transformation requires at least 2 source columns`,
                tableMappingId: tableMapping.id,
                columnMappingId: columnMapping.id,
              });
            }
            break;
          case 'DATE_FORMAT':
            if (!transformation.params?.format) {
              errors.push({
                type: 'error',
                field: `${columnMapping.target.table}.${columnMapping.target.column}`,
                message: `DATE_FORMAT transformation requires a format parameter`,
                tableMappingId: tableMapping.id,
                columnMappingId: columnMapping.id,
              });
            }
            if (!sourceColumns || sourceColumns.length === 0) {
              errors.push({
                type: 'error',
                field: `${columnMapping.target.table}.${columnMapping.target.column}`,
                message: `DATE_FORMAT transformation requires a source column`,
                tableMappingId: tableMapping.id,
                columnMappingId: columnMapping.id,
              });
            }
            break;
          case 'CUSTOM':
            if (!transformation.params?.expression) {
              errors.push({
                type: 'error',
                field: `${columnMapping.target.table}.${columnMapping.target.column}`,
                message: `CUSTOM transformation requires an expression`,
                tableMappingId: tableMapping.id,
                columnMappingId: columnMapping.id,
              });
            }
            break;
          case 'UPPER':
          case 'LOWER':
            if (!sourceColumns || sourceColumns.length === 0) {
              errors.push({
                type: 'error',
                field: `${columnMapping.target.table}.${columnMapping.target.column}`,
                message: `${transformation.type} transformation requires a source column`,
                tableMappingId: tableMapping.id,
                columnMappingId: columnMapping.id,
              });
            }
            break;
        }
      }
    }
  }

  return errors;
}

/**
 * Validates direct mappings have source column specified
 */
export function validateDirectMappings(tableMappings: TableMapping[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const tableMapping of tableMappings) {
    for (const columnMapping of tableMapping.columnMappings) {
      if (columnMapping.mappingType === 'DIRECT') {
        if (!columnMapping.source?.table || !columnMapping.source?.column) {
          errors.push({
            type: 'error',
            field: `${columnMapping.target.table}.${columnMapping.target.column}`,
            message: `Direct mapping requires source table and column`,
            tableMappingId: tableMapping.id,
            columnMappingId: columnMapping.id,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Runs all validations and returns combined errors
 */
export function validateAllMappings(
  tableMappings: TableMapping[],
  targetSchema: DatabaseSchema | null
): ValidationError[] {
  const errors: ValidationError[] = [];

  errors.push(...validateUniqueTargetColumns(tableMappings));
  errors.push(...validateConstants(tableMappings));
  errors.push(...validateTransformations(tableMappings));
  errors.push(...validateDirectMappings(tableMappings));

  if (targetSchema) {
    errors.push(...validateRequiredColumns(tableMappings, targetSchema));
  }

  return errors;
}

/**
 * Helper to get column info
 */
export function getColumnInfo(column: Column): string {
  const parts: string[] = [column.type];
  if (column.isPrimaryKey) parts.push('PK');
  if (column.isForeignKey) parts.push('FK');
  if (column.nullable === false) parts.push('NOT NULL');
  return parts.join(' | ');
}
