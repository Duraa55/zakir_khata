import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/usePurchaseStore';
import { PurchaseOrderItem } from '../../types/purchase.types';
import { formatCurrency } from '../../utils/calculations';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Icon, AmountText, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * Record goods arriving against an order. The data layer refuses more than is still
 * outstanding on a line and saves the lines, stock and order status in one go.
 */
export const ReceiveGoodsModal = ({ navigation, route }: any) => {
  // The ORDER's currency: a receipt is a figure of that order, not of this account.
  const { orderId, items = [], currency } = route.params as { orderId: string; items: PurchaseOrderItem[]; currency?: string };
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { receiveGoods } = usePurchaseStore();

  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i: PurchaseOrderItem) => [i.id, String(i.quantity - i.received_qty)]))
  );
  const [loading, setLoading] = useState(false);

  const pending = items.filter((i: PurchaseOrderItem) => i.received_qty < i.quantity);
  const qtyOf = (id: string) => parseFloat(received[id] ?? '0') || 0;
  const setQty = (id: string, next: number, max: number) =>
    setReceived(p => ({ ...p, [id]: String(Math.max(0, Math.min(max, next))) }));

  const handleSubmit = async () => {
    if (!user) return;
    const receipts = pending
      .map((i: PurchaseOrderItem) => ({
        itemId: i.id,
        stockItemId: i.stock_item_id,
        itemName: i.item_name,
        receivedQty: qtyOf(i.id),
        unitCost: i.unit_cost,
      }))
      .filter(r => r.receivedQty > 0);

    if (receipts.length === 0) {
      Alert.alert(t('rgNothingTitle'), t('rgNothingBody'));
      return;
    }

    setLoading(true);
    try {
      await receiveGoods(orderId, user.id, receipts);
      Alert.alert(t('rgReceivedTitle'), t('rgReceivedBody', { count: receipts.length }), [
        { text: 'Done', onPress: () => navigation.goBack() }
      ]);
    } catch (e: any) {
      Alert.alert(t('commonError'), e?.message || t('rgFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('rgTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.form}>
        <View style={styles.notice}>
          <Icon name="package" size={iconSize.sm} tint={color.textSecondary} />
          <Text style={styles.noticeText}>Enter what arrived for each item. Stock is updated automatically.</Text>
        </View>

        {pending.length === 0 ? (
          <View style={styles.allDone}>
            <Icon name="check-circle" size={40} tint={color.textSecondary} />
            <Text style={styles.allDoneText}>{t('rgAllReceived')}</Text>
          </View>
        ) : (
          pending.map((item: PurchaseOrderItem) => {
            const remaining = item.quantity - item.received_qty;
            const qty = qtyOf(item.id);
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.itemName}>{item.item_name}</Text>
                  {!!item.stock_item_id && (
                    <View style={styles.stockPill}>
                      <Icon name="package" size={12} tint={color.textSecondary} />
                      <Text style={styles.stockPillText}>{t('rgInStockBook')}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.itemDetail}>Ordered {item.quantity} · received {item.received_qty} · {remaining} to come</Text>
                <Text style={styles.itemDetail}>{formatCurrency(item.unit_cost, currency)} each</Text>

                <View style={styles.qtyRow}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(item.id, qty - 1, remaining)} accessibilityLabel={t('poLess')}>
                    <Icon name="minus" size={iconSize.sm} tint={color.accent} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.qtyInput}
                    value={received[item.id]}
                    onChangeText={v => setReceived(p => ({ ...p, [item.id]: v }))}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(item.id, qty + 1, remaining)} accessibilityLabel={t('poMore')}>
                    <Icon name="plus" size={iconSize.sm} tint={color.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.allBtn} onPress={() => setQty(item.id, remaining, remaining)}>
                    <Text style={styles.allBtnText}>All</Text>
                  </TouchableOpacity>
                </View>

                {qty > 0 && (
                  <View style={styles.lineTotal}>
                    <Text style={styles.itemDetail}>Receiving {qty} × {formatCurrency(item.unit_cost, currency)}</Text>
                    <AmountText paisa={Math.round(qty * item.unit_cost)} size="label" currency={currency} />
                  </View>
                )}
              </View>
            );
          })
        )}

        {pending.length > 0 && (
          <Button label={t('rgConfirm')} icon="check" onPress={handleSubmit} loading={loading} disabled={loading} fullWidth style={styles.submit} />
        )}
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  form: { padding: space.lg, paddingBottom: 40 },
  notice: {
    flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: color.surfaceRaised,
    borderRadius: radius.md, padding: space.md, marginBottom: space.lg, borderWidth: hairline, borderColor: color.border,
  },
  noticeText: { ...typeScale.label, color: color.textSecondary, flex: 1 },
  allDone: { alignItems: 'center', paddingVertical: 60, gap: space.md },
  allDoneText: { ...typeScale.heading, color: color.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border, gap: space.xs,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  itemName: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary, flex: 1 },
  stockPill: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 2,
    borderRadius: radius.pill, borderWidth: hairline, borderColor: color.border,
  },
  stockPillText: { ...typeScale.caption, color: color.textSecondary },
  itemDetail: { ...typeScale.caption, color: color.textSecondary },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  qtyBtn: {
    width: touchTarget, height: touchTarget, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface,
  },
  qtyInput: {
    flex: 1, minHeight: touchTarget, backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, textAlign: 'center', ...typeScale.title, fontSize: 18, color: color.textPrimary,
  },
  allBtn: {
    minHeight: touchTarget, paddingHorizontal: space.md, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.sm, justifyContent: 'center',
  },
  allBtnText: { ...typeScale.bodyMedium, color: color.accent },
  lineTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, marginTop: space.sm },
  submit: { minHeight: 52, marginTop: space.sm },
});
