import React, { useEffect, useCallback } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSupplierStore } from '../../store/useSupplierStore';
import { SupplierLedgerEntry } from '../../types/supplier.types';
import { formatDisplayDate } from '../../utils/dates';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon, IconName, AmountText } from '../../components/ui/primitives';

const TYPE_ICON: Record<string, IconName> = { invoice: 'file-text', return: 'corner-up-left', payment: 'credit-card' };

const LedgerRow = React.memo(({ item }: { item: SupplierLedgerEntry }) => (
  <View style={styles.row}>
    <View style={styles.rowLeft}>
      <Icon name={TYPE_ICON[item.type] ?? 'circle'} size={iconSize.sm} tint={color.textMuted} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
        <Text style={styles.rowDate}>{formatDisplayDate(item.date)}</Text>
      </View>
    </View>
    <View style={styles.rowRight}>
      {item.amount > 0 && <AmountText paisa={item.amount} size="label" tone="out" />}
      {item.credit > 0 && <AmountText paisa={item.credit} size="label" tone="in" />}
      {/* A balance is neutral ink; the word says which way it runs. */}
      <View style={styles.balanceLine}>
        <Text style={styles.balance}>{item.balance >= 0 ? 'Payable' : 'Advance'}</Text>
        <AmountText paisa={Math.abs(item.balance)} size="label" tone="muted" />
      </View>
    </View>
  </View>
));

export const SupplierLedgerScreen = ({ navigation, route }: any) => {
  const { supplierId, supplierName } = route.params;
  const { t } = useLanguageStore();
  const { ledger, loading, loadSupplierLedger } = useSupplierStore();

  const load = useCallback(() => loadSupplierLedger(supplierId), [supplierId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  // The ledger is loaded whole (not paged), so these cover every entry.
  const totalDebit = ledger.reduce((s, e) => s + e.amount, 0);
  const totalCredit = ledger.reduce((s, e) => s + e.credit, 0);
  const netBalance = totalDebit - totalCredit;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('supLedger')}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{supplierName}</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScreenContainer scrollable={false} hasTabBar={false} style={styles.container}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>{t('slTotalPayable')}</Text>
            <AmountText paisa={totalDebit} tone="out" size="label" fit />
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>{t('slTotalPaid')}</Text>
            <AmountText paisa={totalCredit} tone="in" size="label" fit />
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>{netBalance > 0 ? 'Still payable' : 'Advance'}</Text>
            <AmountText paisa={Math.abs(netBalance)} size="label" fit />
          </View>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={color.accent} style={styles.spinner} />
        ) : ledger.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="book-open" size={40} tint={color.textMuted} />
            <Text style={styles.emptyText}>{t('slNoEntries')}</Text>
            <Text style={styles.emptySub}>{t('slWillAppear')}</Text>
          </View>
        ) : (
          <FlatList
            data={ledger}
            keyExtractor={item => item.id}
            renderItem={({ item }) => <LedgerRow item={item} />}
            style={styles.list}
            contentContainerStyle={styles.listContent}
          />
        )}
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  headerSub: { ...typeScale.caption, color: color.textSecondary },
  summaryRow: { flexDirection: 'row', padding: space.md, gap: space.sm },
  summaryBox: {
    flex: 1, padding: space.md, borderRadius: radius.md, gap: space.xs,
    borderWidth: hairline, borderColor: color.border,
  },
  summaryLabel: { ...typeScale.caption, color: color.textSecondary },
  spinner: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingBottom: space.xxl },
  row: {
    flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md,
    borderBottomWidth: hairline, borderBottomColor: color.border, alignItems: 'center',
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1 },
  rowLabel: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  rowDate: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  rowRight: { flexShrink: 0, alignItems: 'flex-end', gap: 2 },
  balanceLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  balance: { ...typeScale.caption, color: color.textMuted },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, gap: space.xs },
  emptyText: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary, marginTop: space.sm },
  emptySub: { ...typeScale.body, color: color.textSecondary },
});
