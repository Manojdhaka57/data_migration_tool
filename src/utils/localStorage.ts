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
