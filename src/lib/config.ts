/**
 * Central configuration for the CureBuddy API connection.
 *
 * Change the server address HERE (or set EXPO_PUBLIC_API_URL in a `.env`
 * file in the project root) – it is no longer hard-coded in every screen.
 *
 *   Real phone on the same Wi-Fi : http://<your PC's IPv4>:8000
 *   Android emulator             : http://10.0.2.2:8000
 *   Browser / iOS simulator      : http://localhost:8000
 *
 * Run `ipconfig` on your PC to get the current IPv4 address – it changes
 * whenever you switch Wi-Fi networks or reconnect to a hotspot.
 */
export const API_BASE_URL: string = (
  process.env.EXPO_PUBLIC_API_URL || 'http://10.26.78.79:8000'
).replace(/\/+$/, '');

export const API_PREFIX = '/api/v1';

export const REQUEST_TIMEOUT_MS = 15000;

/** Phone numbers typed without a country code are treated as Indian numbers. */
export const DEFAULT_COUNTRY_CODE = '+91';

/**
 * The pharmacy UI has no "Mark as packed" button, but the CureBuddy flow needs
 * that step before delivery partners can see an order. While true, accepting
 * an order also marks it packed straight away. Set to false once you add a
 * dedicated button that calls `markOrderPacked()`.
 */
export const AUTO_MARK_PACKED = true;

/**
 * The CureBuddy API requires a few profile fields that the current signup
 * screens do not collect yet. Until real input fields exist, these
 * clearly-marked placeholders are sent so that onboarding succeeds.
 *
 * Coordinates default to Bhubaneswar (the same area as the API's seed data)
 * so test orders placed near there reach your pharmacy.
 *
 * !! Replace these with real values (license number, GPS location, address,
 * !! vehicle details) before going live – orders are matched by location.
 */
export const ONBOARDING_PLACEHOLDERS = {
  pharmacyLatitude: 20.4625,
  pharmacyLongitude: 85.8828,
  agentVehicleType: 'motorcycle',
};
