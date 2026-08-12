/**
 * The rule that stops one user inheriting another's cached work.
 *
 * Clearing on sign-out alone was not enough: a session can also end by token
 * expiry, a closed tab or a crash, none of which run the sign-out handler.
 * These tests pin the behaviour that covers all of them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// A minimal localStorage, since the test environment is node.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null;
  }
}

vi.stubGlobal('localStorage', new MemoryStorage());

const { clearAllUserData, getDataOwner, setDataOwner, isDataOwnedByAnotherUser, STORAGE_KEYS } =
  await import('./localStorage');

beforeEach(() => {
  localStorage.clear();
});

/** Stand-in for a user having worked in this browser. */
function seedUserData(owner: string | null) {
  localStorage.setItem(STORAGE_KEYS.MAPPING_CONFIG, JSON.stringify({ tableMappings: [{}, {}] }));
  localStorage.setItem('erp_migration_active_configuration', JSON.stringify({ configurationId: 8 }));
  localStorage.setItem('erp_migration_connection_config', JSON.stringify({ source: {} }));
  if (owner) setDataOwner(owner);
}

describe('isDataOwnedByAnotherUser', () => {
  it('is false for the user who owns the cache', () => {
    seedUserData('alice');
    expect(isDataOwnedByAnotherUser('alice')).toBe(false);
  });

  it('is TRUE when a different user signs in — the reported bug', () => {
    seedUserData('alice');
    expect(isDataOwnedByAnotherUser('admin')).toBe(true);
  });

  it('is true for unstamped data, so a pre-existing cache is not trusted', () => {
    // Data written before this check existed has no owner. Inheriting it would
    // be exactly the bug, so an absent stamp counts as somebody else's.
    seedUserData(null);
    expect(isDataOwnedByAnotherUser('admin')).toBe(true);
  });

  it('is false on a genuinely empty browser', () => {
    expect(isDataOwnedByAnotherUser('admin')).toBe(false);
  });

  it('ignores app-level settings when deciding whether data exists', () => {
    // The help-guide flag and the sidebar fold state belong to the browser, not
    // to a user, and must not trigger a wipe on a first-ever sign-in.
    localStorage.setItem('erp_migration_seen_guide', 'true');
    localStorage.setItem('erp_migration_sidebar_sections', '{}');
    expect(isDataOwnedByAnotherUser('admin')).toBe(false);
  });
});

describe('clearAllUserData', () => {
  it('removes mappings, the active configuration pointer and the owner stamp', () => {
    seedUserData('alice');
    const cleared = clearAllUserData();

    expect(localStorage.getItem(STORAGE_KEYS.MAPPING_CONFIG)).toBeNull();
    expect(localStorage.getItem('erp_migration_active_configuration')).toBeNull();
    expect(getDataOwner()).toBeNull();
    expect(cleared).toContain('erp_migration_active_configuration');
  });

  it('removes the stored connection settings, which hold plaintext passwords', () => {
    seedUserData('alice');
    clearAllUserData();
    expect(localStorage.getItem('erp_migration_connection_config')).toBeNull();
  });

  it('keeps app-level settings that are not user-specific', () => {
    seedUserData('alice');
    localStorage.setItem('erp_migration_seen_guide', 'true');
    localStorage.setItem('erp_migration_sidebar_sections', '{"tools":true}');

    clearAllUserData();

    expect(localStorage.getItem('erp_migration_seen_guide')).toBe('true');
    expect(localStorage.getItem('erp_migration_sidebar_sections')).toBe('{"tools":true}');
  });
});

describe('the sign-in sequence', () => {
  it('leaves nothing of user A behind when admin signs in', () => {
    seedUserData('alice');

    // What signIn does on a mismatch.
    if (isDataOwnedByAnotherUser('admin')) clearAllUserData();
    setDataOwner('admin');

    expect(localStorage.getItem(STORAGE_KEYS.MAPPING_CONFIG)).toBeNull();
    expect(localStorage.getItem('erp_migration_active_configuration')).toBeNull();
    expect(getDataOwner()).toBe('admin');
    expect(isDataOwnedByAnotherUser('admin')).toBe(false);
  });

  it('keeps the same user their own unsaved work across a re-login', () => {
    // A token expiring must not cost someone their draft.
    seedUserData('alice');
    if (isDataOwnedByAnotherUser('alice')) clearAllUserData();
    setDataOwner('alice');

    expect(localStorage.getItem(STORAGE_KEYS.MAPPING_CONFIG)).not.toBeNull();
  });
});
