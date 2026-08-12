/**
 * Connection settings entered in the UI.
 *
 * These are sent to the API server, which merges them over the .env values —
 * anything filled in here wins, anything left blank falls back to the matching
 * *_DB_* variable in .env. That means the tool can run with no .env at all.
 *
 * The server keeps them in memory only, so they are also mirrored into
 * localStorage here and re-sent on app load to survive a server restart.
 *
 * Note: this stores the DB passwords in browser localStorage on this machine.
 * Use "Reset to .env" to remove them.
 */

import { API_BASE_URL as API_BASE } from '../../api/config';

/**
 * Deliberately NOT part of STORAGE_KEYS in utils/localStorage — the sidebar
 * "Reset Data" button clears those, and wiping DB credentials on a schema reset
 * would be a nasty surprise. Cleared explicitly via "Reset to .env" instead.
 */
const STORAGE_KEY = 'erp_migration_connection_config';

export type DbDialect = 'mysql' | 'postgresql';
export type ValueSource = 'ui' | 'env' | 'default';

/** All strings so the form stays controlled; '' means "not set, use .env". */
export interface DbConnectionForm {
  type: DbDialect | '';
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: 'true' | 'false' | '';
}

export interface ConnectionSettings {
  source: DbConnectionForm;
  target: DbConnectionForm;
  encryptionKey: string;
}

export interface ResolvedField {
  value?: string;
  from: ValueSource;
}

export type ResolvedConnection = Record<keyof DbConnectionForm, ResolvedField>;

export interface ResolvedConfig {
  source: ResolvedConnection;
  target: ResolvedConnection;
}

export interface ProbeResult {
  success: boolean;
  message?: string;
  error?: string;
  tables?: number;
}

export function emptyConnectionForm(): DbConnectionForm {
  return { type: '', host: '', port: '', database: '', user: '', password: '', ssl: '' };
}

export function emptyConnectionSettings(): ConnectionSettings {
  return { source: emptyConnectionForm(), target: emptyConnectionForm(), encryptionKey: '' };
}

/** Merge stored values over the empty shape so older saves stay loadable. */
function hydrate(stored: Partial<ConnectionSettings> | null): ConnectionSettings {
  const base = emptyConnectionSettings();
  if (!stored) return base;
  return {
    source: { ...base.source, ...(stored.source ?? {}) },
    target: { ...base.target, ...(stored.target ?? {}) },
    encryptionKey: stored.encryptionKey ?? '',
  };
}

export function loadConnectionSettings(): ConnectionSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return hydrate(JSON.parse(raw) as Partial<ConnectionSettings>);
  } catch (err) {
    console.warn('Could not read saved connection settings:', err);
    return null;
  }
}

export function saveConnectionSettings(settings: ConnectionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Could not save connection settings:', err);
  }
}

export function clearStoredConnectionSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasStoredConnectionSettings(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** True when at least one field is filled in — i.e. something overrides .env. */
export function hasAnyOverride(settings: ConnectionSettings): boolean {
  const filled = (form: DbConnectionForm) => Object.values(form).some((v) => v.trim() !== '');
  return filled(settings.source) || filled(settings.target) || settings.encryptionKey.trim() !== '';
}

async function asJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/** Push settings to the server so every subsequent DB call uses them. */
export async function applyConnectionSettings(settings: ConnectionSettings): Promise<ResolvedConfig> {
  const data = await asJson(
    await fetch(`${API_BASE}/connection-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  );
  return data.resolved as ResolvedConfig;
}

/** Read back what the server will actually use, and where each value came from. */
export async function fetchResolvedConfig(): Promise<ResolvedConfig> {
  const data = await asJson(await fetch(`${API_BASE}/connection-config`));
  return data.resolved as ResolvedConfig;
}

/** Try these settings without storing them. */
export async function testConnectionSettings(
  settings: ConnectionSettings,
  roles: ('source' | 'target')[] = ['source', 'target'],
): Promise<{ source?: ProbeResult; target?: ProbeResult }> {
  return asJson(
    await fetch(`${API_BASE}/connection-config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, roles }),
    }),
  );
}

/** Drop the server-side overrides so .env alone applies. */
export async function resetServerConnectionSettings(): Promise<ResolvedConfig> {
  const data = await asJson(await fetch(`${API_BASE}/connection-config`, { method: 'DELETE' }));
  return data.resolved as ResolvedConfig;
}

/**
 * Re-send saved settings after a page load or server restart. Called once at
 * app startup; failure is non-fatal (the API server may simply not be running
 * yet), so it resolves to false instead of throwing.
 */
export async function restoreConnectionSettings(): Promise<boolean> {
  const saved = loadConnectionSettings();
  if (!saved || !hasAnyOverride(saved)) return false;
  try {
    await applyConnectionSettings(saved);
    console.log('🔌 Restored connection settings from localStorage');
    return true;
  } catch (err) {
    console.warn('Could not restore connection settings (is the API server running?):', err);
    return false;
  }
}
