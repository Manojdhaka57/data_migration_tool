/**
 * Which saved configuration this browser is working on.
 *
 * The DATA lives in the metadata database. This stores only a pointer to it —
 * an id and version number — so a reload reopens what you were working on
 * without the browser being a second, divergent copy of the configuration
 * itself. That distinction is the whole point of moving to database-backed
 * data: localStorage holds a bookmark and unsaved edits, never the record.
 */

const KEY = 'erp_migration_active_configuration';

export interface ActiveConfigurationPointer {
  configurationId: number;
  /** The version that was loaded, so the UI can say what the draft is based on. */
  version: number;
  name: string;
}

export function getActiveConfiguration(): ActiveConfigurationPointer | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveConfigurationPointer;
    return Number.isFinite(parsed?.configurationId) ? parsed : null;
  } catch {
    return null;
  }
}

export function setActiveConfiguration(pointer: ActiveConfigurationPointer): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pointer));
  } catch {
    // A full or unavailable storage only costs us the bookmark, not the data.
  }
}

export function clearActiveConfiguration(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
