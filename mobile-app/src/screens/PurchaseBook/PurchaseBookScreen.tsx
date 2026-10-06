import React, { useEffect, useCallback, useState } from 'react';
import { statusLabel } from '../../i18n/categoryLabel';
import {
  View, Text, TouchableOpacity, StyleSheet, SectionList,
  ActivityIndicator, RefreshControl, Keyboard, Platform
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/usePurchaseStore';
import { PurchaseOrder, PurchaseInvoice } from '../../types/purchase.types';
import { Icon, AmountText, AmountStack } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale, chrome } from '../../theme/tokens';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { DateRangeFilter, DateRange, describeRange } from '../../components/ui/DateRangeFilter';
import { toDateValue, formatDisplayDate } from '../../utils/dates';

// Status carries meaning only: waiting on something (sent, partial, unpaid) is amber;
// settled (received, paid) is ink; inactive (draft, cancelled) is muted.
const STATUS_TONE: Record<string, string> = {
  draft: color.textMuted,
  sent: color.attention,
  partial: color.attention,
  received: color.textPrimary,
  cancelled: color.textMuted,
  unpaid: color.attention,
  paid: color.textPrimary,
};
const StatusPill = ({ status }: { status: string }) => {
  const { t } = useLanguageStore();
  const tone = STATUS_TONE[status] ?? color.textMuted;
  return (
    <View style={[styles.statusBadge, { borderColor: tone }]}>
      <Text style={[styles.statusText, { color: tone }]}>{statusLabel(t, status)}</Text>
    </View>
  );
};

const OrderCard = React.memo(({ item, onPress }: { item: PurchaseOrder; onPress: () => void }) => {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardRow}>
        <View style={styles.cardLeft}>
          <Text style={styles.poNumber}>PO-{String(item.po_number).padStart(4, '0')}</Text>
          <Text style={styles.cardSub}>{item.supplier_name}</Text>
          <Text style={styles.cardDate}>{item.order_date}</Text>
        </View>
        <View style={styles.cardRight}>
          <StatusPill status={item.status} />
          <AmountText paisa={item.total} currency={item.currency} />
        </View>
      </View>
    </TouchableOpacity>
  );
});

const InvoiceCard = React.memo(({ item, onPress }: { item: PurchaseInvoice; onPress: () => void }) => {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardRow}>
        <View style={styles.cardLeft}>
          <Text style={styles.poNumber}>#{item.invoice_number}</Text>
          <Text style={styles.cardSub}>{item.supplier_name}</Text>
          <Text style={styles.cardDate}>{item.invoice_date}</Text>
        </View>
        <View style={styles.cardRight}>
          <StatusPill status={item.status} />
          <AmountText paisa={item.total} currency={item.currency} />
          {item.balance_due > 0 && (
            <View style={styles.balDueRow}>
              <Text style={styles.balDueLabel}>Due</Text>
              <AmountText paisa={item.balance_due} tone="out" size="label" currency={item.currency} />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

export const PurchaseBookScreen = ({ navigation, route }: any) => {
  // Staff Book → staff → Entries → Purchase: that person's purchases, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { summary, loading, loadSummary, filter, setFilter, orderList, invoiceList, loadLists, loadMore } = usePurchaseStore();
  const range: DateRange = { startDate: filter.startDate, endDate: filter.endDate };
  const setRange = (next: DateRange) => { if (user) setFilter(user.id, { ...filter, ...next }); };
  const orders = orderList.rows as PurchaseOrder[];
  const invoices = invoiceList.rows as PurchaseInvoice[];
  const [tab, setTab] = useState<'orders' | 'invoices'>('orders');
  const [refreshing, setRefreshing] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    await Promise.all([loadLists(user.id, viewAs?.userId), loadSummary(user.id, viewAs?.userId)]);
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  // Loaded rows grouped by day (order_date / invoice_date); a day straddling a page
  // boundary keeps ONE section whose header shows the day's whole SQL subtotal.
  const group = (rows: any[], dateKey: string) => {
    const byDay = new Map<string, any[]>();
    for (const r of rows) { const day = toDateValue(r[dateKey]) || String(r[dateKey]); const l = byDay.get(day); if (l) l.push(r); else byDay.set(day, [r]); }
    return [...byDay.entries()].map(([day, data]) => ({ day, data }));
  };
  const orderSections = React.useMemo(() => group(orders, 'order_date'), [orders]);
  const invoiceSections = React.useMemo(() => group(invoices, 'invoice_date'), [invoices]);

  // Day header: how many, what it came to, and how much of it is settled — "Received"
  // (goods received against orders) or "Paid" (cash against invoices).
  // `day` is never named `t`: that is the translator, and shadowing it here is what
  // made t('billTotal') call a totals object and crash the whole list.
  const dayHeader = (totals: Record<string, any>, noun: string, settledLabel: string) => ({ section }: { section: { day: string } }) => {
    const day = totals[section.day];
    return (
      <View style={styles.dayHeader}>
        <View style={styles.dayLeft}>
          <Text style={styles.dayTitle}>{formatDisplayDate(section.day)}</Text>
          {day && <Text style={styles.dayCount}>{day.count} {day.count === 1 ? noun : noun + 's'}</Text>}
        </View>
        {day && (
          <View style={styles.dayRight}>
            <View style={styles.dayFigure}>
              <Text style={styles.dayColLabel}>{t('billTotal')}</Text>
              <AmountStack totals={day.total} size="label" />
            </View>
            <View style={styles.dayFigure}>
              <Text style={styles.dayColLabel}>{settledLabel}</Text>
              <AmountStack totals={day.settled} size="label" />
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.safe}>
      {/* Top Header with Profile & Books Bar */}
      {viewAs
        ? <ReadOnlyBanner name={viewAs.name} book="Purchase" onBack={() => navigation.goBack()} />
        : <TopHeaderWithBooks navigation={navigation} activeBook="PurchaseBook" />}

      {/* Range — shared control, opens on this month; both tabs follow it */}
      <View style={styles.rangeWrap}>
        <DateRangeFilter value={range} onChange={setRange} fieldStyle={styles.rangeField} textStyle={styles.rangeText} />
      </View>

      {/* Summary Tiles */}
      {summary && (
        <View style={styles.summaryRow}>
          <View style={styles.tile}>
            <Text style={styles.tileVal}>{summary.totalOrders}</Text>
            <Text style={styles.tileLabel} numberOfLines={2}>{t('purchaseTotalOrders')}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={[styles.tileVal, summary.pendingOrders > 0 && styles.tileValAttention]}>{summary.pendingOrders}</Text>
            <Text style={styles.tileLabel} numberOfLines={2}>{t('purchasePending')}</Text>
          </View>
          <View style={styles.tile}>
            <AmountStack totals={summary.totalOutstanding} tone="out" size="label" fit />
            <Text style={styles.tileLabel} numberOfLines={2}>{t('purchaseOutstanding')}</Text>
          </View>
          <View style={styles.tile}>
            <AmountStack totals={summary.totalPaidThisMonth} size="label" fit />
            <Text style={styles.tileLabel} numberOfLines={2}>{t('purchasePaidThisMonth')}</Text>
          </View>
        </View>
      )}

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, tab === 'orders' && styles.tabActive]} onPress={() => setTab('orders')}>
          <Icon name="package" size={iconSize.sm} tint={tab === 'orders' ? color.accent : color.textSecondary} />
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]} numberOfLines={1}>Orders ({orderList.summary.count})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'invoices' && styles.tabActive]} onPress={() => setTab('invoices')}>
          <Icon name="file-text" size={iconSize.sm} tint={tab === 'invoices' ? color.accent : color.textSecondary} />
          <Text style={[styles.tabText, tab === 'invoices' && styles.tabTextActive]} numberOfLines={1}>Invoices ({invoiceList.summary.count})</Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator size="large" color={color.accent} style={styles.spinner} />
      ) : tab === 'orders' ? (
        <SectionList
          sections={orderSections}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} />}
          renderItem={({ item }) => (
            <OrderCard item={item} onPress={() => { if (!viewAs) navigation.navigate('PurchaseOrderDetail', { orderId: item.id }); }} />
          )}
          renderSectionHeader={dayHeader(orderList.dayTotals, 'order', 'Received')}
          stickySectionHeadersEnabled
          onEndReached={() => { if (user) loadMore(user.id, 'orders'); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={orderList.loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          SectionSeparatorComponent={() => <View style={styles.gap} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="package" size={40} tint={color.textMuted} />
              <Text style={styles.emptyTitle}>{t('pbNoOrders')}</Text>
              {!viewAs && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('CreatePurchaseOrder')}>
                  <Icon name="plus" size={iconSize.sm} tint={color.textInverse} />
                  <Text style={styles.emptyBtnText}>{t('pbCreateFirst')}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      ) : (
        <SectionList
          sections={invoiceSections}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} />}
          renderItem={({ item }) => (
            <InvoiceCard item={item} onPress={() => { if (!viewAs) navigation.navigate('PurchaseInvoiceDetail', { invoiceId: item.id }); }} />
          )}
          renderSectionHeader={dayHeader(invoiceList.dayTotals, 'invoice', 'Paid')}
          stickySectionHeadersEnabled
          onEndReached={() => { if (user) loadMore(user.id, 'invoices'); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={invoiceList.loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          SectionSeparatorComponent={() => <View style={styles.gap} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="file-text" size={40} tint={color.textMuted} />
              <Text style={styles.emptyTitle}>{t('pbNoInvoices')}</Text>
              {!viewAs && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('CreatePurchaseInvoice', {})}>
                  <Icon name="plus" size={iconSize.sm} tint={color.textInverse} />
                  <Text style={styles.emptyBtnText}>{t('piCreate')}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* FAB */}
      {!isKeyboardVisible && !viewAs && (
        <View style={[styles.fab, { bottom: space.lg }]}>
          <TouchableOpacity style={styles.fabBtn} onPress={() => navigation.navigate(tab === 'orders' ? 'CreatePurchaseOrder' : 'CreatePurchaseInvoice', {})} accessibilityRole="button" accessibilityLabel={tab === 'orders' ? 'Create purchase order' : 'Create invoice'}>
            <Icon name="plus" size={iconSize.lg} tint={color.textInverse} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  rangeWrap: { paddingHorizontal: space.md },
  summaryRow: { flexDirection: 'row', padding: space.md, gap: space.sm },
  rangeField: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: touchTarget,
  },
  rangeText: { ...typeScale.label, color: color.textPrimary },
  // Day header — a raised band with Total / settled figures (neutral: they are totals).
  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, paddingVertical: chrome.dayPadY, paddingHorizontal: space.md,
    borderWidth: hairline, borderColor: color.border, marginBottom: chrome.cardMarginY,
  },
  dayLeft: { flex: 1 },
  dayTitle: { ...typeScale.caption, color: color.textSecondary },
  dayCount: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  dayRight: { flexDirection: 'row', gap: space.lg, flexShrink: 0 },
  dayFigure: { alignItems: 'flex-end' },
  dayColLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: 2 },
  tile: {
    flex: 1, borderRadius: radius.md, paddingVertical: chrome.cardPadY, paddingHorizontal: space.xs, alignItems: 'center', gap: 2,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
  },
  tileVal: { ...typeScale.bodyMedium, color: color.textPrimary },
  tileValAttention: { color: color.attention },
  tileLabel: { ...typeScale.caption, color: color.textSecondary, textAlign: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: color.surface, borderBottomWidth: hairline, borderBottomColor: color.border },
  tab: {
    flex: 1, flexDirection: 'row', gap: space.xs, minHeight: touchTarget, paddingHorizontal: space.sm,
    alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: color.accent },
  tabText: { ...typeScale.label, color: color.textSecondary, flexShrink: 1 },
  tabTextActive: { color: color.accent, fontWeight: typeScale.bodyMedium.fontWeight },
  spinner: { flex: 1 },
  listContent: { padding: space.md, paddingBottom: chrome.listBottom },
  gap: { height: space.sm },
  footerSpinner: { margin: space.lg },
  card: {
    backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg,
    borderWidth: hairline, borderColor: color.border,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  cardLeft: { flex: 1 },
  poNumber: { ...typeScale.bodyMedium, color: color.textPrimary },
  cardSub: { ...typeScale.label, color: color.textSecondary, marginTop: 2 },
  cardDate: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: space.xs, flexShrink: 0 },
  statusBadge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: hairline },
  statusText: { ...typeScale.caption },
  balDueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  balDueLabel: { ...typeScale.caption, color: color.textSecondary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: space.md },
  emptyTitle: { ...typeScale.heading, color: color.textSecondary },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm,
    backgroundColor: color.accent, paddingHorizontal: space.xxl, minHeight: touchTarget, borderRadius: radius.md,
  },
  emptyBtnText: { ...typeScale.bodyMedium, color: color.textInverse },
  fab: { position: 'absolute', right: space.xl },
  fabBtn: {
    width: 56, height: 56, borderRadius: radius.pill, backgroundColor: color.accent,
    justifyContent: 'center', alignItems: 'center',
  },
});
