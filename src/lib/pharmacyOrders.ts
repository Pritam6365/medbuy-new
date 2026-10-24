import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  getErrorMessage,
  getIncomingOrders,
  getMyOrders,
  type ApiPharmacyOrder,
} from './api';

import {
  formatDayTime,
  formatKm,
  formatRupees,
  parseApiDate,
  pluralItems,
  shortId,
  timeAgo,
  toNumber,
} from './format';

/* ============================================================
   UI SHAPES
   These match what the existing screens were built around, so the
   screens only swap their mock arrays for these lists.
   ============================================================ */

export type UiOrderStatus = 'new' | 'ongoing' | 'completed' | 'cancelled';

export type UiOrder = {
  /** Visible order number, e.g. "#4F9A1C". */
  id: string;
  /** Real order id – used for API calls and screen navigation. */
  apiId: string;
  customer: string;
  items: string;
  distance: string;
  time: string;
  totalItems: number;
  medicineNames: string[];
  status: UiOrderStatus;
};

export type UiOrderDetail = {
  id: string;
  apiId: string;
  customer: string;
  phone: string;
  address: string;
  distance: string;
  status: UiOrderStatus;
  placedAt: string;
  items: { name: string; strength: string; quantity: number }[];
  totalItems: number;
  deliveryAgent?: string;
  agentPhone?: string;
};

export type UiHistoryOrder = {
  id: string;
  apiId: string;
  customer: string;
  items: number;
  amount: string;
  distance: string;
  completedAt: string;
  deliveryAgent: string;
  orderName: string;
  completedTs: number;
};

/* ============================================================
   MAPPERS
   ============================================================ */

function mapStatus(apiStatus: string): UiOrderStatus {
  switch (apiStatus) {
    case 'pending':
    case 'broadcasted':
      return 'new';

    case 'delivered':
      return 'completed';

    case 'cancelled':
    case 'rejected':
      return 'cancelled';

    /* accepted_by_pharmacy, packed, agent_assigned, out_for_delivery */
    default:
      return 'ongoing';
  }
}

function totalQuantity(order: ApiPharmacyOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/*
 * The CureBuddy API intentionally never shows a pharmacy the customer's
 * name, phone number or street address – only an approximate location.
 */
function customerLabel(apiId: string): string {
  return `Customer ${shortId(apiId).slice(-4)}`;
}

export function toUiOrder(order: ApiPharmacyOrder): UiOrder {
  const total = totalQuantity(order);

  return {
    id: shortId(order.id),
    apiId: order.id,
    customer: customerLabel(order.id),
    items: pluralItems(total),
    distance: formatKm(order.distance_km),
    time: timeAgo(order.created_at),
    totalItems: total,
    medicineNames: order.items.map((item) => item.name),
    status: mapStatus(order.status),
  };
}

/** New (incoming) orders first, then the pharmacy's own orders, newest first. */
export function toUiOrders(
  incoming: ApiPharmacyOrder[],
  mine: ApiPharmacyOrder[]
): UiOrder[] {
  const seen = new Set<string>();

  const merged: ApiPharmacyOrder[] = [];

  [...incoming, ...mine].forEach((order) => {
    if (!seen.has(order.id)) {
      seen.add(order.id);
      merged.push(order);
    }
  });

  return merged.map(toUiOrder);
}

export function toUiOrderDetail(order: ApiPharmacyOrder): UiOrderDetail {
  const lat = order.approx_delivery_latitude;
  const lon = order.approx_delivery_longitude;

  return {
    id: shortId(order.id),
    apiId: order.id,
    customer: customerLabel(order.id),
    phone: 'Shared with the delivery partner',
    address:
      lat !== null && lon !== null
        ? `Approx. location ${lat.toFixed(3)}, ${lon.toFixed(3)}`
        : 'Approximate location only',
    distance: formatKm(order.distance_km),
    status: mapStatus(order.status),
    placedAt: formatDayTime(order.created_at),
    items: order.items.map((item) => ({
      name: item.name,
      strength: item.is_custom ? 'Custom item' : '',
      quantity: item.quantity,
    })),
    totalItems: totalQuantity(order),
  };
}

export function toUiHistory(mine: ApiPharmacyOrder[]): UiHistoryOrder[] {
  return mine
    .filter((order) => order.status === 'delivered')
    .map((order) => {
      const date = parseApiDate(order.created_at);

      return {
        id: shortId(order.id),
        apiId: order.id,
        customer: customerLabel(order.id),
        items: totalQuantity(order),
        amount: formatRupees(order.subtotal),
        distance: formatKm(order.distance_km),
        /* The API exposes the order time, not a separate delivery time. */
        completedAt: formatDayTime(order.created_at),
        deliveryAgent: 'Delivery partner',
        orderName: order.items.map((item) => item.name).join(', '),
        completedTs: date ? date.getTime() : 0,
      };
    });
}

export function countByStatus(orders: UiOrder[]) {
  return {
    newCount: orders.filter((o) => o.status === 'new').length,
    ongoingCount: orders.filter((o) => o.status === 'ongoing').length,
    completedCount: orders.filter((o) => o.status === 'completed').length,
  };
}

/* ============================================================
   PICKUP CODES
   The server keeps only a hash of the pickup code, so it is shown once
   at acceptance. It is remembered on this device so the pharmacy can
   read it again from the order screen.
   ============================================================ */

const pickupKey = (apiId: string) => `medbuy_pickup_otp_${apiId}`;

export async function savePickupCode(apiId: string, code: string) {
  try {
    await AsyncStorage.setItem(pickupKey(apiId), code);
  } catch {
    // Non-critical.
  }
}

export async function loadPickupCode(apiId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(pickupKey(apiId));
  } catch {
    return null;
  }
}

/* ============================================================
   HOOK
   Loads new + own orders on screen focus and keeps them fresh by
   polling (push notifications are not wired into the app yet).
   ============================================================ */

export function usePharmacyOrders(pollMs = 15000) {
  const [incoming, setIncoming] = useState<ApiPharmacyOrder[]>([]);
  const [mine, setMine] = useState<ApiPharmacyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [inc, own] = await Promise.all([
        getIncomingOrders(),
        getMyOrders(false),
      ]);

      setIncoming(inc.items);
      setMine(own.items);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();

      if (!pollMs) {
        return undefined;
      }

      const timer = setInterval(refresh, pollMs);

      return () => clearInterval(timer);
    }, [refresh, pollMs])
  );

  return { incoming, mine, loading, error, refresh };
}

export { toNumber };
