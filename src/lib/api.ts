import { router } from 'expo-router';

import {
  API_BASE_URL,
  API_PREFIX,
  DEFAULT_COUNTRY_CODE,
  REQUEST_TIMEOUT_MS,
} from './config';

import { clearSession, getToken } from './session';

/* ============================================================
   ERRORS
   ============================================================ */

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, any>;

  constructor(
    message: string,
    status = 0,
    code = 'UNKNOWN',
    details: Record<string, any> = {}
  ) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Friendly text for any thrown value – safe to show in the UI. */
export function getErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

/* ============================================================
   PHONE NUMBERS
   The API only accepts E.164 (+919876543210); the screens let the
   user type a plain 10-digit number.
   ============================================================ */

export function toE164(input: string): string {
  const trimmed = (input || '').trim();
  let digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    return `${DEFAULT_COUNTRY_CODE}${digits}`;
  }

  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/* ============================================================
   TYPES (mirror api/app/schemas.py)
   ============================================================ */

export type ApiRole = 'consumer' | 'pharmacy' | 'agent' | 'admin';

export type ApiUser = {
  id: string;
  role: ApiRole | null;
  full_name: string | null;
  phone_masked: string;
};

export type ApiPharmacy = {
  id: string;
  name: string;
  license_number: string;
  latitude: number;
  longitude: number;
  address: string;
  is_online: boolean;
  is_verified: boolean;
};

export type ApiAgent = {
  id: string;
  vehicle_type: string;
  vehicle_number: string;
  is_online: boolean;
  is_busy: boolean;
};

export type OtpSendResponse = {
  message: string;
  expires_in: number;
  /** Only present when the server runs in local/mock mode. */
  dev_otp: string | null;
};

export type TokenResponse = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  is_new_user: boolean;
  user: ApiUser;
};

export type OnboardResponse = TokenResponse & {
  pharmacy: ApiPharmacy | null;
  agent: ApiAgent | null;
};

export type MeResponse = {
  user: ApiUser;
  pharmacy: ApiPharmacy | null;
  agent: ApiAgent | null;
};

export type ApiOrderItem = {
  id: string;
  medicine_id: string | null;
  name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  prescription_required: boolean;
  is_custom: boolean;
};

/** Pharmacy view of an order (no customer identity or street address). */
export type ApiPharmacyOrder = {
  id: string;
  status: string;
  distance_km: number | null;
  approx_delivery_latitude: number | null;
  approx_delivery_longitude: number | null;
  subtotal: string | number;
  requires_prescription: boolean;
  items: ApiOrderItem[];
  created_at: string;
};

export type PharmacyOrderList = { items: ApiPharmacyOrder[] };

export type PickupOtpResponse = {
  order: ApiPharmacyOrder;
  pickup_otp: string;
  message: string;
};

export type MarkPackedResponse = {
  order: ApiPharmacyOrder;
  agents_notified: number;
};

export type ApiPharmacySummary = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

export type ApiAgentAvailableOrder = {
  id: string;
  status: string;
  pharmacy: ApiPharmacySummary;
  distance_to_pharmacy_km: number;
  pharmacy_to_delivery_km: number;
  delivery_fee: string | number;
  item_count: number;
  created_at: string;
};

export type ApiAgentOrder = {
  id: string;
  status: string;
  pharmacy: ApiPharmacySummary;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  customer_label: string;
  item_count: number;
  delivery_fee: string | number;
  total_amount: string | number;
  created_at: string;
};

/* ============================================================
   CORE REQUEST HELPER
   ============================================================ */

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Send the logged-in user's token (default true). */
  auth?: boolean;
  /** Use this token instead of the stored session token. */
  token?: string;
  timeoutMs?: number;
};

const SESSION_LOST_CODES = new Set([
  'TOKEN_EXPIRED',
  'INVALID_TOKEN',
]);

function buildUrl(path: string, query?: RequestOptions['query']): string {
  let url = `${API_BASE_URL}${API_PREFIX}${path}`;

  if (query) {
    const parts: string[] = [];

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        parts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        );
      }
    });

    if (parts.length > 0) {
      url += `?${parts.join('&')}`;
    }
  }

  return url;
}

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    auth = true,
    token,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const usingStoredToken = auth && !token;
  const bearer = token || (auth ? await getToken() : null);

  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new ApiError(
        'The server took too long to respond. Please try again.',
        0,
        'TIMEOUT'
      );
    }

    throw new ApiError(
      'Unable to connect to the server. Please check your connection.',
      0,
      'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = data?.error;

    let message: string =
      err?.message || `Request failed (${response.status}).`;

    if (err?.code === 'VALIDATION_ERROR') {
      message = 'Some of the details entered are not valid. Please check and try again.';
    }

    const apiError = new ApiError(
      message,
      response.status,
      err?.code || 'HTTP_ERROR',
      err?.details || {}
    );

    /* Token expired or revoked: drop the session and restart login. */
    if (
      response.status === 401 &&
      usingStoredToken &&
      SESSION_LOST_CODES.has(apiError.code)
    ) {
      await clearSession();

      try {
        router.replace('/role-selection');
      } catch {
        // Navigation not ready; the next launch lands on role selection.
      }
    }

    throw apiError;
  }

  return data as T;
}

/* ============================================================
   AUTH & PROFILE
   ============================================================ */

export const sendOtp = (phoneE164: string) =>
  request<OtpSendResponse>('/auth/otp/send', {
    method: 'POST',
    body: { phone: phoneE164 },
    auth: false,
  });

export const verifyOtp = (phoneE164: string, otp: string) =>
  request<TokenResponse>('/auth/otp/verify', {
    method: 'POST',
    body: { phone: phoneE164, otp },
    auth: false,
  });

export const onboard = (
  token: string,
  body: {
    role: 'pharmacy' | 'agent';
    full_name: string;
    profile_details: Record<string, unknown>;
  }
) =>
  request<OnboardResponse>('/auth/onboard', {
    method: 'POST',
    body,
    token,
  });

export const getMe = (token?: string) =>
  request<MeResponse>('/me', { token });

export const registerFcmToken = (fcmToken: string) =>
  request<void>('/me/fcm-token', {
    method: 'PUT',
    body: { fcm_token: fcmToken },
  });

/* ============================================================
   PHARMACY
   ============================================================ */

export const setPharmacyOnline = (isOnline: boolean) =>
  request<ApiPharmacy>('/pharmacy/availability', {
    method: 'PATCH',
    body: { is_online: isOnline },
  });

/** Broadcast orders near this pharmacy that it has not rejected. */
export const getIncomingOrders = (limit = 50) =>
  request<PharmacyOrderList>('/pharmacy/orders/incoming', {
    query: { limit },
  });

/** Orders this pharmacy accepted (active_only=false includes finished ones). */
export const getMyOrders = (activeOnly = false, limit = 200) =>
  request<PharmacyOrderList>('/pharmacy/orders', {
    query: { active_only: activeOnly, limit },
  });

export const acceptOrder = (orderId: string) =>
  request<PickupOtpResponse>(`/pharmacy/orders/${orderId}/accept`, {
    method: 'POST',
  });

export const rejectOrder = (orderId: string, reason?: string) =>
  request<void>(`/pharmacy/orders/${orderId}/reject`, {
    method: 'POST',
    body: reason ? { reason } : {},
  });

export const markOrderPacked = (orderId: string) =>
  request<MarkPackedResponse>(`/pharmacy/orders/${orderId}/mark-packed`, {
    method: 'POST',
  });

/** Issues a NEW pickup code (only a hash is stored, so codes cannot be re-read). */
export const regeneratePickupOtp = (orderId: string) =>
  request<PickupOtpResponse>(
    `/pharmacy/orders/${orderId}/pickup-otp/regenerate`,
    { method: 'POST' }
  );

/* ============================================================
   DELIVERY AGENT
   The current delivery screens only use setAgentOnline(). The calls
   below are ready for when the active-delivery UI is added.
   ============================================================ */

export const setAgentOnline = (isOnline: boolean) =>
  request<ApiAgent>('/agent/availability', {
    method: 'PATCH',
    body: { is_online: isOnline },
  });

export const getAvailableDeliveries = (
  latitude?: number,
  longitude?: number
) =>
  request<{ items: ApiAgentAvailableOrder[] }>('/agent/orders/available', {
    query: { latitude, longitude },
  });

export const getCurrentDelivery = () =>
  request<ApiAgentOrder | null>('/agent/orders/current');

export const claimDelivery = (orderId: string) =>
  request<ApiAgentOrder>(`/agent/orders/${orderId}/claim`, {
    method: 'POST',
  });

export const pingLocation = (body: {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  order_id?: string;
}) =>
  request<{ accepted: boolean; next_ping_in_sec: number }>(
    '/agent/location/ping',
    { method: 'POST', body }
  );

export const verifyPickupOtp = (orderId: string, otp: string) =>
  request<ApiAgentOrder>(`/agent/orders/${orderId}/verify-pickup-otp`, {
    method: 'POST',
    body: { otp },
  });

export const verifyDeliveryOtp = (orderId: string, otp: string) =>
  request<ApiAgentOrder>(`/agent/orders/${orderId}/verify-delivery-otp`, {
    method: 'POST',
    body: { otp },
  });
