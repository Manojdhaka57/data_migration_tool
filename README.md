# ERP Data Migration Configuration Tool

A scalable React + TypeScript application for configuring data migration between two PostgreSQL databases. This frontend-only tool generates migration configuration JSON without connecting to any database.

## 🎯 Purpose

This tool allows you to:
- **Configure data migrations** between source and target PostgreSQL databases
- **Map tables** (1:N, N:1, N:N relationships supported)
- **Map columns** with direct mapping, constant values, or transformations
- **Generate migration config JSON** that can be executed by a backend service

## 🚫 What This Tool Does NOT Do

- Connect to any database
- Execute SQL queries
- Perform actual data migration
- Store sensitive database credentials

## 📁 Project Structure

```
src/
├── types/                    # TypeScript type definitions
│   ├── schema.types.ts       # Database schema types
│   ├── mapping.types.ts      # Mapping configuration types
│   └── index.ts
├── store/                    # Redux store configuration
│   ├── store.ts
│   ├── hooks.ts
│   └── index.ts
├── features/                 # Feature-based modules
│   ├── sourceSchema/         # Source schema management
│   │   ├── SourceSchemaPanel.tsx
│   │   ├── sourceSchemaSlice.ts
│   │   └── index.ts
│   ├── targetSchema/         # Target schema management
│   │   ├── TargetSchemaPanel.tsx
│   │   ├── targetSchemaSlice.ts
│   │   └── index.ts
│   ├── mapping/              # Table & column mapping
│   │   ├── MappingCanvas.tsx
│   │   ├── ColumnMappingRow.tsx
│   │   ├── AddColumnMappingModal.tsx
│   │   ├── mappingSlice.ts
│   │   └── index.ts
│   ├── preview/              # Config preview & validation
│   │   ├── PreviewPanel.tsx
│   │   └── index.ts
│   └── ui/                   # UI state management
│       ├── uiSlice.ts
│       └── index.ts
├── components/               # Shared components
│   └── shared/
│       ├── JsonUploader.tsx
│       ├── TableList.tsx
│       └── index.ts
├── utils/                    # Utility functions
│   ├── validation.ts         # Mapping validation
│   ├── schemaParser.ts       # JSON schema parsing
│   ├── configGenerator.ts    # Config generation
│   └── index.ts
├── App.tsx                   # Main application
├── App.module.css
├── main.tsx                  # Entry point
└── index.css                 # Global styles

public/
└── examples/                 # Example JSON files
    ├── sourceSchema.json
    ├── targetSchema.json
    └── sampleMigrationConfig.json
```

## 🔧 Data Models

### DatabaseSchema
```typescript
interface DatabaseSchema {
  databaseName: string;
  schemaVersion?: string;
  tables: Table[];
  metadata?: { createdAt?: string; description?: string };
}
```

### Table
```typescript
interface Table {
  name: string;
  columns: Column[];
  primaryKey?: string[];
  foreignKeys?: ForeignKey[];
  sampleData?: Record<string, unknown>[];
}
```

### Column
```typescript
interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyRef?: { table: string; column: string };
  defaultValue?: string | number | boolean | null;
  constraints?: string[];
}
```

### TableMapping
```typescript
interface TableMapping {
  id: string;
  sourceTables: string[];   // One or many
  targetTables: string[];   // One or many
  columnMappings: ColumnMapping[];
  description?: string;
}
```

### ColumnMapping
```typescript
interface ColumnMapping {
  id: string;
  targetTable: string;
  targetColumn: string;
  mappingType: 'direct' | 'constant' | 'transform';
  sourceTable?: string;
  sourceColumn?: string;
  constant?: ConstantValue;
  transformation?: TransformationRule;
  sourceColumns?: string[];
}
```

## 🔄 Transformation Types

| Type | Description | Example |
|------|-------------|---------|
| `UPPER` | Convert to uppercase | `john` → `JOHN` |
| `LOWER` | Convert to lowercase | `JOHN` → `john` |
| `CONCAT` | Concatenate columns | `first` + `last` → `first last` |
| `DATE_FORMAT` | Format date | `2024-01-15` → `Jan 15, 2024` |
| `CUSTOM` | Custom SQL expression | `CASE WHEN x > 0 THEN 'YES' ELSE 'NO' END` |

## 📋 Constant Types

| Type | Example |
|------|---------|
| `string` | `"MIGRATED"` |
| `number` | `100` |
| `boolean` | `true` / `false` |

## ✅ Validation Rules

1. **Unique Target Columns**: Each target column can only be mapped once
2. **Required Columns**: Non-nullable columns without defaults must be mapped
3. **Valid Constants**: Constant mappings must have values defined
4. **Valid Transforms**: Transform rules must have all required parameters

## 🚀 Getting Started

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

## 📖 How to Use

1. **Load Source Schema**: Upload or paste the source database schema JSON
2. **Load Target Schema**: Upload or paste the target database schema JSON
3. **Create Table Mapping**: Select source and target tables to map
4. **Add Column Mappings**: Define how each column should be mapped:
   - **Direct**: Map source column directly to target
   - **Constant**: Set a fixed value
   - **Transform**: Apply a transformation function
5. **Preview & Validate**: Review the generated config and fix any validation errors
6. **Export**: Download or copy the migration configuration JSON

## 📤 Output Format

The tool generates a `MigrationConfig` JSON:

```json
{
  "version": "1.0.0",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "sourceDatabase": "legacy_db",
  "targetDatabase": "modern_db",
  "tableMappings": [
    {
      "id": "tm-001",
      "sourceTables": ["employees"],
      "targetTables": ["staff"],
      "columnMappings": [
        {
          "id": "cm-001",
          "targetTable": "staff",
          "targetColumn": "full_name",
          "mappingType": "transform",
          "transformation": {
            "type": "CONCAT",
            "params": { "separator": " " }
          },
          "sourceColumns": ["employees.first_name", "employees.last_name"]
        }
      ]
    }
  ]
}
```

## 🛠 Tech Stack

- **React 19** - UI Framework
- **TypeScript** - Type Safety
- **Redux Toolkit** - State Management
- **Vite** - Build Tool
- **CSS Modules** - Scoped Styling

## 📝 License

MIT
