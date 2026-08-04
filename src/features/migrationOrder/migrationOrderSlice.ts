import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Table } from '../../types';

export interface ForeignKeyInfo {
  columnName: string;
  referencesTable: string;
  referencesColumn: string;
  isExplicit: boolean; // true if defined in schema, false if inferred from naming
}

export interface TableDependency {
  tableName: string;
  dependsOn: string[];  // Tables this table depends on (foreign keys point to)
  dependedBy: string[]; // Tables that depend on this table
  foreignKeys: ForeignKeyInfo[]; // Detailed foreign key information
  level: number;        // Migration order level (0 = no dependencies, migrate first)
  columnCount: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface MigrationOrderState {
  dependencies: TableDependency[];
  customDependencies: { from: string; to: string }[];
  isAnalyzed: boolean;
  selectedTable: string | null;
  sortBy: 'level' | 'name' | 'complexity';
  sortDirection: 'asc' | 'desc';
  /** Tables involved in a circular dependency (if any). Null when no cycle. */
  circularDependency: string[] | null;
}

const initialState: MigrationOrderState = {
  dependencies: [],
  customDependencies: [],
  isAnalyzed: false,
  selectedTable: null,
  sortBy: 'level',
  sortDirection: 'asc',
  circularDependency: null,
};

/** Detect a cycle in the dependency graph. Returns table names in one cycle, or null. */
function detectCycle(dependencyMap: Map<string, Set<string>>, tableNames: string[]): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const pathSet = new Set<string>();
  let cycleStart: string | null = null;

  const visit = (table: string): boolean => {
    if (cycleStart !== null) return true;
    if (stack.has(table)) {
      cycleStart = table;
      return true;
    }
    if (visited.has(table)) return false;
    visited.add(table);
    stack.add(table);
    path.push(table);
    pathSet.add(table);

    const deps = dependencyMap.get(table);
    if (deps) {
      for (const dep of deps) {
        if (visit(dep)) {
          if (cycleStart !== null) return true;
        }
      }
    }

    stack.delete(table);
    if (cycleStart === null) {
      path.pop();
      pathSet.delete(table);
    }
    return cycleStart !== null;
  };

  for (const name of tableNames) {
    if (!visited.has(name) && visit(name)) break;
  }

  if (cycleStart === null) return null;
  const startIdx = path.indexOf(cycleStart);
  return path.slice(startIdx);
}

/** Build dependency map from tables (FKs) and custom deps. */
function buildDependencyMap(
  tables: Table[],
  customDeps: { from: string; to: string }[]
): Map<string, Set<string>> {
  const dependencyMap = new Map<string, Set<string>>();
  tables.forEach(t => dependencyMap.set(t.name, new Set()));
  tables.forEach(table => {
    table.columns.forEach(column => {
      if (column.isForeignKey && column.foreignKeyRef) {
        dependencyMap.get(table.name)?.add(column.foreignKeyRef.table);
      } else if (column.name.endsWith('_id') && column.name !== 'id') {
        const potentialTable = column.name.slice(0, -3);
        const matching = tables.find(
          t => t.name === potentialTable || t.name === potentialTable + 's' || t.name.toLowerCase() === potentialTable.toLowerCase()
        );
        if (matching && matching.name !== table.name) {
          dependencyMap.get(table.name)?.add(matching.name);
        }
      }
    });
  });
  customDeps.forEach(dep => {
    if (dependencyMap.has(dep.from)) {
      dependencyMap.get(dep.from)?.add(dep.to);
    }
  });
  return dependencyMap;
}

/** Returns true if adding this dependency would create a cycle. */
export function wouldCreateCycle(
  tables: Table[],
  currentCustomDeps: { from: string; to: string }[],
  newDep: { from: string; to: string }
): boolean {
  const withNew = [...currentCustomDeps, newDep];
  const map = buildDependencyMap(tables, withNew);
  const names = tables.map(t => t.name);
  return detectCycle(map, names) !== null;
}

const migrationOrderSlice = createSlice({
  name: 'migrationOrder',
  initialState,
  reducers: {
    analyzeDependencies: (state, action: PayloadAction<Table[]>) => {
      const tables = action.payload;
      const dependencies: TableDependency[] = [];
      const dependencyMap = new Map<string, Set<string>>();
      const dependedByMap = new Map<string, Set<string>>();
      const foreignKeysMap = new Map<string, ForeignKeyInfo[]>();
      
      // Initialize maps
      tables.forEach(table => {
        dependencyMap.set(table.name, new Set());
        dependedByMap.set(table.name, new Set());
        foreignKeysMap.set(table.name, []);
      });
      
      // Analyze columns for potential foreign keys
      tables.forEach(table => {
        table.columns.forEach(column => {
          // Check for explicit foreign key
          if (column.isForeignKey && column.foreignKeyRef) {
            dependencyMap.get(table.name)?.add(column.foreignKeyRef.table);
            dependedByMap.get(column.foreignKeyRef.table)?.add(table.name);
            foreignKeysMap.get(table.name)?.push({
              columnName: column.name,
              referencesTable: column.foreignKeyRef.table,
              referencesColumn: column.foreignKeyRef.column,
              isExplicit: true,
            });
          }
          // Heuristic: columns ending with _id might be foreign keys
          else if (column.name.endsWith('_id') && column.name !== 'id') {
            const potentialTable = column.name.slice(0, -3); // Remove '_id'
            const matchingTable = tables.find(
              t => t.name === potentialTable || 
                   t.name === potentialTable + 's' || 
                   t.name.toLowerCase() === potentialTable.toLowerCase()
            );
            if (matchingTable && matchingTable.name !== table.name) {
              dependencyMap.get(table.name)?.add(matchingTable.name);
              dependedByMap.get(matchingTable.name)?.add(table.name);
              foreignKeysMap.get(table.name)?.push({
                columnName: column.name,
                referencesTable: matchingTable.name,
                referencesColumn: 'id',
                isExplicit: false,
              });
            }
          }
        });
      });
      
      // Apply custom dependencies
      state.customDependencies.forEach(dep => {
        if (dependencyMap.has(dep.from) && tables.find(t => t.name === dep.to)) {
          dependencyMap.get(dep.from)?.add(dep.to);
          dependedByMap.get(dep.to)?.add(dep.from);
          // Add custom dependency as FK info
          const existingFKs = foreignKeysMap.get(dep.from) || [];
          if (!existingFKs.find(fk => fk.referencesTable === dep.to)) {
            foreignKeysMap.get(dep.from)?.push({
              columnName: '(custom)',
              referencesTable: dep.to,
              referencesColumn: 'id',
              isExplicit: false,
            });
          }
        }
      });
      
      // Calculate levels using topological sort approach
      const levels = new Map<string, number>();
      const calculateLevel = (tableName: string, visited: Set<string> = new Set()): number => {
        if (visited.has(tableName)) return 0; // Circular dependency
        if (levels.has(tableName)) return levels.get(tableName)!;
        
        visited.add(tableName);
        const deps = dependencyMap.get(tableName) || new Set();
        
        if (deps.size === 0) {
          levels.set(tableName, 0);
          return 0;
        }
        
        const maxDepLevel = Math.max(...Array.from(deps).map(d => calculateLevel(d, visited)));
        const level = maxDepLevel + 1;
        levels.set(tableName, level);
        return level;
      };
      
      tables.forEach(table => calculateLevel(table.name));

      // Detect circular dependencies
      const tableNames = tables.map(t => t.name);
      state.circularDependency = detectCycle(dependencyMap, tableNames);
      
      // Build final dependency list
      tables.forEach(table => {
        const columnCount = table.columns.length;
        let complexity: 'low' | 'medium' | 'high' = 'low';
        if (columnCount > 20) complexity = 'high';
        else if (columnCount > 10) complexity = 'medium';
        
        dependencies.push({
          tableName: table.name,
          dependsOn: Array.from(dependencyMap.get(table.name) || []),
          dependedBy: Array.from(dependedByMap.get(table.name) || []),
          foreignKeys: foreignKeysMap.get(table.name) || [],
          level: levels.get(table.name) || 0,
          columnCount,
          estimatedComplexity: complexity,
        });
      });
      
      state.dependencies = dependencies;
      state.isAnalyzed = true;
    },
    
    addCustomDependency: (state, action: PayloadAction<{ from: string; to: string }>) => {
      const { from, to } = action.payload;
      if (!state.customDependencies.find(d => d.from === from && d.to === to)) {
        state.customDependencies.push({ from, to });
      }
    },
    
    removeCustomDependency: (state, action: PayloadAction<{ from: string; to: string }>) => {
      const { from, to } = action.payload;
      state.customDependencies = state.customDependencies.filter(
        d => !(d.from === from && d.to === to)
      );
    },

    /** Replace custom dependencies (e.g. when loading from localStorage). */
    setCustomDependencies: (state, action: PayloadAction<{ from: string; to: string }[]>) => {
      state.customDependencies = action.payload;
    },
    
    setSelectedTable: (state, action: PayloadAction<string | null>) => {
      state.selectedTable = action.payload;
    },
    
    setSortBy: (state, action: PayloadAction<'level' | 'name' | 'complexity'>) => {
      if (state.sortBy === action.payload) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = action.payload;
        state.sortDirection = 'asc';
      }
    },
    
    resetAnalysis: (state) => {
      state.dependencies = [];
      state.isAnalyzed = false;
      state.selectedTable = null;
      state.circularDependency = null;
    },
  },
});

// Selectors
export const selectDependencies = (state: { migrationOrder: MigrationOrderState }) =>
  state.migrationOrder.dependencies;

export const selectSortedDependencies = (state: { migrationOrder: MigrationOrderState }) => {
  const { dependencies, sortBy, sortDirection } = state.migrationOrder;
  const sorted = [...dependencies].sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'level':
        comparison = a.level - b.level;
        break;
      case 'name':
        comparison = a.tableName.localeCompare(b.tableName);
        break;
      case 'complexity':
        const complexityOrder = { low: 0, medium: 1, high: 2 };
        comparison = complexityOrder[a.estimatedComplexity] - complexityOrder[b.estimatedComplexity];
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });
  return sorted;
};

export const selectGroupedByLevel = (state: { migrationOrder: MigrationOrderState }) => {
  const deps = state.migrationOrder.dependencies;
  const grouped = new Map<number, TableDependency[]>();
  
  deps.forEach(dep => {
    if (!grouped.has(dep.level)) {
      grouped.set(dep.level, []);
    }
    grouped.get(dep.level)!.push(dep);
  });
  
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([level, tables]) => ({ level, tables }));
};

export const selectIsAnalyzed = (state: { migrationOrder: MigrationOrderState }) =>
  state.migrationOrder.isAnalyzed;

export const selectSelectedTable = (state: { migrationOrder: MigrationOrderState }) =>
  state.migrationOrder.selectedTable;

export const selectCustomDependencies = (state: { migrationOrder: MigrationOrderState }) =>
  state.migrationOrder.customDependencies;

export const selectSortConfig = (state: { migrationOrder: MigrationOrderState }) => ({
  sortBy: state.migrationOrder.sortBy,
  sortDirection: state.migrationOrder.sortDirection,
});

/** Ordered list of table names in migration order (by level, then by name). Used by server and copy. */
export const selectOrderedTableNames = (state: { migrationOrder: MigrationOrderState }) => {
  const deps = state.migrationOrder.dependencies;
  return [...deps]
    .sort((a, b) => a.level !== b.level ? a.level - b.level : a.tableName.localeCompare(b.tableName))
    .map(d => d.tableName);
};

export const selectCircularDependency = (state: { migrationOrder: MigrationOrderState }) =>
  state.migrationOrder.circularDependency;

export const {
  analyzeDependencies,
  addCustomDependency,
  removeCustomDependency,
  setCustomDependencies,
  setSelectedTable,
  setSortBy,
  resetAnalysis,
} = migrationOrderSlice.actions;

export default migrationOrderSlice.reducer;
