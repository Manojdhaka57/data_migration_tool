/**
 * Core schema types for database structure representation
 * Supports simplified JSON format:
 * { database: "...", tables: [{ name, columns: [{ name, type }], sampleData }] }
 */

export interface Column {
  name: string;
  type: string;
  // Optional extended properties
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: {
    table: string;
    column: string;
  };
  defaultValue?: string | number | boolean | null;
}

export interface Table {
  name: string;
  columns: Column[];
  /** Ordered list of column names that form the primary key. Length > 1 = composite primary key. */
  primaryKeyColumns?: string[];
  sampleData?: Record<string, unknown>[];
}

export interface DatabaseSchema {
  database: string;
  tables: Table[];
}
