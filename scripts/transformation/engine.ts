import { ColumnMapping } from '../types';

export class TransformationEngine {
  /**
   * Transforms a single column value based on mapping configuration
   */
  static transformValue(
    value: any,
    mapping: ColumnMapping,
    targetType?: string
  ): any {
    if (value === null || value === undefined) {
      if (mapping.mappingType === 'CONSTANT') {
        return mapping.constantValue;
      }
      return null;
    }

    let result = value;

    // Handle mapping type rules
    switch (mapping.mappingType) {
      case 'CONSTANT':
        return mapping.constantValue;
        
      case 'TRANSFORM':
        if (mapping.transformation) {
          result = this.applyTransformation(
            value,
            mapping.transformation.type,
            mapping.transformation.params
          );
        }
        break;
        
      case 'DIRECT':
      default:
        // Keep source value
        break;
    }

    // Handle datatype conversion helpers
    if (mapping.convertDateToEpoch) {
      result = this.convertToEpoch(result);
    }
    
    if (mapping.convertTinyintToBoolean) {
      result = this.convertToBoolean(result);
    }

    // Target-aware conversions based on target schema types
    if (targetType) {
      result = this.castToTargetType(result, targetType);
    }

    return result;
  }

  /**
   * Transform an entire row
   */
  static transformRow(
    sourceRow: Record<string, any>,
    columnMappings: ColumnMapping[],
    targetSchemaColumns?: Record<string, string>
  ): Record<string, any> {
    const targetRow: Record<string, any> = {};

    for (const mapping of columnMappings) {
      const sourceVal = sourceRow[mapping.source];
      const targetCol = mapping.target;
      const targetType = targetSchemaColumns ? targetSchemaColumns[targetCol] : undefined;

      targetRow[targetCol] = this.transformValue(sourceVal, mapping, targetType);
    }

    return targetRow;
  }

  private static applyTransformation(
    value: any,
    type: string,
    params?: Record<string, any>
  ): any {
    const strVal = String(value);

    switch (type) {
      case 'UPPER':
        return strVal.toUpperCase();
      case 'LOWER':
        return strVal.toLowerCase();
      case 'TRIM':
        return strVal.trim();
      case 'DATE_FORMAT':
        try {
          const date = new Date(strVal);
          return Number.isNaN(date.getTime()) ? value : date.toISOString().split('T')[0];
        } catch {
          return value;
        }
      case 'COALESCE':
        return value !== null && value !== undefined && value !== '' ? value : (params?.default ?? null);
      case 'SUBSTRING':
        const start = params?.start || 0;
        const length = params?.length;
        return length !== undefined ? strVal.substring(start, start + length) : strVal.substring(start);
      default:
        return value;
    }
  }

  private static convertToEpoch(value: any): any {
    if (value instanceof Date) {
      return Math.floor(value.getTime() / 1000);
    }
    const timestamp = Date.parse(String(value));
    return Number.isNaN(timestamp) ? value : Math.floor(timestamp / 1000);
  }

  private static convertToBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    const num = Number(value);
    if (!Number.isNaN(num)) return num !== 0;
    return String(value).toLowerCase() === 'true' || String(value) === '1';
  }

  private static castToTargetType(value: any, targetType: string): any {
    const typeLower = targetType.toLowerCase().trim();

    // 1. tinyint -> boolean
    if (typeLower === 'boolean' || typeLower === 'bool') {
      return this.convertToBoolean(value);
    }

    // 2. datetime -> timestamp
    if (typeLower.startsWith('timestamp') || typeLower === 'date') {
      if (value instanceof Date) return value;
      // If it's a numeric unix epoch, convert back to Date/ISO
      if (typeof value === 'number') {
        return new Date(value * 1000).toISOString();
      }
      return value; // let the driver parse ISO string
    }

    // 3. json -> jsonb
    if (typeLower === 'json' || typeLower === 'jsonb') {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return value; // already valid JSON string
        } catch {
          return JSON.stringify(value); // wrap plain string in JSON
        }
      }
      return JSON.stringify(value); // stringify objects/arrays/numbers/booleans
    }

    // 4. longtext -> text
    // 5. enum -> varchar/text
    if (typeLower === 'text' || typeLower.startsWith('varchar') || typeLower.startsWith('char')) {
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      const str = String(value);
      // Truncate if target character length is limited
      const lengthMatch = typeLower.match(/\((\d+)\)/);
      if (lengthMatch) {
        const limit = parseInt(lengthMatch[1]);
        if (str.length > limit) {
          return str.substring(0, limit);
        }
      }
      return str;
    }

    return value;
  }
}
