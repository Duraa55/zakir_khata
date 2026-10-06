import React, { useEffect, useState, useCallback } from 'react';
import { statusLabel } from '../../i18n/categoryLabel';
import type { TKey } from '../../i18n/en';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/usePurchaseStore';
import { formatCurrency } from '../../utils/calculations';
import { PurchaseOrderItem, POStatus } from '../../types/purchase.types';
import { Icon, AmountText, Button, IconName } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

const STATUS_ACTIONS: { from: POStatus[]; to: POStatus; labelKey: TKey; icon: IconName }[] = [
  { from: ['draft'], to: 'sent', labelKey: 'poMarkSent', icon: 'send' },
  { from: ['sent', 'partial'], to: 'received', labelKey: 'poMarkReceived', icon: 'check-circle' },
  { from: ['draft', 'sent', 'partial'], to: 'cancelled', labelKey: 'poCancelOrder', icon: 'x-circle' },
];

// Status carries meaning only: waiting on something is amber, settled is ink, inactive is muted.
const STATUS_TONE: Record<string, string> = {
  draft: color.textMuted, sent: color.attention, partial: color.attention,
  received: color.textPrimary, cancelled: color.textMuted,
};

export const PurchaseOrderDetailScreen = ({ navigation, route }: any) => {
  const { orderId } = route.params;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { selectedOrder: order, loading, loadOrderById, updateOrderStatus, receiveGoods } = usePurchaseStore();

  const load = useCallback(() => loadOrderById(orderId), [orderId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const handleStatusChange = (to: POStatus) => {
    const key = STATUS_ACTIONS.find(a => a.to === to)?.labelKey;
    const label = key ? t(key) : t('poUpdate');
    Alert.alert(t('poConfirmTitle'), t('poConfirmBody', { action: label }), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('poConfirmTitle'),
        onPress: async () => {
          await updateOrderStatus(orderId, user!.id, to);
          await load();
        }
      }
    ]);
  };

  const handleCreateInvoice = () => {
    if (!order) return;
    navigation.navigate('CreatePurchaseInvoice', {
      supplierId: order.supplier_id,
      supplierName: order.supplier_name,
      poId: order.id,
      items: order.items,
    });
  };

  if (loading || !order) {
    return <View style={styles.center}><ActivityIndicator size="large" color={color.accent} /></View>;
  }

  const availableActions = STATUS_ACTIONS.filter(a => a.from.includes(order.status));
  const totalReceived = order.items?.reduce((s, i) => s + (i.received_qty * i.unit_cost), 0) ?? 0;

  const StatusBadge = ({ status }: { status: string }) => {
    const tone = STATUS_TONE[status] ?? color.textMuted;
    return (
      <View style={[styles.badge, { borderColor: tone }]}>
        <Text style={[styles.badgeText, { color: tone }]}>{statusLabel(t, status)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>PO-{String(order.po_number).padStart(4, '0')}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{order.supplier_name}</Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Meta */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>{t('poOrderDate')}</Text>
              <Text style={styles.metaVal}>{order.order_date}</Text>
            </View>
            {order.expected_date && (
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>{t('poExpectedDateLabel')}</Text>
                <Text style={styles.metaVal}>{order.expected_date}</Text>
              </View>
            )}
            <View style={styles.metaColEnd}>
              <Text style={styles.metaLabel}>{t('poTotalValue')}</Text>
              <AmountText currency={order.currency} paisa={order.total} />
            </View>
          </View>
          {order.notes && (
            <View style={styles.notesRow}>
              <Icon name="file-text" size={iconSize.sm} tint={color.textSecondary} />
              <Text style={styles.notesText}>{order.notes}</Text>
            </View>
          )}
        </View>

        {/* Progress Bar */}
        {(order.status === 'partial' || order.status === 'received') && (
          <View style={styles.progressCard}>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressLabel}>{t('poReceived')}</Text>
              <Text style={styles.progressLabel}>{formatCurrency(totalReceived, order.currency)} / {formatCurrency(order.total, order.currency)}</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.min(100, (totalReceived / order.total) * 100)}%` }]} />
            </View>
          </View>
        )}

        {/* Items */}
        <View style={styles.itemsCard}>
          <Text style={styles.cardTitle}>{t('poOrderItems')}</Text>
          {(order.items ?? []).map((item: PurchaseOrderItem) => {
            const receivedPct = item.quantity > 0 ? (item.received_qty / item.quantity) * 100 : 0;
            const done = receivedPct >= 100;
            return (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.item_name}</Text>
                  <Text style={styles.itemDetail}>
                    Ordered: {item.quantity} × {formatCurrency(item.unit_cost, order.currency)} = {formatCurrency(item.line_total, order.currency)}
                  </Text>
                  <Text style={[styles.itemReceived, !done && styles.itemReceivedPending]}>
                    Received: {item.received_qty} / {item.quantity}
                  </Text>
                </View>
                <Icon
                  name={done ? 'check-circle' : receivedPct > 0 ? 'clock' : 'circle'}
                  size={iconSize.md}
                  tint={done ? color.textSecondary : receivedPct > 0 ? color.attention : color.textMuted}
                />
              </View>
            );
          })}
        </View>

        {/* Action Buttons */}
        {availableActions.length > 0 && (
          <View style={styles.actionsCard}>
            <Text style={styles.cardTitle}>{t('poActions')}</Text>
            {availableActions.map(action => (
              <Button
                key={action.to}
                label={t(action.labelKey)}
                icon={action.icon}
                variant="secondary"
                fullWidth
                onPress={() => handleStatusChange(action.to)}
                style={styles.actionBtn}
              />
            ))}
            {(order.status === 'sent' || order.status === 'partial') && (
              <Button
                label={t('poReceiveGoods')}
                icon="package"
                variant="secondary"
                fullWidth
                onPress={() => navigation.navigate('ReceiveGoods', { orderId: order.id, items: order.items, currency: order.currency })}
                style={styles.actionBtn}
              />
            )}
            {order.status !== 'cancelled' && (
              <Button
                label={t('poCreateInvoiceFromOrder')}
                icon="file-text"
                fullWidth
                onPress={handleCreateInvoice}
                style={styles.actionBtn}
              />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 56, paddingVertical: space.sm,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  headerSub: { ...typeScale.caption, color: color.textSecondary },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: hairline },
  badgeText: { ...typeScale.caption },
  scroll: { paddingBottom: 135 },
  metaCard: { backgroundColor: color.surface, margin: space.lg, borderRadius: radius.lg, padding: space.lg, borderWidth: hairline, borderColor: color.border },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  metaCol: { flex: 1 },
  metaColEnd: { alignItems: 'flex-end', flexShrink: 0 },
  metaLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: 2 },
  metaVal: { ...typeScale.bodyMedium, color: color.textPrimary },
  notesRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.md },
  notesText: { ...typeScale.label, flex: 1, color: color.textSecondary },
  progressCard: { backgroundColor: color.surface, marginHorizontal: space.lg, marginBottom: space.md, borderRadius: radius.lg, padding: space.lg, borderWidth: hairline, borderColor: color.border },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, marginBottom: space.sm },
  progressLabel: { ...typeScale.label, color: color.textSecondary },
  progressBar: { height: 8, backgroundColor: color.surfaceRaised, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: color.accent, borderRadius: radius.pill },
  itemsCard: { backgroundColor: color.surface, marginHorizontal: space.lg, marginBottom: space.md, borderRadius: radius.lg, padding: space.lg, borderWidth: hairline, borderColor: color.border },
  cardTitle: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: hairline, borderBottomColor: color.border },
  itemInfo: { flex: 1 },
  itemName: { ...typeScale.bodyMedium, color: color.textPrimary },
  itemDetail: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  itemReceived: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  itemReceivedPending: { color: color.attention },
  actionsCard: { backgroundColor: color.surface, marginHorizontal: space.lg, marginBottom: space.md, borderRadius: radius.lg, padding: space.lg, borderWidth: hairline, borderColor: color.border },
  actionBtn: { marginBottom: space.sm },
});
