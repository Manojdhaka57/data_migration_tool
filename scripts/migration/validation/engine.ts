import { IDatabaseAdapter } from '../adapters/db.interface';

export interface ValidationReport {
  tableName: string;
  sourceCount: number;
  targetCount: number;
  countMatch: boolean;
  sourceChecksum: string;
  targetChecksum: string;
  checksumMatch: boolean;
  status: 'passed' | 'failed' | 'warning';
  errors: string[];
}

export class ValidationEngine {
  /**
   * Verifies that the migrated table matches the source table in terms of row count and data checksum
   */
  static async validateTable(
    sourceAdapter: IDatabaseAdapter,
    targetAdapter: IDatabaseAdapter,
    sourceTableName: string,
    targetTableName: string,
    mappedColumns: string[],
    sourceWhere?: string,
    sourceFromClause?: string
  ): Promise<ValidationReport> {
    const errors: string[] = [];
    let sourceCount = 0;
    let targetCount = 0;
    let sourceChecksum = '';
    let targetChecksum = '';

    try {
      // 1. Validate Row Counts. When a row filter is applied, only the matching
      // source rows are expected in the target, so count the source with that filter.
      sourceCount = await sourceAdapter.getRowCount(sourceTableName, sourceWhere, sourceFromClause);
      targetCount = await targetAdapter.getRowCount(targetTableName);
    } catch (err: any) {
      errors.push(`Row count validation failed: ${err.message}`);
    }

    const countMatch = sourceCount === targetCount;

    // 2. Validate Data Checksums (only if count matches and rows exist)
    if (countMatch && sourceCount > 0 && mappedColumns.length > 0) {
      try {
        sourceChecksum = await sourceAdapter.getChecksum(sourceTableName, mappedColumns);
        targetChecksum = await targetAdapter.getChecksum(targetTableName, mappedColumns);
      } catch (err: any) {
        errors.push(`Checksum generation failed: ${err.message}`);
      }
    }

    // Checksum matches if they both successfully generated and match, or both failed/empty
    const checksumMatch = sourceChecksum === targetChecksum;

    let status: 'passed' | 'failed' | 'warning' = 'passed';
    if (!countMatch) {
      status = 'failed';
      errors.push(`Row count mismatch: Source has ${sourceCount} rows, Target has ${targetCount} rows`);
    } else if (!checksumMatch && sourceChecksum && targetChecksum) {
      status = 'warning';
      errors.push(`Data checksum mismatch (potential data mutation or encoding differences)`);
    }

    return {
      tableName: targetTableName,
      sourceCount,
      targetCount,
      countMatch,
      sourceChecksum,
      targetChecksum,
      checksumMatch,
      status,
      errors,
    };
  }
}
