import { ColumnMapping } from '../types';
import * as crypto from 'crypto';

export class TransformationEngine {
  // Must match the application's PiiEncryptionService (AES-256-GCM, deterministic
  // HMAC-derived IV, versioned blob) so migrated ciphertext decrypts in the app.
  private static readonly PII_IV_LEN = 12;    // GCM_IV_LENGTH_BYTES
  private static readonly PII_TAG_LEN = 16;   // GCM_TAG_LENGTH_BITS (128) / 8
  private static readonly PII_VERSION_V1 = 1; // PiiEncryptionConstants.FORMAT_VERSION_V1

  /**
   * Encrypt a value the same way the Java PiiEncryptionService does, so the
   * application can decrypt migrated values.
   *
   * Output: Base64( version(1) || iv(12) || ciphertext || gcmTag(16) ).
   *   - key: the app's Base64-encoded 32-byte AES-256 key
   *          (security.pii-encryption.secret-key). For exact interop, pass that Base64
   *          key. If the value isn't a 32-byte Base64 key, a SHA-256 fallback key is
   *          derived (NOT app-compatible).
   *   - iv:  first 12 bytes of HMAC-SHA256(key, plaintext) — deterministic, so the
   *          same plaintext always produces the same ciphertext.
   */
  static encryptValue(value: any, key: string): string {
    let keyBuf: Buffer;
    let decoded = Buffer.alloc(0);
    try { decoded = Buffer.from(String(key), 'base64'); } catch { /* not base64 */ }
    keyBuf = decoded.length === 32 ? decoded : crypto.createHash('sha256').update(String(key)).digest();

    const plain = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const iv = crypto.createHmac('sha256', keyBuf).update(plain, 'utf8').digest().subarray(0, this.PII_IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: this.PII_TAG_LEN });
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([this.PII_VERSION_V1]), iv, ct, tag]).toString('base64');
  }

  /**
   * Inverse of encryptValue — decrypts the Java PiiEncryptionService v1 blob.
   * Provided for parity/verification; the migration itself only encrypts.
   */
  static decryptValue(blob: string, key: string): string {
    let decoded = Buffer.alloc(0);
    try { decoded = Buffer.from(String(key), 'base64'); } catch { /* not base64 */ }
    const keyBuf = decoded.length === 32 ? decoded : crypto.createHash('sha256').update(String(key)).digest();

    const combined = Buffer.from(String(blob), 'base64');
    if (combined.length < 1 + this.PII_IV_LEN + this.PII_TAG_LEN) throw new Error('ciphertext too short');
    const version = combined[0];
    if (version !== this.PII_VERSION_V1) throw new Error(`unsupported PII format version: ${version}`);
    const iv = combined.subarray(1, 1 + this.PII_IV_LEN);
    const tag = combined.subarray(combined.length - this.PII_TAG_LEN);
    const ct = combined.subarray(1 + this.PII_IV_LEN, combined.length - this.PII_TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: this.PII_TAG_LEN });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

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

    // 0 → NULL (e.g. 0 used as "no foreign key"). Checked before type casting.
    if (mapping.zeroToNull && (result === 0 || result === '0' || result === 0n)) {
      return null;
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
    targetSchemaColumns?: Record<string, string>,
    encryptionKey?: string
  ): Record<string, any> {
    const targetRow: Record<string, any> = {};

    for (const mapping of columnMappings) {
      const sourceVal = sourceRow[mapping.source];
      const targetCol = mapping.target;
      const targetType = targetSchemaColumns ? targetSchemaColumns[targetCol] : undefined;

      let value = this.transformValue(sourceVal, mapping, targetType);
      // Encrypt flagged columns last (on the final value), skipping null/undefined.
      if (mapping.encrypt && encryptionKey && value !== null && value !== undefined) {
        value = this.encryptValue(value, encryptionKey);
      }
      targetRow[targetCol] = value;
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

  /**
   * Convert a date value to Unix epoch SECONDS. Handles the common SQL datetime
   * form "YYYY-MM-DD HH:MM:SS[.fff]" (space separator, no timezone) — which is not
   * ISO 8601 and parses inconsistently — by normalizing the space to 'T' first.
   * Native Date objects and already-numeric epochs pass through unchanged.
   */
  private static convertToEpoch(value: any): any {
    if (value === null || value === undefined || value === '') return value;

    // Drivers usually return DATETIME/TIMESTAMP columns as JS Date objects.
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? value : Math.floor(value.getTime() / 1000);
    }

    // Already a number → treat as an existing epoch, don't double-convert.
    if (typeof value === 'number') return value;

    const str = String(value).trim();
    if (!str) return value;

    // Pure integer string → already an epoch; keep it numeric.
    if (/^\d+$/.test(str)) return Number(str);

    // Normalize "2025-11-06 12:24:24" → "2025-11-06T12:24:24" so it parses the same
    // everywhere (an offset-less date-time is interpreted as local time).
    const normalized = str.includes('T') ? str : str.replace(' ', 'T');
    let ms = Date.parse(normalized);
    if (Number.isNaN(ms)) ms = Date.parse(str); // fall back to lenient parse
    return Number.isNaN(ms) ? value : Math.floor(ms / 1000);
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

    // 2b. integer / bigint target: a date value here can only mean Unix epoch, so
    // auto-convert it. Prevents `invalid input syntax for type bigint: "2025-11-06
    // 12:24:24"` even when the per-column "date → epoch" flag didn't reach this run.
    // Plain numbers / integer strings pass straight through.
    if (/^(bigint|int8|integer|int4|int2|int|smallint|mediumint|bigserial|serial)\b/.test(typeLower)) {
      if (typeof value === 'number') return value;
      const epoch = this.convertToEpoch(value);
      return typeof epoch === 'number' ? epoch : value;
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
