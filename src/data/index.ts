import sourceSchemaData from './sourceSchema.json';
import targetSchemaData from './targetSchema.json';
import mappingConfigData from './mappingConfig.json';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseSchema, TableMapping, Table, Column, ColumnMapping, MappingType } from '../types';

/**
 * Raw mapping format from JSON file
 */
interface RawColumnMapping {
  source?: string;
  target: string;
  matchType?: string;
  typeCompatible?: boolean;
  mappingType?: string;
  constantValue?: string | number | boolean;
  description?: string;
}

interface RawTableMapping {
  sourceTable?: string;
  targetTable?: string;
  sourceTables?: string[];
  targetTables?: string[];
  matchType?: string;
  confidence?: string;
  matchScore?: number;
  columnMappings: RawColumnMapping[];
  unmappedTargetColumns?: string[];
  description?: string;
  id?: string;
}

/**
 * Process schema to infer primary keys and foreign keys
 * - Columns named "id" with nullable: false are marked as primary keys
 * - Columns ending with "_id" are inferred as foreign keys
 */
function processSchema(schema: DatabaseSchema): DatabaseSchema {
  const tableNames = new Set(schema.tables.map(t => t.name.toLowerCase()));
  
  return {
    ...schema,
    tables: schema.tables.map((table: Table) => ({
      ...table,
      columns: table.columns.map((col: Column) => {
        const columnName = col.name.toLowerCase();
        
        // Infer primary key: column named "id" with nullable: false
        const isPrimaryKey = columnName === 'id' && col.nullable === false;
        
        // Infer foreign key: column ends with "_id" or "Id" (but not just "id")
        let isForeignKey = false;
        let foreignKeyRef: { table: string; column: string } | undefined;
        
        if (columnName !== 'id' && (columnName.endsWith('_id') || col.name.endsWith('Id'))) {
          // Try to find referenced table
          // e.g., "student_id" -> "student", "userId" -> "user"
          let refTableName = '';
          
          if (columnName.endsWith('_id')) {
            refTableName = columnName.slice(0, -3); // Remove "_id"
          } else if (col.name.endsWith('Id')) {
            // camelCase: userId -> user
            refTableName = col.name.slice(0, -2).toLowerCase();
          }
          
          // Check if a table with this name exists (with common variations)
          const possibleTableNames = [
            refTableName,
            refTableName + 's',      // plural: user -> users
            refTableName + 'es',     // plural: class -> classes  
            refTableName.replace(/_/g, ''), // no underscores
          ];
          
          for (const possibleName of possibleTableNames) {
            if (tableNames.has(possibleName)) {
              isForeignKey = true;
              foreignKeyRef = {
                table: possibleName,
                column: 'id',
              };
              break;
            }
          }
          
          // Even if table not found, still mark as FK if it looks like one
          if (!isForeignKey && (columnName.endsWith('_id') || col.name.endsWith('Id'))) {
            isForeignKey = true;
            foreignKeyRef = {
              table: refTableName || 'unknown',
              column: 'id',
            };
          }
        }
        
        return {
          ...col,
          isPrimaryKey: col.isPrimaryKey || isPrimaryKey,
          isForeignKey: col.isForeignKey || isForeignKey,
          foreignKeyRef: col.foreignKeyRef || foreignKeyRef,
        };
      }),
    })),
  };
}

// Process schemas to add inferred PK/FK info
export const sourceSchema: DatabaseSchema = processSchema(sourceSchemaData as DatabaseSchema);
export const targetSchema: DatabaseSchema = processSchema(targetSchemaData as DatabaseSchema);

/**
 * Transform raw mapping data from JSON to the expected TypeScript format
 * Handles:
 * - sourceTable (string) -> sourceTables (array)
 * - targetTable (string) -> targetTables (array)
 * - columnMappings source/target strings -> { table, column } objects
 * - Adds missing id and mappingType fields
 */
function transformMappings(rawMappings: RawTableMapping[]): TableMapping[] {
  console.log('rawMappings', rawMappings);
  return rawMappings?.map((raw) => {
    // Get source and target table names
    const sourceTables = raw.sourceTables || (raw.sourceTable ? [raw.sourceTable] : []);
    const targetTables = raw.targetTables || (raw.targetTable ? [raw.targetTable] : []);
    
    // Primary source and target table for column mapping context
    const primarySourceTable = sourceTables[0] || '';
    const primaryTargetTable = targetTables[0] || '';
    
    // Transform column mappings
    const columnMappings: ColumnMapping[] = (raw.columnMappings || []).map((colRaw) => {
      // Determine mapping type
      let mappingType: MappingType = 'DIRECT';
      if (colRaw.mappingType === 'CONSTANT' || (!colRaw.source && colRaw.constantValue !== undefined)) {
        mappingType = 'CONSTANT';
      } else if (colRaw.mappingType === 'TRANSFORM') {
        mappingType = 'TRANSFORM';
      }
      
      // Build the column mapping
      const colMapping: ColumnMapping = {
        id: uuidv4(),
        target: {
          table: primaryTargetTable,
          column: typeof colRaw.target === 'string' ? colRaw.target : (colRaw.target as { column?: string })?.column || '',
        },
        mappingType,
      };
      
      // Add source if present (for DIRECT mappings)
      if (colRaw.source && mappingType === 'DIRECT') {
        colMapping.source = {
          table: primarySourceTable,
          column: typeof colRaw.source === 'string' ? colRaw.source : '',
        };
      }
      
      // Add constant value if present
      if (colRaw.constantValue !== undefined) {
        colMapping.constantValue = colRaw.constantValue;
      }
      
      return colMapping;
    });
    
    return {
      id: raw.id || uuidv4(),
      sourceTables,
      targetTables,
      columnMappings,
      description: raw.description,
    };
  });
}

// Type assertion for raw mappings
const rawMappingData = mappingConfigData as { tableMappings: RawTableMapping[] };
export const initialMappings: TableMapping[] = transformMappings(rawMappingData.tableMappings);
