/**
 * Delta module for the `opportunity_referral_details` target table.
 *
 * Computes how many rows are NEW or CHANGED vs the target (source: students,
 * filtered to university_id = 31 AND refer_lead_id > 0), matched on the target
 * primary key `id` (← students.id). Embeds its own mapping config, so it just runs.
 *
 *   npx tsx scripts/tables/opportunity_referral_details.ts            # report counts (no writes)
 *   npx tsx scripts/tables/opportunity_referral_details.ts --apply    # upsert new+changed to target
 *   npx tsx scripts/tables/opportunity_referral_details.ts --limit 5000
 *   npx tsx scripts/tables/opportunity_referral_details.ts --ignore updated_at
 *
 * Writes scripts/output/opportunity_referral_details-{new,changed,ids}.json.
 */
import { runDelta, parseCliOpts } from '../delta-transfer.js';

const tableMappings = [
  {
    sourceTables: ['students'],
    targetTables: ['opportunity_referral_details'],
    columnMappings: [
      { target: { table: 'opportunity_referral_details', column: 'id' }, mappingType: 'DIRECT', source: { table: 'students', column: 'id' } },
      { target: { table: 'opportunity_referral_details', column: 'active_status' }, mappingType: 'CONSTANT', constantValue: 'ACTIVE' },
      { target: { table: 'opportunity_referral_details', column: 'refferal_name' }, mappingType: 'DIRECT', source: { table: 'students', column: 'referred_by' } },
      { target: { table: 'opportunity_referral_details', column: 'is_deleted' }, mappingType: 'CONSTANT', constantValue: false },
      { target: { table: 'opportunity_referral_details', column: 'created_by' }, mappingType: 'DIRECT', source: { table: 'students', column: 'created_by' }, zeroToNull: true },
      { target: { table: 'opportunity_referral_details', column: 'updated_by' }, mappingType: 'DIRECT', source: { table: 'students', column: 'modified_by' }, zeroToNull: true },
      { target: { table: 'opportunity_referral_details', column: 'opportunity_id' }, mappingType: 'DIRECT', source: { table: 'students', column: 'lead_id' } },
      {
        target: { table: 'opportunity_referral_details', column: 'created_at' },
        mappingType: 'TRANSFORM',
        transformation: { type: 'CUSTOM', params: { expression: "CASE\n    WHEN students.created_at IS NOT NULL\n         AND students.created_at <> '0000-00-00 00:00:00'\n    THEN UNIX_TIMESTAMP(students.created_at)\nEND" } },
        sourceColumns: [{ table: 'students', column: 'created_at' }],
        convertDateToEpoch: true,
      },
      {
        target: { table: 'opportunity_referral_details', column: 'updated_at' },
        mappingType: 'TRANSFORM',
        transformation: { type: 'CUSTOM', params: { expression: "CASE\n    WHEN students.modified_at IS NOT NULL\n         AND students.modified_at <> '0000-00-00 00:00:00'\n    THEN UNIX_TIMESTAMP(students.modified_at)\nEND" } },
        sourceColumns: [{ table: 'students', column: 'modified_at' }],
        convertDateToEpoch: true,
      },
      { target: { table: 'opportunity_referral_details', column: 'referrer_opportunity_id' }, mappingType: 'DIRECT', source: { table: 'students', column: 'refer_lead_id' }, zeroToNull: true },
      { target: { table: 'opportunity_referral_details', column: 'refferal_source' }, mappingType: 'DIRECT', source: { table: 'students', column: 'c5' } },
    ],
    rowFilters: [
      { column: 'students.university_id', operator: '=', value: '31' },
      { column: 'students.refer_lead_id', operator: '>', value: '0' },
    ],
  },
];

runDelta(tableMappings, parseCliOpts());
