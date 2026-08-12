/** Saved migration configurations. Mirrors scripts/metadata/api/routes.ts. */
import { apiFetch } from '../client';

export interface ConfigurationRecord {
  id: number;
  name: string;
  description: string | null;
  source_connection_id: number | null;
  target_connection_id: number | null;
  status: 'ACTIVE' | 'ARCHIVED';
  current_version: number;
  /** Username of whoever first saved it. */
  created_by: string | null;
  created_at: string;
  /** Username of whoever saved the most recent version. */
  updated_by: string | null;
  updated_at: string;
}

export interface VersionSummary {
  id: number;
  configuration_id: number;
  version: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface VersionDetail extends VersionSummary {
  configuration_json: Record<string, unknown>;
}

/** What the migration engine would actually execute for a saved version. */
export interface ResolvedConfiguration {
  success: true;
  configuration: ConfigurationRecord;
  version: { id: number; version: number; created_at: string };
  storedShape: 'engine' | 'browser' | 'mixed' | 'empty';
  engineConfig: {
    version: unknown;
    tableMappings: Array<{
      sourceTable: string;
      targetTable: string;
      conflictStrategy: string;
      columnMappings: Array<{ source: string; target: string; mappingType: string }>;
    }>;
    customDependencies: Array<{ from: string; to: string }>;
  };
  checksum: string;
  warnings: string[];
  dropped: Array<{ index: number; reason: string }>;
}

/** A full ETL setup, ready to dispatch into the store. */
export interface ApplyPayload {
  success: true;
  configuration: ConfigurationRecord;
  version: { id: number; version: number; created_at: string };
  snapshot: {
    snapshotVersion: number;
    connections: {
      source: { connectionId: number | null; dbType: string | null };
      target: { connectionId: number | null; dbType: string | null };
    };
    schemaSnapshots: { sourceId: number | null; targetId: number | null };
    selectedTables: string[];
    tableMappings: unknown[];
    mappingOrder: string[];
    customDependencies: Array<{ from: string; to: string }>;
    runOptions: { useCopy: boolean; force: boolean; batchSize: number };
  };
  schemas: {
    source: { id: number; capturedAt: string; schema: unknown } | null;
    target: { id: number; capturedAt: string; schema: unknown } | null;
  };
  connections: {
    source: { id: number; name: string; db_type: string; host: string; database: string } | null;
    target: { id: number; name: string; db_type: string; host: string; database: string } | null;
  };
  summary: {
    tableMappings: number;
    columnMappings: number;
    warnings: string[];
    dropped: Array<{ index: number; reason: string }>;
  };
}

/** Everything needed to restore a saved setup, in one request. */
export function getApplyPayload(id: number, version?: number): Promise<ApplyPayload> {
  const query = version === undefined ? '' : `?version=${version}`;
  return apiFetch<ApplyPayload>(`/migration-configurations/${id}/apply-payload${query}`);
}

export async function listConfigurations(includeArchived = false): Promise<ConfigurationRecord[]> {
  const result = await apiFetch<{ configurations: ConfigurationRecord[] }>(
    `/migration-configurations${includeArchived ? '?includeArchived=true' : ''}`,
  );
  return result.configurations ?? [];
}

export async function listVersions(id: number): Promise<VersionSummary[]> {
  const result = await apiFetch<{ versions: VersionSummary[] }>(
    `/migration-configurations/${id}/versions`,
  );
  return result.versions ?? [];
}

export async function getVersion(id: number, version: number): Promise<VersionDetail> {
  const result = await apiFetch<{ version: VersionDetail }>(
    `/migration-configurations/${id}/versions/${version}`,
  );
  return result.version;
}

export function getResolved(id: number, version?: number): Promise<ResolvedConfiguration> {
  const query = version === undefined ? '' : `?version=${version}`;
  return apiFetch<ResolvedConfiguration>(`/migration-configurations/${id}/resolved${query}`);
}

export function createConfiguration(input: {
  name: string;
  description?: string;
  configuration: unknown;
  note?: string;
}): Promise<{ configuration: ConfigurationRecord; version: VersionSummary }> {
  return apiFetch('/migration-configurations', { method: 'POST', body: input });
}

/** Appends version N+1 — a saved version is never overwritten. */
export function saveNewVersion(
  id: number,
  input: { configuration: unknown; note?: string; description?: string },
): Promise<{ configuration: ConfigurationRecord; version: VersionSummary }> {
  return apiFetch(`/migration-configurations/${id}`, { method: 'PUT', body: input });
}

export function cloneConfiguration(
  id: number,
  input: { name: string; fromVersion?: number },
): Promise<{ configuration: ConfigurationRecord }> {
  return apiFetch(`/migration-configurations/${id}/clone`, { method: 'POST', body: input });
}

/** Archive, not delete — a run may still reference this configuration. */
export function archiveConfiguration(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/migration-configurations/${id}`, { method: 'DELETE' });
}

export function restoreConfiguration(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/migration-configurations/${id}/restore`, { method: 'POST' });
}
