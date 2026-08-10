import { describe, it, expect } from 'vitest';
import { ColumnMapping } from '../types';
import { TransformationEngine } from './engine';

/**
 * Regression net for row-level behaviour.
 *
 * This is the code path every migrated row passes through, so these tests exist
 * to pin CURRENT behaviour: they should fail if a future change alters how a row
 * is transformed, whether or not that change looks harmless.
 */

const direct = (source: string, target: string, extra: Partial<ColumnMapping> = {}): ColumnMapping =>
  ({ source, target, mappingType: 'DIRECT', ...extra }) as ColumnMapping;

describe('TransformationEngine.transformRow', () => {
  it('copies DIRECT columns verbatim', () => {
    const out = TransformationEngine.transformRow(
      { lead_id: 12389791, campaign_id: 330 },
      [direct('lead_id', 'id'), direct('campaign_id', 'campaign_id')],
    );

    expect(out).toEqual({ id: 12389791, campaign_id: 330 });
  });

  it('emits CONSTANT columns without reading the source', () => {
    // Mirrors the real delta.config.json mapping that stamps active_status.
    const out = TransformationEngine.transformRow({}, [
      { target: 'active_status', mappingType: 'CONSTANT', constantValue: 'ACTIVE' } as ColumnMapping,
    ]);

    expect(out.active_status).toBe('ACTIVE');
  });

  it('applies a CONSTANT even when the source value is null', () => {
    const out = TransformationEngine.transformRow({ whatever: null }, [
      {
        source: 'whatever',
        target: 'active_status',
        mappingType: 'CONSTANT',
        constantValue: 'ACTIVE',
      } as ColumnMapping,
    ]);

    expect(out.active_status).toBe('ACTIVE');
  });

  it('leaves an unmapped source value as null rather than undefined', () => {
    const out = TransformationEngine.transformRow({}, [direct('missing', 'target_col')]);
    expect(out.target_col).toBeNull();
  });

  describe('value conversion flags', () => {
    it('converts tinyint to boolean', () => {
      const out = TransformationEngine.transformRow(
        { flag_on: 1, flag_off: 0 },
        [
          direct('flag_on', 'is_first', { convertTinyintToBoolean: true }),
          direct('flag_off', 'is_ips', { convertTinyintToBoolean: true }),
        ],
      );

      expect(out.is_first).toBe(true);
      expect(out.is_ips).toBe(false);
    });

    it('maps zero to null when zeroToNull is set', () => {
      // Used where 0 means "no foreign key" rather than a real reference.
      const out = TransformationEngine.transformRow(
        { parent_id: 0, real_id: 7 },
        [
          direct('parent_id', 'parent_id', { zeroToNull: true }),
          direct('real_id', 'real_id', { zeroToNull: true }),
        ],
      );

      expect(out.parent_id).toBeNull();
      expect(out.real_id).toBe(7);
    });

    it('does not convert zero to null without the flag', () => {
      const out = TransformationEngine.transformRow({ n: 0 }, [direct('n', 'n')]);
      expect(out.n).toBe(0);
    });

    it('preserves null through conversion flags', () => {
      const out = TransformationEngine.transformRow(
        { d: null },
        [direct('d', 'created_at', { convertDateToEpoch: true })],
      );

      expect(out.created_at).toBeNull();
    });
  });

  describe('declarative transformations', () => {
    it.each([
      ['UPPER', 'ba eng', 'BA ENG'],
      ['LOWER', 'BA ENG', 'ba eng'],
      ['TRIM', '  spaced  ', 'spaced'],
    ])('%s', (type, input, expected) => {
      const out = TransformationEngine.transformRow({ v: input }, [
        { source: 'v', target: 'v', mappingType: 'TRANSFORM', transformation: { type } } as ColumnMapping,
      ]);

      expect(out.v).toBe(expected);
    });

    it('passes the value through unchanged for an unknown transformation type', () => {
      // Documents current behaviour: unrecognised types are a no-op, not an error.
      const out = TransformationEngine.transformRow({ v: 'x' }, [
        {
          source: 'v',
          target: 'v',
          mappingType: 'TRANSFORM',
          transformation: { type: 'NOT_A_REAL_TYPE' },
        } as unknown as ColumnMapping,
      ]);

      expect(out.v).toBe('x');
    });
  });

  describe('PII encryption', () => {
    // 32 bytes base64 — used directly as the AES key.
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = (value: unknown) =>
      TransformationEngine.transformRow(
        { v: value },
        [direct('v', 'v', { encrypt: true })],
        undefined,
        key,
      ).v;

    it('is deterministic — the same plaintext yields the same ciphertext', () => {
      // The IV is HMAC-derived precisely so equality and lookups survive
      // migration. If this ever changes, previously migrated data stops matching.
      expect(encrypted('student@example.com')).toBe(encrypted('student@example.com'));
    });

    it('produces different ciphertext for different plaintext', () => {
      expect(encrypted('a@example.com')).not.toBe(encrypted('b@example.com'));
    });

    it('round-trips through decryptValue', () => {
      const cipher = encrypted('Saravanan S');
      expect(TransformationEngine.decryptValue(cipher, key)).toBe('Saravanan S');
    });

    it('does not encrypt nulls', () => {
      expect(encrypted(null)).toBeNull();
    });

    it('leaves the value untouched when no key is supplied', () => {
      const out = TransformationEngine.transformRow(
        { v: 'plaintext' },
        [direct('v', 'v', { encrypt: true })],
      );

      expect(out.v).toBe('plaintext');
    });
  });
});
