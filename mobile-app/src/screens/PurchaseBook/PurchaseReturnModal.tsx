import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/usePurchaseStore';
import { PurchaseInvoiceItem, PurchaseReturnItem } from '../../types/purchase.types';
import { formatCurrency } from '../../utils/calculations';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';
import { Icon, AmountText, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * Return goods to the supplier. The data layer refuses more than was invoiced (minus
 * earlier returns) and writes the return, its lines and the stock decrease together.
 */
export const PurchaseReturnModal = ({ navigation, route }: any) => {
  const {
    invoiceId, supplierId, supplierName,
    items = [] as PurchaseInvoiceItem[],
    // The INVOICE's currency: a refund is a figure of that invoice.
    currency,
  } = route.params;

  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { createReturn } = usePurchaseStore();

  const [returnDate, setReturnDate] = useState(todayDate());
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<Record<string, { qty: string; checked: boolean }>>(
    Object.fromEntries(items.map((i: PurchaseInvoiceItem) => [i.id, { qty: String(i.quantity), checked: false }]))
  );
  const [loading, setLoading] = useState(false);

  const qtyOf = (id: string) => parseFloat(selected[id]?.qty ?? '0') || 0;
  const checkedItems = items.filter((i: PurchaseInvoiceItem) => selected[i.id]?.checked);
  // A preview only — the saved figure is computed again, in whole paisa, by the data layer.
  const totalRefund = checkedItems.reduce((s: number, i: PurchaseInvoiceItem) => s + Math.round(qtyOf(i.id) * i.unit_cost), 0);

  const setQty = (id: string, next: number, max: number) =>
    setSelected(p => ({ ...p, [id]: { ...p[id], qty: String(Math.max(0, Math.min(max, next))) } }));

  const handleSubmit = async () => {
    if (!user) return;
    if (checkedItems.length === 0) { Alert.alert(t('prNothingSelectedTitle'), t('prNothingSelected')); return; }

    const returnItems: Omit<PurchaseReturnItem, 'id' | 'return_id'>[] = checkedItems.map((i: PurchaseInvoiceItem) => {
      const qty = qtyOf(i.id);
      return { stock_item_id: i.stock_item_id, item_name: i.item_name, quantity: qty, unit_cost: i.unit_cost, line_total: Math.round(qty * i.unit_cost) };
    });

    setLoading(true);
    try {
      await createReturn(user.id, invoiceId, supplierId, returnItems, returnDate, reason.trim() || undefined);
      Alert.alert(t('prRecordedTitle'), t('prRecordedBody', { amount: formatCurrency(totalRefund, currency) }), [
        { text: 'Done', onPress: () => navigation.goBack() }
      ]);
    } catch (e: any) {
      Alert.alert(t('commonError'), e?.message || t('prFailed'));
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
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('prTitle')}</Text>
          {!!supplierName && <Text style={styles.headerSub} numberOfLines={1}>to {supplierName}</Text>}
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.form}>
        <View style={styles.notice}>
          <Icon name="corner-up-left" size={iconSize.sm} tint={color.textSecondary} />
          <Text style={styles.noticeText}>{t('prIntro')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t('prReturnDate')}</Text>
          <DateField style={styles.input} textStyle={styles.inputText} value={returnDate} onChange={setReturnDate} maximumDate={new Date()} />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t('prItemsToReturn')}</Text>
          {items.map((item: PurchaseInvoiceItem, idx: number) => {
            const sel = selected[item.id];
            const qty = qtyOf(item.id);
            return (
              <View key={item.id} style={[styles.itemRow, idx > 0 && styles.itemRowBorder]}>
                <TouchableOpacity
                  style={styles.checkRow}
                  onPress={() => setSelected(p => ({ ...p, [item.id]: { ...p[item.id], checked: !p[item.id]?.checked } }))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!sel?.checked }}
                >
                  <View style={[styles.checkbox, sel?.checked && styles.checkboxActive]}>
                    {sel?.checked && <Icon name="check" size={iconSize.sm} tint={color.textInverse} />}
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName}>{item.item_name}</Text>
                    <Text style={styles.itemDetail}>Invoiced {item.quantity} · {formatCurrency(item.unit_cost, currency)} each</Text>
                  </View>
                </TouchableOpacity>

                {sel?.checked && (
                  <View style={styles.qtyRow}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(item.id, qty - 1, item.quantity)} accessibilityLabel={t('poLess')}>
                      <Icon name="minus" size={iconSize.sm} tint={color.accent} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.qtyInput}
                      value={sel.qty}
                      onChangeText={v => setSelected(p => ({ ...p, [item.id]: { ...p[item.id], qty: v } }))}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(item.id, qty + 1, item.quantity)} accessibilityLabel={t('poMore')}>
                      <Icon name="plus" size={iconSize.sm} tint={color.accent} />
                    </TouchableOpacity>
                    <View style={styles.flex} />
                    {qty > 0 && <AmountText paisa={Math.round(qty * item.unit_cost)} size="label" currency={currency} />}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t('prReason')}</Text>
          <TextInput
            style={[styles.input, styles.inputText, styles.notes]}
            value={reason} onChangeText={setReason}
            placeholder={t('prReasonPlaceholder')}
            placeholderTextColor={color.textMuted}
            multiline numberOfLines={3}
          />
        </View>

        {totalRefund > 0 && (
          <View style={styles.refund}>
            <Text style={styles.refundLabel}>{t('prRefundDue')}</Text>
            <AmountText paisa={totalRefund} size="title" currency={currency} />
          </View>
        )}

        <Button label={t('prConfirm')} icon="corner-up-left" onPress={handleSubmit} loading={loading} disabled={loading || checkedItems.length === 0} fullWidth style={styles.submit} />
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  headerSub: { ...typeScale.caption, color: color.textSecondary },
  form: { padding: space.lg, paddingBottom: 40 },
  notice: {
    flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: color.surfaceRaised,
    borderRadius: radius.md, padding: space.md, marginBottom: space.lg, borderWidth: hairline, borderColor: color.border,
  },
  noticeText: { ...typeScale.label, color: color.textSecondary, flex: 1 },
  section: {
    backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, justifyContent: 'center',
  },
  inputText: { ...typeScale.body, color: color.textPrimary },
  notes: { minHeight: 70, textAlignVertical: 'top', paddingTop: space.sm },
  itemRow: { paddingVertical: space.md, gap: space.sm },
  itemRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: color.accent, borderColor: color.accent },
  itemInfo: { flex: 1 },
  itemName: { ...typeScale.bodyMedium, color: color.textPrimary },
  itemDetail: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: 36 },
  qtyBtn: {
    width: touchTarget, height: touchTarget, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface,
  },
  qtyInput: {
    minWidth: 56, minHeight: touchTarget, backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, textAlign: 'center', ...typeScale.bodyMedium, color: color.textPrimary,
  },
  refund: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceRaised, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
  },
  refundLabel: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  submit: { minHeight: 52 },
});
