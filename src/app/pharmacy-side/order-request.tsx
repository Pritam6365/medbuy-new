import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ApiError,
  acceptOrder,
  getErrorMessage,
  markOrderPacked,
  rejectOrder,
} from '@/lib/api';

import { AUTO_MARK_PACKED } from '@/lib/config';

import {
  loadPickupCode,
  savePickupCode,
  toUiOrderDetail,
  usePharmacyOrders,
  type UiOrderDetail,
  type UiOrderStatus as OrderStatus,
} from '@/lib/pharmacyOrders';

/* =========================================================
   Orders are loaded from the CureBuddy API (no mock data).
   Types come from '@/lib/pharmacyOrders'.
========================================================= */

/* Shown only for the instant before the order has loaded. */
const EMPTY_ORDER: UiOrderDetail = {
  id: '',
  apiId: '',
  customer: '',
  phone: '',
  address: '',
  distance: '',
  status: 'new',
  placedAt: '',
  items: [],
  totalItems: 0,
};

/* =========================================================
   SCREEN
========================================================= */

export default function OrderRequestScreen() {
  const params = useLocalSearchParams<{
    orderId?: string;
    source?: string;
  }>();

  const rawOrderId = Array.isArray(params.orderId)
    ? params.orderId[0]
    : params.orderId;

  const orderId = rawOrderId ?? '';

  const { incoming, mine, loading, error, refresh } =
    usePharmacyOrders(0);

  const apiOrder = useMemo(
    () =>
      [...incoming, ...mine].find(
        (candidate) => candidate.id === orderId
      ),
    [incoming, mine, orderId]
  );

  const order: UiOrderDetail = useMemo(
    () =>
      apiOrder
        ? toUiOrderDetail(apiOrder)
        : EMPTY_ORDER,
    [apiOrder]
  );

  const [pickupCode, setPickupCode] =
    useState<string | null>(null);

  /* =======================================================
     STATE
  ======================================================= */

  const [actionLoading, setActionLoading] =
    useState(false);

  const [currentStatus, setCurrentStatus] =
    useState<OrderStatus>(order.status);

  useEffect(() => {
    if (apiOrder) {
      setCurrentStatus(order.status);
    }
  }, [apiOrder, order.status]);

  /* The pickup code is shown once when accepting; it is remembered here. */
  useEffect(() => {
    if (!order.apiId) return;

    loadPickupCode(order.apiId).then(setPickupCode);
  }, [order.apiId]);

  /* Order missing (taken by another pharmacy, cancelled, or load failed). */
  useEffect(() => {
    if (loading || apiOrder || !orderId) return;

    Alert.alert(
      error ? 'Unable to load order' : 'Order unavailable',
      error ||
        'This order is no longer available.',
      [
        {
          text: 'OK',
          onPress: () =>
            router.replace('/pharmacy-side/home'),
        },
      ]
    );
  }, [loading, apiOrder, orderId, error]);

  /* =======================================================
     ANIMATION
  ======================================================= */

  const screenAnim = useRef(
    new Animated.Value(0)
  ).current;

  const contentAnim = useRef(
    new Animated.Value(0)
  ).current;

  useEffect(() => {
    Animated.stagger(80, [
      Animated.timing(screenAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),

      Animated.timing(contentAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  /* =======================================================
     HELPERS
  ======================================================= */

  const statusLabel = () => {
    if (currentStatus === 'new') return 'New Order';

    if (currentStatus === 'ongoing')
      return 'Ongoing';

    if (currentStatus === 'cancelled')
      return 'Cancelled';

    return 'Completed';
  };

  const statusColor = () => {
    if (currentStatus === 'new')
      return '#9A4B23';

    if (currentStatus === 'ongoing')
      return '#2A5A96';

    if (currentStatus === 'cancelled')
      return '#A82520';

    return '#1F6B45';
  };

  const statusBackground = () => {
    if (currentStatus === 'new')
      return '#F6E6DC';

    if (currentStatus === 'ongoing')
      return '#EAF0F8';

    if (currentStatus === 'cancelled')
      return '#F6DEDC';

    return '#E8F3ED';
  };

  /* =======================================================
     ACCEPT ORDER
  ======================================================= */

  const handleAccept = async () => {
    if (actionLoading || !order.apiId) return;

    setActionLoading(true);

    try {
      const accepted = await acceptOrder(order.apiId);

      /* The server stores only a hash of the pickup code, so keep it here. */
      await savePickupCode(order.apiId, accepted.pickup_otp);
      setPickupCode(accepted.pickup_otp);

      if (AUTO_MARK_PACKED) {
        try {
          await markOrderPacked(order.apiId);
        } catch (packError) {
          Alert.alert(
            'Order accepted',
            `Could not release the order to delivery partners yet: ${getErrorMessage(packError)}`
          );
        }
      }

      setCurrentStatus('ongoing');
      refresh();

      Alert.alert(
        'Order accepted',
        `Pickup code: ${accepted.pickup_otp}\n\nGive this code to the delivery partner when they collect the order.`
      );
    } catch (acceptError) {
      const taken =
        acceptError instanceof ApiError &&
        (acceptError.status === 409 || acceptError.status === 404);

      Alert.alert(
        'Unable to accept order',
        getErrorMessage(acceptError),
        taken
          ? [
              {
                text: 'OK',
                onPress: () =>
                  router.replace('/pharmacy-side/home'),
              },
            ]
          : undefined
      );
    } finally {
      setActionLoading(false);
    }
  };

  /* =======================================================
     DECLINE ORDER
  ======================================================= */

  const handleDecline = async () => {
    if (actionLoading || !order.apiId) return;

    setActionLoading(true);

    try {
      await rejectOrder(order.apiId);

      router.replace('/pharmacy-side/home');
    } catch (declineError) {
      Alert.alert(
        'Unable to decline order',
        getErrorMessage(declineError)
      );
    } finally {
      setActionLoading(false);
    }
  };

  /* =======================================================
     BACK
  ======================================================= */

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/pharmacy-side/orders');
    }
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* =================================================
            HEADER
        ================================================= */}

        <Animated.View
          style={[
            styles.header,
            {
              opacity: screenAnim,
              transform: [
                {
                  translateY:
                    screenAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-8, 0],
                    }),
                },
              ],
            },
          ]}
        >
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressedButton,
            ]}
            hitSlop={8}
          >
            <Ionicons
              name="arrow-back"
              size={21}
              color="#1A1512"
            />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>
              Order Details
            </Text>

            <Text style={styles.headerOrderId}>
              {order.id}
            </Text>
          </View>

          <View style={styles.headerSpacer} />
        </Animated.View>

        {/* =================================================
            CONTENT
        ================================================= */}

        <Animated.View
          style={[
            styles.content,
            {
              opacity: contentAnim,
              transform: [
                {
                  translateY:
                    contentAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                },
              ],
            },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={
              styles.scrollContent
            }
          >
            {/* =================================================
                ORDER STATUS
            ================================================= */}

            <View style={styles.statusCard}>
              <View
                style={[
                  styles.statusIcon,
                  {
                    backgroundColor:
                      statusBackground(),
                  },
                ]}
              >
                <Ionicons
                  name={
                    currentStatus === 'completed'
                      ? 'checkmark'
                      : currentStatus ===
                        'ongoing'
                        ? 'sync-outline'
                        : 'receipt-outline'
                  }
                  size={22}
                  color={statusColor()}
                />
              </View>

              <View style={styles.statusInfo}>
                <Text style={styles.statusLabel}>
                  {statusLabel()}
                </Text>

                <Text style={styles.statusSubtext}>
                  Placed {order.placedAt}
                </Text>
              </View>

              <View
                style={[
                  styles.statusPill,
                  {
                    backgroundColor:
                      statusBackground(),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    {
                      color: statusColor(),
                    },
                  ]}
                >
                  {currentStatus === 'new'
                    ? 'Action Required'
                    : currentStatus ===
                      'ongoing'
                      ? 'In Progress'
                      : currentStatus ===
                        'cancelled'
                        ? 'Cancelled'
                        : 'Delivered'}
                </Text>
              </View>
            </View>

            {/* =================================================
                CUSTOMER
            ================================================= */}

            <Text style={styles.sectionTitle}>
              Customer
            </Text>

            <View style={styles.card}>
              <View style={styles.customerTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {order.customer
                      .split(' ')
                      .map((name) =>
                        name[0]
                      )
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>

                <View style={styles.customerInfo}>
                  <Text style={styles.customerName}>
                    {order.customer}
                  </Text>

                  <Text style={styles.customerPhone}>
                    {order.phone}
                  </Text>
                </View>

                <Pressable
                  style={styles.callButton}
                  onPress={() => { }}
                >
                  <Ionicons
                    name="call-outline"
                    size={19}
                    color="#9A4B23"
                  />
                </Pressable>
              </View>

              <View style={styles.innerDivider} />

              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color="#5C534C"
                  />
                </View>

                <View style={styles.infoTextWrap}>
                  <Text style={styles.infoLabel}>
                    Delivery Address
                  </Text>

                  <Text style={styles.infoValue}>
                    {order.address}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons
                    name="navigate-outline"
                    size={18}
                    color="#5C534C"
                  />
                </View>

                <View style={styles.infoTextWrap}>
                  <Text style={styles.infoLabel}>
                    Distance
                  </Text>

                  <Text style={styles.infoValue}>
                    {order.distance} from pharmacy
                  </Text>
                </View>
              </View>
            </View>

            {/* =================================================
                MEDICINES
            ================================================= */}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Medicines
              </Text>

              <Text style={styles.itemCount}>
                {order.totalItems}{' '}
                {order.totalItems === 1
                  ? 'item'
                  : 'items'}
              </Text>
            </View>

            <View style={styles.card}>
              {order.items.map(
                (item, index) => (
                  <View
                    key={`${item.name}-${index}`}
                  >
                    <View
                      style={styles.medicineRow}
                    >
                      <View
                        style={
                          styles.medicineIcon
                        }
                      >
                        <Ionicons
                          name="medical-outline"
                          size={19}
                          color="#9A4B23"
                        />
                      </View>

                      <View
                        style={
                          styles.medicineInfo
                        }
                      >
                        <Text
                          style={
                            styles.medicineName
                          }
                        >
                          {item.name}
                        </Text>

                        <Text
                          style={
                            styles.medicineStrength
                          }
                        >
                          {item.strength}
                        </Text>
                      </View>

                      <View
                        style={
                          styles.quantityBox
                        }
                      >
                        <Text
                          style={
                            styles.quantityText
                          }
                        >
                          ×{item.quantity}
                        </Text>
                      </View>
                    </View>

                    {index <
                      order.items.length -
                      1 && (
                        <View
                          style={
                            styles.innerDivider
                          }
                        />
                      )}
                  </View>
                )
              )}
            </View>

            {/* =================================================
                DELIVERY AGENT
            ================================================= */}

            {order.deliveryAgent && (
              <>
                <Text style={styles.sectionTitle}>
                  Delivery Agent
                </Text>

                <View style={styles.card}>
                  <View
                    style={
                      styles.agentRow
                    }
                  >
                    <View
                      style={
                        styles.agentIcon
                      }
                    >
                      <Ionicons
                        name="bicycle-outline"
                        size={22}
                        color="#2A5A96"
                      />
                    </View>

                    <View
                      style={
                        styles.agentInfo
                      }
                    >
                      <Text
                        style={
                          styles.agentName
                        }
                      >
                        {order.deliveryAgent}
                      </Text>

                      <Text
                        style={
                          styles.agentPhone
                        }
                      >
                        {order.agentPhone}
                      </Text>
                    </View>

                    <View
                      style={
                        styles.assignedPill
                      }
                    >
                      <View
                        style={
                          styles.assignedDot
                        }
                      />

                      <Text
                        style={
                          styles.assignedText
                        }
                      >
                        Assigned
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}

            {/* =================================================
                ORDER INFORMATION
            ================================================= */}

            <Text style={styles.sectionTitle}>
              Order Information
            </Text>

            <View style={styles.card}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  Order ID
                </Text>

                <Text style={styles.detailValue}>
                  {order.id}
                </Text>
              </View>

              <View style={styles.innerDivider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  Placed
                </Text>

                <Text style={styles.detailValue}>
                  {order.placedAt}
                </Text>
              </View>

              <View style={styles.innerDivider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  Total Items
                </Text>

                <Text style={styles.detailValue}>
                  {order.totalItems}
                </Text>
              </View>

              <View style={styles.innerDivider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  Distance
                </Text>

                <Text style={styles.detailValue}>
                  {order.distance}
                </Text>
              </View>
            </View>

            {/* =================================================
                BOTTOM SPACE
            ================================================= */}

            <View style={{ height: 25 }} />
          </ScrollView>
        </Animated.View>

        {/* =================================================
            ACTIONS
        ================================================= */}

        {currentStatus === 'new' && (
          <View style={styles.bottomActions}>
            <Pressable
              onPress={handleDecline}
              disabled={actionLoading}
              style={({ pressed }) => [
                styles.declineButton,
                pressed &&
                !actionLoading &&
                styles.declinePressed,
                actionLoading &&
                styles.disabledButton,
              ]}
            >
              <Ionicons
                name="close-outline"
                size={20}
                color="#A82520"
              />

              <Text
                style={styles.declineText}
              >
                {actionLoading
                  ? 'Processing...'
                  : 'Decline'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleAccept}
              disabled={actionLoading}
              style={({ pressed }) => [
                styles.acceptButton,
                pressed &&
                !actionLoading &&
                styles.acceptPressed,
                actionLoading &&
                styles.disabledButton,
              ]}
            >
              <Ionicons
                name={
                  actionLoading
                    ? 'hourglass-outline'
                    : 'checkmark-circle-outline'
                }
                size={20}
                color="#FFFFFF"
              />

              <Text
                style={styles.acceptText}
              >
                {actionLoading
                  ? 'Accepting...'
                  : 'Accept Order'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* =================================================
            ONGOING ACTION
        ================================================= */}

        {currentStatus === 'ongoing' && (
          <View style={styles.bottomActions}>
            <View style={styles.ongoingButton}>
              <Ionicons
                name="sync-outline"
                size={20}
                color="#2A5A96"
              />

              <Text
                style={styles.ongoingText}
              >
                {pickupCode
                  ? `Order in Progress · Pickup code ${pickupCode}`
                  : 'Order in Progress'}
              </Text>
            </View>
          </View>
        )}

        {/* =================================================
            COMPLETED ACTION
        ================================================= */}

        {currentStatus === 'completed' && (
          <View style={styles.bottomActions}>
            <View style={styles.completedButton}>
              <Ionicons
                name="checkmark-circle"
                size={20}
                color="#1F6B45"
              />

              <Text
                style={styles.completedActionText}
              >
                Order Completed
              </Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F9F7F4',
  },

  container: {
    flex: 1,
    backgroundColor: '#F9F7F4',
  },

  /* =======================================================
     HEADER
  ======================================================= */

  header: {
    height: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9F7F4',
    borderBottomWidth: 1,
    borderBottomColor: '#E0D8CE',
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0D8CE',
    alignItems: 'center',
    justifyContent: 'center',
  },

  pressedButton: {
    transform: [{ scale: 0.96 }],
    opacity: 0.85,
  },

  headerCenter: {
    alignItems: 'center',
  },

  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1512',
  },

  headerOrderId: {
    marginTop: 2,
    fontSize: 11,
    color: '#6B615A',
  },

  headerSpacer: {
    width: 42,
  },

  /* =======================================================
     CONTENT
  ======================================================= */

  content: {
    flex: 1,
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },

  /* =======================================================
     STATUS
  ======================================================= */

  statusCard: {
    minHeight: 78,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0D8CE',
    flexDirection: 'row',
    alignItems: 'center',
  },

  statusIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },

  statusInfo: {
    flex: 1,
  },

  statusLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1512',
  },

  statusSubtext: {
    marginTop: 3,
    fontSize: 11,
    color: '#6B615A',
  },

  statusPill: {
    paddingHorizontal: 9,
    minHeight: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },

  statusPillText: {
    fontSize: 9,
    fontWeight: '600',
  },

  /* =======================================================
     SECTIONS
  ======================================================= */

  sectionTitle: {
    marginTop: 22,
    marginBottom: 9,
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1512',
  },

  sectionHeader: {
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  itemCount: {
    marginTop: 22,
    marginBottom: 9,
    fontSize: 11,
    color: '#6B615A',
  },

  /* =======================================================
     CARD
  ======================================================= */

  card: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0D8CE',
    padding: 15,
  },

  /* =======================================================
     CUSTOMER
  ======================================================= */

  customerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#F6E6DC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },

  avatarText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#9A4B23',
  },

  customerInfo: {
    flex: 1,
  },

  customerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1512',
  },

  customerPhone: {
    marginTop: 3,
    fontSize: 11,
    color: '#6B615A',
  },

  callButton: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#F6E6DC',
    alignItems: 'center',
    justifyContent: 'center',
  },

  innerDivider: {
    height: 1,
    backgroundColor: '#EEE9E3',
    marginVertical: 13,
  },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 3,
  },

  infoIcon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    backgroundColor: '#F1EDE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  infoTextWrap: {
    flex: 1,
  },

  infoLabel: {
    fontSize: 10,
    color: '#91877F',
  },

  infoValue: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: '#1A1512',
  },

  /* =======================================================
     MEDICINES
  ======================================================= */

  medicineRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
  },

  medicineIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#F6E6DC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  medicineInfo: {
    flex: 1,
  },

  medicineName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1512',
  },

  medicineStrength: {
    marginTop: 2,
    fontSize: 11,
    color: '#6B615A',
  },

  quantityBox: {
    minWidth: 42,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: '#F1EDE7',
    alignItems: 'center',
    justifyContent: 'center',
  },

  quantityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5C534C',
  },

  /* =======================================================
     DELIVERY AGENT
  ======================================================= */

  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  agentIcon: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: '#EAF0F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  agentInfo: {
    flex: 1,
  },

  agentName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1512',
  },

  agentPhone: {
    marginTop: 3,
    fontSize: 11,
    color: '#6B615A',
  },

  assignedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#E8F3ED',
  },

  assignedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1F6B45',
    marginRight: 5,
  },

  assignedText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#1F6B45',
  },

  /* =======================================================
     ORDER INFORMATION
  ======================================================= */

  detailRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  detailLabel: {
    fontSize: 12,
    color: '#6B615A',
  },

  detailValue: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1A1512',
  },

  /* =======================================================
     BOTTOM ACTIONS
  ======================================================= */

  bottomActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0D8CE',
    flexDirection: 'row',
    gap: 10,
  },

  declineButton: {
    height: 50,
    flex: 0.85,
    borderRadius: 12,
    backgroundColor: '#FAE1DF',
    borderWidth: 1,
    borderColor: '#E8C4C1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  declinePressed: {
    backgroundColor: '#F3D1CE',
    transform: [{ scale: 0.98 }],
  },

  declineText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#A82520',
  },

  acceptButton: {
    height: 50,
    flex: 1.35,
    borderRadius: 12,
    backgroundColor: '#9A4B23',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  acceptPressed: {
    backgroundColor: '#7B3A19',
    transform: [{ scale: 0.98 }],
  },

  acceptText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  disabledButton: {
    opacity: 0.6,
  },

  ongoingButton: {
    height: 50,
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#EAF0F8',
    borderWidth: 1,
    borderColor: '#D3DFEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  ongoingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2A5A96',
  },

  completedButton: {
    height: 50,
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#E8F3ED',
    borderWidth: 1,
    borderColor: '#D0E5D9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  completedActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F6B45',
  },
});