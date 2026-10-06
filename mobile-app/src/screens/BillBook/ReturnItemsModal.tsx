import React, { useEffect, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBillStore } from '../../store/useBillStore';
import { useAuthStore } from '../../store/authStore';
import { getBillForEdit } from '../../services/database/billDb';
import { Bill } from '../../types/bill.types';
import { Icon, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * Return items against one bill. Every line and the stock that comes back are saved in
 * ONE transaction (billDb.returnBillItems), so a failure never leaves half a return.
 * Only the bill's author may return against it.
 */
export const ReturnItemsModal = ({ route, navigation }: any) => {
  const { billId } = route.params;
  const { returnItems } = useBillStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  const [bill, setBill] = useState<Bill | null>(null);
  const [loadingBill, setLoadingBill] = useState(true);
  const [loading, setLoading] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});

  // Fresh from the database — the Bill Book list may not hold this bill's page.
  useEffect(() => {
    getBillForEdit(billId)
      .then(setBill)
      .catch(() => setBill(null))
      .finally(() => setLoadingBill(false));
  }, [billId]);

  if (loadingBill) {
    return <SafeAreaView style={[styles.safe, styles.center]}><ActivityIndicator color={color.accent} /></SafeAreaView>;
  }

  if (!bill || bill.user_id !== user?.id) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.emptyText}>{!bill ? 'Bill not found.' : 'You can only return items on your own bills.'}</Text>
        <Button label={t('commonGoBack')} variant="secondary" onPress={() => navigation.goBack()} style={styles.backAction} />
      </SafeAreaView>
    );
  }

  const handleReturn = async () => {
    if (!user) return;
    const returns = Object.entries(returnQty)
      .map(([billItemId, qty]) => ({ billItemId, qty: Number(qty.trim() || '0') }))
      .filter(r => r.qty !== 0);
    if (returns.length === 0) {
      Alert.alert(t('riNothingTitle'), t('riNothing'));
      return;
    }
    setLoading(true);
    try {
      await returnItems(bill.id, user.id, returns);
      Alert.alert(t('riDoneTitle'), t('riDone'));
      navigation.goBack();
    } catch (e: any) {
      Alert.alert(t('commonError'), e?.message || t('riFailed'));
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
        <Text style={styles.headerTitle} numberOfLines={1}>Return items · Bill #{bill.bill_no}</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={bill.items}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.emptyText}>{t('riNoLines')}</Text>}
        renderItem={({ item }) => {
          const alreadyReturned = item.returned_quantity || 0;
          const maxReturn = item.quantity - alreadyReturned;
          return (
            <View style={styles.itemCard}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.item_name}</Text>
                <Text style={styles.itemDetail}>Sold: {item.quantity}</Text>
                {alreadyReturned > 0 && <Text style={styles.itemReturned}>Already returned: {alreadyReturned}</Text>}
              </View>
              {maxReturn > 0 ? (
                <View style={styles.qtyInputWrap}>
                  <Text style={styles.qtyLabel}>Return (max {maxReturn})</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={color.textMuted}
                    value={returnQty[item.id] || ''}
                    onChangeText={txt => setReturnQty(prev => ({ ...prev, [item.id]: txt }))}
                  />
                </View>
              ) : (
                <View style={styles.doneWrap}>
                  <Icon name="check-circle" size={iconSize.sm} tint={color.textSecondary} />
                  <Text style={styles.doneText}>{t('riFullyReturned')}</Text>
                </View>
              )}
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <Button label={t('riProcess')} icon="corner-up-left" onPress={handleReturn} loading={loading} disabled={loading} fullWidth style={styles.submit} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: { justifyContent: 'center', alignItems: 'center', padding: space.xxl, gap: space.md },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  list: { padding: space.lg },
  emptyText: { ...typeScale.body, color: color.textSecondary, textAlign: 'center' },
  backAction: { marginTop: space.sm },
  itemCard: {
    flexDirection: 'row', padding: space.lg, borderRadius: radius.md, backgroundColor: color.surface,
    borderWidth: hairline, borderColor: color.border, marginBottom: space.md,
    alignItems: 'center', justifyContent: 'space-between', gap: space.md,
  },
  itemInfo: { flex: 1 },
  itemName: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary, marginBottom: space.xs },
  itemDetail: { ...typeScale.label, color: color.textSecondary },
  itemReturned: { ...typeScale.label, color: color.attention, marginTop: 2 },
  qtyInputWrap: { alignItems: 'center', flexShrink: 0 },
  qtyLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: space.xs },
  input: {
    minWidth: 64, minHeight: touchTarget, backgroundColor: color.surfaceRaised, borderWidth: hairline,
    borderColor: color.border, borderRadius: radius.sm, textAlign: 'center', ...typeScale.bodyMedium, color: color.textPrimary,
  },
  doneWrap: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0 },
  doneText: { ...typeScale.label, color: color.textSecondary },
  footer: { padding: space.lg, borderTopWidth: hairline, borderTopColor: color.border },
  submit: { minHeight: 50 },
});
