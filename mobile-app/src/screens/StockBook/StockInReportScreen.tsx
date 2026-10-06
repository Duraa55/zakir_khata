import React, { useEffect, useState, useMemo } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { useAuthStore } from '../../store/authStore';
import { useStockStore } from '../../store/useStockStore';
import { StockItemReportRow } from '../../services/database/stockDb';
import { formatCurrency } from '../../utils/calculations';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { DateRangeFilter } from '../../services/database/reports/types';
import { getDisplayName } from '../../utils/displayName';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon, AmountText } from '../../components/ui/primitives';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { localDate, toDateValue, formatDisplayDate, parseDateValue } from '../../utils/dates';
import { useDownloadStore } from '../../store/useDownloadStore';

export const StockInReportScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  // One row per item that came IN, with that item's own SQL totals. Tapping a row
  // opens only that item's stock-in entries.
  const report = useStockStore(s => s.movementItems.in);
  const fetchMovementItems = useStockStore(s => s.fetchMovementItems);
  const loadMoreMovementItems = useStockStore(s => s.loadMoreMovementItems);
  const { rows, summary, loading, loadingMore } = report;

  const { isGenerating, generateFile } = useDownloadStore();
  const [searchQuery, setSearchQuery] = useState('');
  // Starts on the range the picker shows by default (current month), not all-time.
  const [startDate, setStartDate] = useState<Date | null>(() => parseDateValue(presetRange('currentMonth').startDate));
  const [endDate, setEndDate] = useState<Date | null>(() => parseDateValue(presetRange('currentMonth').endDate));
  
  // Range AND search are part of the SQL predicate, so the paged rows, the header
  // totals and the day subtotals always describe the same set.
  useEffect(() => {
    if (user) {
      const startStr = startDate ? localDate(startDate) : undefined;
      const endStr = endDate ? localDate(endDate) : undefined;
      fetchMovementItems(user.id, 'in', { startDate: startStr, endDate: endStr, search: searchQuery });
    }
  }, [user, startDate, endDate, searchQuery]);

  // The range this screen is showing, as the export and print must cover it.
  const shownPeriod = () => ({
    startDate: startDate ? localDate(startDate) : undefined,
    endDate: endDate ? localDate(endDate) : undefined,
  });

  const handleExport = () => navigation.navigate('DownloadOptionsModal', { reportType: 'stockIn', period: shownPeriod() });

  // Real printing: the same generator builds the PDF, then the OS print dialog opens it.
  const handlePrint = async () => {
    if (!user) return;
    try {
      const uri = await generateFile({ reportType: 'stockIn', userId: user.id, ...shownPeriod(), format: 'pdf' });
      await Print.printAsync({ uri });
    } catch (err: any) {
      if (__DEV__) console.error('[StockReport] print failed:', err);
      Alert.alert(t('srPrintFailed'), err?.message || 'Could not print the report. Please try again.');
    }
  };

  const handleFilterChange = (filter: DateRangeFilter) => {
    setStartDate(filter.startDate ? new Date(filter.startDate) : null);
    setEndDate(filter.endDate ? new Date(filter.endDate) : null);
  };

  // Header totals are the whole-set SQL summary, never a sum of the loaded page.
  const totalQty = summary.qty;
  const totalAmount = summary.amount;

  const loadMore = () => { if (user) loadMoreMovementItems(user.id, 'in'); };

  const renderItem = ({ item }: { item: StockItemReportRow }) => (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={() => navigation.navigate('StockMovementItem', {
        direction: 'in', itemId: item.item_id, itemName: getDisplayName(item as any),
        unit: item.unit, period: shownPeriod(),
      })}
      accessibilityRole="button"
    >
      <View style={styles.itemNameCell}>
        <Text style={styles.itemName} numberOfLines={1}>{getDisplayName(item as any)}</Text>
        <Text style={styles.itemEntries}>{item.entries} {item.entries === 1 ? 'entry' : 'entries'}</Text>
      </View>
      {/* A quantity is a count, not money — never through formatCurrency. */}
      <Text style={styles.itemQty}>{item.qty}{item.unit ? ` ${item.unit}` : ''}</Text>
      <AmountText paisa={item.amount} size="label" tone="in" />
      <Icon name="chevron-right" size={iconSize.sm} tint={color.textMuted} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('srInTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScreenContainer scrollable={false} hasTabBar={true} style={styles.container}>
        {/* Filters */}
        <View style={styles.filtersContainer}>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('commonSearchItems')}
                placeholderTextColor={color.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>
          <DateFilterPicker onFilterChange={handleFilterChange} />
        </View>

        {/* Table Header */}
        <View style={styles.tableHeaderRow}>
          <View style={styles.cellNameHeader}>
            <Icon name="arrow-down-left" size={iconSize.sm} tint={color.moneyIn} />
            <View style={{ marginLeft: 4 }}>
              <Text style={styles.thText}>{t('khataEntries')}</Text>
              <Text style={[styles.thSubText, { color: color.textPrimary }]}>{summary.entries}</Text>
            </View>
          </View>
          <View style={styles.cellQty}>
            <Text style={styles.thText}>Qty</Text>
            <Text style={[styles.thSubText, { color: color.moneyIn }]}>{totalQty}</Text>
          </View>
          <View style={styles.cellRate} />
          <View style={styles.cellAmount}>
            <Text style={styles.thText}>{t('commonAmount')}</Text>
            <Text style={[styles.thSubText, { color: color.moneyIn }]}>{formatCurrency(totalAmount)}</Text>
          </View>
        </View>

        {/* List */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={color.accent} />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.item_id}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: space.lg }}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews={true}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyText}>{t('srNoIn')}</Text>
              </View>
            }
          />
        )}

        {/* Footer Export Buttons */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.pdfBtn} onPress={handleExport} disabled={isGenerating}>
            <Icon name="download" size={iconSize.sm} tint={color.brand} />
            <Text style={styles.pdfBtnText}>{t('staffPdfReport')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.printBtn} onPress={handlePrint} disabled={isGenerating}>
            <Icon name="printer" size={iconSize.md} tint={color.textInverse} />
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  itemNameCell: { flex: 1 },
  itemName: { ...typeScale.bodyMedium, fontSize: 15, color: color.textPrimary },
  itemEntries: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  itemQty: { ...typeScale.body, fontSize: 14, color: color.textPrimary, width: 72, textAlign: 'right' },
  emptyText: { ...typeScale.body, color: color.textSecondary, marginTop: space.xxl },
  footerSpinner: { margin: space.lg },
  safe: { flex: 1, backgroundColor: color.surface },
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: 16, height: 56,
    borderBottomWidth: 1, borderBottomColor: color.border,
  },
  backBtn: { width: 40, justifyContent: 'center' },
  backArrow: { fontSize: 24, color: color.textPrimary, fontWeight: '400' },
  headerTitle: { fontSize: 18, fontWeight: '500', color: color.textPrimary },

  filtersContainer: { backgroundColor: color.surface, padding: 12, borderBottomWidth: 1, borderBottomColor: color.border },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  searchBox: { 
    flex: 1, flexDirection: 'row', alignItems: 'center', 
    backgroundColor: color.surfaceRaised, borderWidth: 1, borderColor: color.border, borderRadius: 10, paddingHorizontal: 12, height: 42 
  },
  searchIcon: { fontSize: 16, color: color.textSecondary, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: color.textPrimary },

  tableHeaderRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceRaised, 
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.border
  },
  thText: { fontSize: 12, color: color.textSecondary, fontWeight: '500' },
  thSubText: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  
  cellNameHeader: { flex: 2, flexDirection: 'row', alignItems: 'center' },
  cellName: { flex: 2, justifyContent: 'center' },
  cellQty: { flex: 1, alignItems: 'flex-end', justifyContent: 'center' },
  cellRate: { flex: 1, alignItems: 'flex-end', justifyContent: 'center' },
  cellAmount: { flex: 1.5, alignItems: 'flex-end', justifyContent: 'center' },


  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: color.surface,
    borderTopWidth: 1, borderTopColor: color.border
  },
  pdfBtn: {
    flex: 1, backgroundColor: color.surfaceRaised, height: 48, borderRadius: 24,
    borderWidth: 1.5, borderColor: color.accent, justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  pdfBtnText: { color: color.brand, fontSize: 15, fontWeight: '500' },
  printBtn: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: color.attention,
    justifyContent: 'center', alignItems: 'center',
  },
  printBtnText: { fontSize: 22 },

  // Day header — the Cash Book day-header banner with Qty / Amount for the day.
});
