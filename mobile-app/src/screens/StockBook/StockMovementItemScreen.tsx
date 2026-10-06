import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { useAuthStore } from '../../store/authStore';
import { useDownloadStore } from '../../store/useDownloadStore';
import { getStockMovementReport, StockReportEntry } from '../../services/database/stockDb';
import { PAGE_SIZE, PageCursor } from '../../services/database/pagination';
import { formatCurrency } from '../../utils/calculations';
import { formatDisplayDate, toDateValue } from '../../utils/dates';
import { Icon, AmountText } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * ONE item's movements in ONE direction — opened from the Stock IN (or OUT) report.
 *
 * It calls the SAME query the report list calls, with the same range and an item
 * filter, so this item's totals here always equal its row over there. Rows page;
 * the header figures are whole-set SQL aggregates that never depend on the page.
 * Read-only: stock is recorded in the item's own screen, never in a report.
 */
type Params = {
  direction: 'in' | 'out';
  itemId: string;
  itemName: string;
  unit?: string;
  period?: { startDate?: string; endDate?: string };
};

export const StockMovementItemScreen = ({ navigation, route }: any) => {
  const { direction, itemId, itemName, unit, period } = (route.params ?? {}) as Params;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { isGenerating, generateFile } = useDownloadStore();
  const isIn = direction === 'in';

  const [rows, setRows] = useState<StockReportEntry[]>([]);
  const [summary, setSummary] = useState({ entries: 0, qty: 0, amount: 0 });
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const current = ++request.current;
    setLoading(true);
    try {
      const page = await getStockMovementReport(
        user.id, direction, period?.startDate, period?.endDate, PAGE_SIZE, null, undefined, itemId
      );
      if (current !== request.current) return;
      setRows(page.rows);
      setSummary(page.summary);
      setCursor(page.nextCursor);
    } catch (err) {
      if (__DEV__) console.error('[StockItemReport] load failed:', err);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [user?.id, direction, itemId, period?.startDate, period?.endDate]);

  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);

  const loadMore = useCallback(async () => {
    if (!user?.id || !cursor || loadingMore || loading) return;
    const current = request.current;
    setLoadingMore(true);
    try {
      const page = await getStockMovementReport(
        user.id, direction, period?.startDate, period?.endDate, PAGE_SIZE, cursor, undefined, itemId
      );
      if (current !== request.current) return;
      setRows(prev => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (__DEV__) console.error('[StockItemReport] page failed:', err);
    } finally {
      if (current === request.current) setLoadingMore(false);
    }
  }, [user?.id, direction, itemId, period?.startDate, period?.endDate, cursor, loadingMore, loading]);

  // Export and print cover THIS item over the same range the screen is showing.
  const options = { reportType: isIn ? 'stockIn' as const : 'stockOut' as const, itemId, period: period ?? {} };
  const handleExport = () => navigation.navigate('DownloadOptionsModal', options);
  const handlePrint = async () => {
    if (!user) return;
    try {
      const uri = await generateFile({
        reportType: options.reportType, userId: user.id,
        startDate: period?.startDate, endDate: period?.endDate, itemId, format: 'pdf',
      });
      await Print.printAsync({ uri });
    } catch (err: any) {
      if (__DEV__) console.error('[StockItemReport] print failed:', err);
      Alert.alert(t('smiPrintFailedTitle'), err?.message || t('smiPrintFailed'));
    }
  };

  const rateOf = (m: StockReportEntry) => isIn ? (m.cost_per_unit || 0) : (m.sale_price_unit ?? m.cost_per_unit ?? 0);

  const renderItem = ({ item }: { item: StockReportEntry }) => {
    const qty = Math.abs(item.change);
    return (
      <View style={styles.row}>
        <View style={styles.cellDate}>
          <Text style={styles.dateText}>{formatDisplayDate(toDateValue(item.date) || String(item.date))}</Text>
          {!!item.note && <Text style={styles.noteText} numberOfLines={1}>{item.note}</Text>}
        </View>
        {/* A quantity is a count, not money — it never goes through formatCurrency. */}
        <Text style={styles.qtyText}>{qty}</Text>
        <Text style={styles.rateText}>{rateOf(item) ? formatCurrency(rateOf(item)) : '—'}</Text>
        <AmountText paisa={Math.round(qty * rateOf(item))} size="label" tone={isIn ? 'in' : 'out'} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{itemName}</Text>
          <Text style={styles.subtitle}>{isIn ? 'Stock in' : 'Stock out'}</Text>
        </View>
      </View>

      {/* Whole-set SQL totals for this item and range. */}
      <View style={styles.totalsBar}>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>{t('khataEntries')}</Text>
          <Text style={styles.totalValue}>{summary.entries}</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>{isIn ? 'Qty in' : 'Qty out'}</Text>
          <Text style={styles.totalValue}>{summary.qty}{unit ? ` ${unit}` : ''}</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>{t('commonAmount')}</Text>
          <AmountText paisa={summary.amount} tone={isIn ? 'in' : 'out'} size="label" fit />
        </View>
      </View>

      <View style={styles.columns}>
        <Text style={[styles.colLabel, styles.cellDate]}>{t('commonDate')}</Text>
        <Text style={[styles.colLabel, styles.qtyText]}>Qty</Text>
        <Text style={[styles.colLabel, styles.rateText]}>{t('stockRateColumn')}</Text>
        <Text style={styles.colLabel}>{t('commonAmount')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={color.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
          ListEmptyComponent={<Text style={styles.empty}>{t('smiNoEntries')}</Text>}
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerBtn} onPress={handleExport} disabled={isGenerating} accessibilityRole="button">
          <Icon name="download" size={iconSize.sm} tint={color.accent} />
          <Text style={styles.footerBtnText}>{t('staffPdfReport')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerBtn} onPress={handlePrint} disabled={isGenerating} accessibilityRole="button">
          <Icon name="printer" size={iconSize.sm} tint={color.accent} />
          <Text style={styles.footerBtnText}>{t('smiPrint')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  subtitle: { ...typeScale.caption, color: color.textSecondary },
  totalsBar: {
    flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md,
    backgroundColor: color.surfaceRaised, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  totalCell: { flex: 1 },
  totalLabel: { ...typeScale.caption, color: color.textSecondary },
  totalValue: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary, marginTop: 2 },
  columns: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  colLabel: { ...typeScale.caption, color: color.textSecondary },
  listContent: { paddingBottom: space.xxl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  cellDate: { flex: 1 },
  dateText: { ...typeScale.body, fontSize: 14, color: color.textPrimary },
  noteText: { ...typeScale.caption, color: color.textMuted },
  qtyText: { ...typeScale.body, fontSize: 14, color: color.textPrimary, width: 56, textAlign: 'right' },
  rateText: { ...typeScale.body, fontSize: 14, color: color.textSecondary, width: 88, textAlign: 'right' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typeScale.body, color: color.textSecondary, textAlign: 'center', marginTop: space.xxl },
  footerSpinner: { margin: space.lg },
  footer: {
    flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    borderTopWidth: hairline, borderTopColor: color.border,
  },
  footerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    minHeight: touchTarget, borderRadius: radius.md, borderWidth: hairline, borderColor: color.accent,
  },
  footerBtnText: { ...typeScale.bodyMedium, color: color.accent },
});
