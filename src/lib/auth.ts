import {
  ApiError,
  getMe,
  isValidE164,
  onboard,
  sendOtp,
  toE164,
  verifyOtp,
  type ApiAgent,
  type ApiPharmacy,
} from './api';

import { ONBOARDING_PLACEHOLDERS } from './config';

import {
  clearPendingSignup,
  getPendingSignup,
  getSession,
  saveSession,
  type StoredUser,
  type UiRole,
} from './session';

/*
 * CureBuddy uses phone + OTP for both signup and login (no passwords):
 *
 *   1. requestOtp(phone)            -> server sends / issues an OTP
 *   2. completeOtp({ phone, otp })  -> verifies the OTP, then
 *        - existing account  : logs in
 *        - brand-new number  : creates the profile (/auth/onboard) using the
 *                              details typed on the signup screen
 */

const API_ROLE: Record<UiRole, 'pharmacy' | 'agent'> = {
  pharmacy: 'pharmacy',
  delivery_agent: 'agent',
};

const ROLE_LABEL: Record<UiRole, string> = {
  pharmacy: 'pharmacy',
  delivery_agent: 'delivery partner',
};

/* ------------------------------------------------------------
   Step 1 – ask the server to send an OTP
   ------------------------------------------------------------ */

export async function requestOtp(phoneInput: string): Promise<{
  phone: string;
  devOtp: string | null;
  expiresIn: number;
}> {
  const phone = toE164(phoneInput);

  if (!isValidE164(phone)) {
    throw new ApiError(
      'Please enter a valid mobile number.',
      0,
      'INVALID_PHONE'
    );
  }

  const res = await sendOtp(phone);

  return {
    phone,
    devOtp: res.dev_otp ?? null,
    expiresIn: res.expires_in,
  };
}

/* ------------------------------------------------------------
   Signup input checks the API enforces (so the user gets a clear
   message on the signup screen instead of a failure after the OTP)
   ------------------------------------------------------------ */

export function validateSignupFields(fields: {
  name: string;
  storeName?: string;
}): string | null {
  if (fields.name.trim().length < 2) {
    return 'Name must be at least 2 characters.';
  }

  if (fields.storeName !== undefined && fields.storeName.trim().length < 2) {
    return 'Store name must be at least 2 characters.';
  }

  return null;
}

/* ------------------------------------------------------------
   Step 2 – verify the OTP and create the local session
   ------------------------------------------------------------ */

export async function completeOtp(params: {
  phoneInput: string;
  otp: string;
  role: UiRole;
}): Promise<StoredUser> {
  const { phoneInput, otp, role } = params;

  const phone = toE164(phoneInput);

  const verified = await verifyOtp(phone, otp);

  const expectedApiRole = API_ROLE[role];

  let token = verified.access_token;
  let expiresIn = verified.expires_in;
  let displayName = verified.user.full_name ?? '';
  let pharmacy: ApiPharmacy | null = null;
  let agent: ApiAgent | null = null;

  const pending = await getPendingSignup();

  const pendingMatches =
    !!pending &&
    pending.role === role &&
    toE164(pending.phone) === phone;

  if (verified.is_new_user) {
    /* ---------- brand-new number: finish signup ---------- */

    if (!pendingMatches || !pending) {
      throw new ApiError(
        `No ${ROLE_LABEL[role]} account found for this number. Please create an account first.`,
        0,
        'NO_ACCOUNT'
      );
    }

    const digits = phone.replace(/\D/g, '');

    const profile_details =
      role === 'pharmacy'
        ? {
            name: (pending.storeName || '').trim(),
            license_number: `PENDING-${digits}`,
            latitude: ONBOARDING_PLACEHOLDERS.pharmacyLatitude,
            longitude: ONBOARDING_PLACEHOLDERS.pharmacyLongitude,
            address: `${(pending.storeName || '').trim()}, address not provided`,
          }
        : {
            vehicle_type: ONBOARDING_PLACEHOLDERS.agentVehicleType,
            vehicle_number: `PENDING-${digits.slice(-4)}`,
          };

    const created = await onboard(token, {
      role: expectedApiRole,
      full_name: pending.name.trim(),
      profile_details,
    });

    token = created.access_token;
    expiresIn = created.expires_in;
    displayName = created.user.full_name ?? pending.name;
    pharmacy = created.pharmacy;
    agent = created.agent;
  } else {
    /* ---------- existing account: log in ---------- */

    if (verified.user.role !== expectedApiRole) {
      const actual =
        verified.user.role === 'agent'
          ? 'delivery partner'
          : verified.user.role === 'pharmacy'
            ? 'pharmacy'
            : 'different type of';

      throw new ApiError(
        `This number is registered as a ${actual} account, not a ${ROLE_LABEL[role]} account.`,
        0,
        'ROLE_MISMATCH'
      );
    }

    const me = await getMe(token);

    pharmacy = me.pharmacy;
    agent = me.agent;
    displayName = me.user.full_name ?? displayName;
  }

  const previous = await getSession();

  const session: StoredUser = {
    id: verified.user.id,
    userId: verified.user.id,
    name: displayName || pending?.name || previous?.name || '',
    /* The API has no email field – it is only remembered on this device. */
    email: (pendingMatches ? pending?.email : previous?.email) || '',
    phone: (pendingMatches ? pending?.phone : previous?.phone) || phoneInput,
    role,
    apiRole: expectedApiRole,
    token,
    tokenExpiresAt: Date.now() + expiresIn * 1000,
    storeName:
      pharmacy?.name ||
      (pendingMatches ? pending?.storeName : previous?.storeName) ||
      undefined,
    pharmacyId: pharmacy?.id,
    agentId: agent?.id,
    isVerified: pharmacy?.is_verified,
    profilePhotoUri:
      (pendingMatches ? pending?.profilePhotoUri : previous?.profilePhotoUri) ??
      null,
  };

  await saveSession(session);
  await clearPendingSignup();

  return session;
}
