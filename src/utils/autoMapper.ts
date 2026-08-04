/**
 * Auto-mapping utility functions for matching source and target schemas
 * Generates system-suggested mappings based on name similarity and type compatibility
 */

import type { Table, Column } from '../types/schema.types';

export interface ColumnMatch {
  sourceColumn: string;
  targetColumn: string;
  matchScore: number;
  matchType: 'exact' | 'similar' | 'type_only' | 'none';
  typeCompatible: boolean;
}

export interface TableMatch {
  sourceTable: string;
  targetTable: string;
  matchScore: number;
  matchType: 'exact' | 'similar' | 'partial' | 'none';
  columnMatches: ColumnMatch[];
  mappedColumnsCount: number;
  totalTargetColumns: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface AutoMappingResult {
  tableMappings: TableMatch[];
  unmappedSourceTables: string[];
  unmappedTargetTables: string[];
  summary: {
    totalSourceTables: number;
    totalTargetTables: number;
    mappedTables: number;
    highConfidenceMatches: number;
    mediumConfidenceMatches: number;
    lowConfidenceMatches: number;
  };
}

/**
 * Normalize a name for comparison (lowercase, remove special chars)
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\-\s]/g, '') // Remove underscores, hyphens, spaces
    .replace(/s$/, ''); // Remove trailing 's' (plural)
}

/**
 * Calculate similarity score between two strings using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeName(str1);
  const s2 = normalizeName(str2);
  
  // Exact match after normalization
  if (s1 === s2) return 1.0;
  
  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) {
    const shorter = Math.min(s1.length, s2.length);
    const longer = Math.max(s1.length, s2.length);
    return shorter / longer * 0.9;
  }
  
  // Levenshtein distance
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  const distance = matrix[s1.length][s2.length];
  const maxLength = Math.max(s1.length, s2.length);
  return maxLength > 0 ? 1 - distance / maxLength : 1;
}

/**
 * Check if two column types are compatible
 */
function areTypesCompatible(sourceType: string, targetType: string): boolean {
  const s = sourceType.toLowerCase();
  const t = targetType.toLowerCase();
  
  // Exact match
  if (s === t) return true;
  
  // Integer types
  const intTypes = ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint'];
  if (intTypes.some(it => s.includes(it)) && intTypes.some(it => t.includes(it))) return true;
  
  // Decimal types
  const decimalTypes = ['decimal', 'numeric', 'float', 'double', 'real'];
  if (decimalTypes.some(dt => s.includes(dt)) && decimalTypes.some(dt => t.includes(dt))) return true;
  
  // String types
  const stringTypes = ['varchar', 'char', 'text', 'string', 'nvarchar', 'nchar'];
  if (stringTypes.some(st => s.includes(st)) && stringTypes.some(st => t.includes(st))) return true;
  
  // Date/Time types
  const dateTypes = ['date', 'datetime', 'timestamp', 'time'];
  if (dateTypes.some(dt => s.includes(dt)) && dateTypes.some(dt => t.includes(dt))) return true;
  
  // Boolean types
  const boolTypes = ['bool', 'boolean', 'bit', 'tinyint(1)'];
  if (boolTypes.some(bt => s.includes(bt)) && boolTypes.some(bt => t.includes(bt))) return true;
  
  return false;
}

/**
 * Match columns between source and target tables
 */
function matchColumns(sourceColumns: Column[], targetColumns: Column[]): ColumnMatch[] {
  const matches: ColumnMatch[] = [];
  const usedSourceColumns = new Set<string>();
  
  // First pass: exact matches
  for (const targetCol of targetColumns) {
    const exactMatch = sourceColumns.find(
      sc => !usedSourceColumns.has(sc.name) && 
            normalizeName(sc.name) === normalizeName(targetCol.name)
    );
    
    if (exactMatch) {
      usedSourceColumns.add(exactMatch.name);
      matches.push({
        sourceColumn: exactMatch.name,
        targetColumn: targetCol.name,
        matchScore: 1.0,
        matchType: 'exact',
        typeCompatible: areTypesCompatible(exactMatch.type, targetCol.type),
      });
    }
  }
  
  // Second pass: similar matches
  for (const targetCol of targetColumns) {
    if (matches.some(m => m.targetColumn === targetCol.name)) continue;
    
    let bestMatch: { column: Column; score: number } | null = null;
    
    for (const sourceCol of sourceColumns) {
      if (usedSourceColumns.has(sourceCol.name)) continue;
      
      const similarity = calculateSimilarity(sourceCol.name, targetCol.name);
      if (similarity >= 0.6 && (!bestMatch || similarity > bestMatch.score)) {
        bestMatch = { column: sourceCol, score: similarity };
      }
    }
    
    if (bestMatch) {
      usedSourceColumns.add(bestMatch.column.name);
      matches.push({
        sourceColumn: bestMatch.column.name,
        targetColumn: targetCol.name,
        matchScore: bestMatch.score,
        matchType: 'similar',
        typeCompatible: areTypesCompatible(bestMatch.column.type, targetCol.type),
      });
    } else {
      // No match found
      matches.push({
        sourceColumn: '',
        targetColumn: targetCol.name,
        matchScore: 0,
        matchType: 'none',
        typeCompatible: false,
      });
    }
  }
  
  return matches;
}

/**
 * Calculate confidence level based on match quality
 */
function calculateConfidence(columnMatches: ColumnMatch[]): 'high' | 'medium' | 'low' {
  if (columnMatches.length === 0) return 'low';
  
  const matchedCount = columnMatches.filter(m => m.matchType !== 'none').length;
  const exactCount = columnMatches.filter(m => m.matchType === 'exact').length;
  const compatibleCount = columnMatches.filter(m => m.typeCompatible).length;
  
  const matchRatio = matchedCount / columnMatches.length;
  const exactRatio = exactCount / columnMatches.length;
  const compatibleRatio = matchedCount > 0 ? compatibleCount / matchedCount : 0;
  
  if (matchRatio >= 0.8 && exactRatio >= 0.5 && compatibleRatio >= 0.8) return 'high';
  if (matchRatio >= 0.5 && compatibleRatio >= 0.6) return 'medium';
  return 'low';
}

/**
 * Generate automatic mappings between source and target schemas
 */
export function generateAutoMapping(
  sourceTables: Table[],
  targetTables: Table[]
): AutoMappingResult {
  const tableMappings: TableMatch[] = [];
  const mappedSourceTables = new Set<string>();
  const mappedTargetTables = new Set<string>();
  
  // First pass: exact table name matches
  for (const targetTable of targetTables) {
    const exactMatch = sourceTables.find(
      st => !mappedSourceTables.has(st.name) && 
            normalizeName(st.name) === normalizeName(targetTable.name)
    );
    
    if (exactMatch) {
      mappedSourceTables.add(exactMatch.name);
      mappedTargetTables.add(targetTable.name);
      
      const columnMatches = matchColumns(exactMatch.columns, targetTable.columns);
      const mappedColumnsCount = columnMatches.filter(m => m.matchType !== 'none').length;
      
      tableMappings.push({
        sourceTable: exactMatch.name,
        targetTable: targetTable.name,
        matchScore: 1.0,
        matchType: 'exact',
        columnMatches,
        mappedColumnsCount,
        totalTargetColumns: targetTable.columns.length,
        confidence: calculateConfidence(columnMatches),
      });
    }
  }

  // Second pass: similar table name matches
  for (const targetTable of targetTables) {
    if (mappedTargetTables.has(targetTable.name)) continue;
    
    let bestMatch: { table: Table; score: number } | null = null;
    
    for (const sourceTable of sourceTables) {
      if (mappedSourceTables.has(sourceTable.name)) continue;
      
      const similarity = calculateSimilarity(sourceTable.name, targetTable.name);
      if (similarity >= 0.5 && (!bestMatch || similarity > bestMatch.score)) {
        bestMatch = { table: sourceTable, score: similarity };
      }
    }
    
    if (bestMatch) {
      mappedSourceTables.add(bestMatch.table.name);
      mappedTargetTables.add(targetTable.name);
      
      const columnMatches = matchColumns(bestMatch.table.columns, targetTable.columns);
      const mappedColumnsCount = columnMatches.filter(m => m.matchType !== 'none').length;
      
      tableMappings.push({
        sourceTable: bestMatch.table.name,
        targetTable: targetTable.name,
        matchScore: bestMatch.score,
        matchType: bestMatch.score >= 0.8 ? 'similar' : 'partial',
        columnMatches,
        mappedColumnsCount,
        totalTargetColumns: targetTable.columns.length,
        confidence: calculateConfidence(columnMatches),
      });
    }
  }

  // Sort by match score (highest first)
  tableMappings.sort((a, b) => b.matchScore - a.matchScore);

  // Calculate unmapped tables
  const unmappedSourceTables = sourceTables
    .filter(t => !mappedSourceTables.has(t.name))
    .map(t => t.name);

  const unmappedTargetTables = targetTables
    .filter(t => !mappedTargetTables.has(t.name))
    .map(t => t.name);
  
  // Generate summary
  const summary = {
    totalSourceTables: sourceTables.length,
    totalTargetTables: targetTables.length,
    mappedTables: tableMappings.length,
    highConfidenceMatches: tableMappings.filter(m => m.confidence === 'high').length,
    mediumConfidenceMatches: tableMappings.filter(m => m.confidence === 'medium').length,
    lowConfidenceMatches: tableMappings.filter(m => m.confidence === 'low').length,
  };
  
  return {
    tableMappings,
    unmappedSourceTables,
    unmappedTargetTables,
    summary,
  };
}

/**
 * Export mapping result to JSON format suitable for migration config
 */
export function exportMappingToJSON(result: AutoMappingResult): object {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    summary: result.summary,
    tableMappings: result.tableMappings.map(tm => ({
      sourceTable: tm.sourceTable,
      targetTable: tm.targetTable,
      matchType: tm.matchType,
      confidence: tm.confidence,
      matchScore: Math.round(tm.matchScore * 100),
      columnMappings: tm.columnMatches
        .filter(cm => cm.matchType !== 'none')
        .map(cm => ({
          source: cm.sourceColumn,
          target: cm.targetColumn,
          matchType: cm.matchType,
          typeCompatible: cm.typeCompatible,
        })),
      unmappedTargetColumns: tm.columnMatches
        .filter(cm => cm.matchType === 'none')
        .map(cm => cm.targetColumn),
    })),
    unmappedSourceTables: result.unmappedSourceTables,
    unmappedTargetTables: result.unmappedTargetTables,
  };
}
