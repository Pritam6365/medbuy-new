import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Session storage.
 *
 * The session is stored under the SAME key (`medbuy_user`) and with the SAME
 * field names the existing screens already read (name, storeName, email,
 * phone, role, token, id). That is why the splash router, profile screens and
 * both logout buttons keep working without any changes.
 *
 * `role` stays 'pharmacy' | 'delivery_agent' (UI naming). The API's own role
 * name ('agent') is kept separately in `apiRole`.
 */

export const SESSION_KEY = 'medbuy_user';
export const PENDING_SIGNUP_KEY = 'medbuy_pending_signup';

export type UiRole = 'pharmacy' | 'delivery_agent';

export type StoredUser = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: UiRole;
  apiRole: 'pharmacy' | 'agent';
  token: string;
  tokenExpiresAt: number;
  storeName?: string;
  pharmacyId?: string;
  agentId?: string;
  isVerified?: boolean;
  profilePhotoUri?: string | null;
};

/** Details typed on the signup screen, kept until the OTP is verified. */
export type PendingSignup = {
  role: UiRole;
  name: string;
  storeName?: string;
  email: string;
  phone: string;
  profilePhotoUri?: string | null;
};

export async function getSession(): Promise<StoredUser | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    return parsed && typeof parsed === 'object'
      ? (parsed as StoredUser)
      : null;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  const session = await getSession();

  return session?.token ?? null;
}

export async function saveSession(user: StoredUser): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

/** Merge new fields into the stored session (no-op when logged out). */
export async function updateSession(
  patch: Partial<StoredUser>
): Promise<void> {
  const current = await getSession();

  if (!current) {
    return;
  }

  await saveSession({ ...current, ...patch });
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([
    SESSION_KEY,
    PENDING_SIGNUP_KEY,
    'medbuy_token',
  ]);
}

export async function savePendingSignup(
  pending: PendingSignup
): Promise<void> {
  await AsyncStorage.setItem(
    PENDING_SIGNUP_KEY,
    JSON.stringify(pending)
  );
}

export async function getPendingSignup(): Promise<PendingSignup | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SIGNUP_KEY);

    return raw ? (JSON.parse(raw) as PendingSignup) : null;
  } catch {
    return null;
  }
}

export async function clearPendingSignup(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_SIGNUP_KEY);
}
