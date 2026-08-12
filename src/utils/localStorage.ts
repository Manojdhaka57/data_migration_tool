/**
 * LocalStorage utilities for persisting mapping data
 */

const STORAGE_KEYS = {
  MAPPING_CONFIG: 'erp_migration_mapping_config',
  SOURCE_SCHEMA: 'erp_migration_source_schema',
  TARGET_SCHEMA: 'erp_migration_target_schema',
  AUTO_MAPPING: 'erp_migration_auto_mapping',
  MIGRATION_RESULTS: 'erp_migration_results',
  MIGRATION_ORDER_CUSTOM_DEPS: 'erp_migration_order_custom_deps',
} as const;

/**
 * Everything this app keeps in localStorage, for wiping on sign-out.
 *
 * Wider than STORAGE_KEYS on purpose: the connection settings are excluded
 * from that set so the sidebar's Reset button cannot wipe database
 * credentials, but sign-out is exactly when they SHOULD go — they include
 * database passwords in plaintext, and leaving them behind hands the next
 * person at this browser a working connection to the target database.
 *
 * The help-guide flag is deliberately kept: re-showing the tour at every
 * sign-in is irritating and protects nothing.
 */
const SIGN_OUT_KEYS: readonly string[] = [
  ...Object.values(STORAGE_KEYS),
  'erp_migration_connection_config',
  'erp_migration_active_configuration',
];

/** Wipe every trace of the signed-in user's working data from this browser. */
export function clearAllUserData(): string[] {
  const cleared: string[] = [];
  for (const key of SIGN_OUT_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        cleared.push(key);
      }
    } catch {
      // Storage unavailable — nothing to clear, and failing here must not
      // prevent the sign-out itself.
    }
  }
  return cleared;
}

/** Table mappings held only in this browser, i.e. at risk on sign-out. */
export function countLocalMappings(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MAPPING_CONFIG);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { tableMappings?: unknown[] };
    return Array.isArray(parsed?.tableMappings) ? parsed.tableMappings.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Save data to localStorage
 */
export function saveToLocalStorage<T>(key: string, data: T): boolean {
  try {
    const jsonString = JSON.stringify(data);
    localStorage.setItem(key, jsonString);
    return true;
  } catch (error) {
    console.error('Error saving to localStorage:', error);
    return false;
  }
}

/**
 * Load data from localStorage
 */
export function loadFromLocalStorage<T>(key: string): T | null {
  try {
    const jsonString = localStorage.getItem(key);
    if (!jsonString) return null;
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error('Error loading from localStorage:', error);
    return null;
  }
}

/**
 * Remove data from localStorage
 */
export function removeFromLocalStorage(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error('Error removing from localStorage:', error);
    return false;
  }
}

/**
 * Check if data exists in localStorage
 */
export function existsInLocalStorage(key: string): boolean {
  return localStorage.getItem(key) !== null;
}

/**
 * Clear all app data from localStorage
 */
export function clearAllAppData(): void {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });
}

// Export storage keys for use in slices
export { STORAGE_KEYS };
