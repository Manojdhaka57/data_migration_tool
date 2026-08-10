/** Data access for application users. */
import { appQuery, appQueryOne } from '../db';
import { hashPassword, AuthUser, UserRole } from '../auth';

export interface UserRecord extends AuthUser {
  created_at: Date;
  updated_at: Date;
}

export async function listUsers(): Promise<UserRecord[]> {
  return appQuery<UserRecord>(
    `SELECT id, username, email, role, is_active, created_at, updated_at
       FROM app_user ORDER BY username`,
  );
}

export async function findUserByUsername(
  username: string,
): Promise<(UserRecord & { password_hash: string }) | null> {
  return appQueryOne(
    `SELECT id, username, email, role, is_active, password_hash, created_at, updated_at
       FROM app_user WHERE lower(username) = lower($1)`,
    [username],
  );
}

export async function countUsers(): Promise<number> {
  const row = await appQueryOne<{ n: string }>('SELECT count(*) AS n FROM app_user');
  return parseInt(row?.n ?? '0', 10);
}

export async function createUser(input: {
  username: string;
  password: string;
  email?: string | null;
  role?: UserRole;
}): Promise<UserRecord> {
  const passwordHash = await hashPassword(input.password);
  const rows = await appQuery<UserRecord>(
    `INSERT INTO app_user (username, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, role, is_active, created_at, updated_at`,
    [input.username, input.email ?? null, passwordHash, input.role ?? 'operator'],
  );
  return rows[0];
}

export async function setUserPassword(userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await appQuery(
    'UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1',
    [userId, passwordHash],
  );
}

export async function setUserActive(userId: number, isActive: boolean): Promise<void> {
  await appQuery('UPDATE app_user SET is_active = $2, updated_at = now() WHERE id = $1', [
    userId,
    isActive,
  ]);
  // Deactivating must take effect immediately, not at session expiry.
  if (!isActive) {
    await appQuery('DELETE FROM app_session WHERE user_id = $1', [userId]);
  }
}
