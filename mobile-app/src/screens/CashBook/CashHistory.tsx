import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, SectionList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { getFilteredCashHistory, getCashHistoryDayTotals, deleteCashEntry, CashDayTotal } from '../../services/database/cashbookDb';
import { PAGE_SIZE, PageCursor } from '../../services/database/pagination';
import { thisMonthRange, toDateValue, formatDisplayDate } from '../../utils/dates';
import { DateRangeFilter, DateRange } from '../../components/ui/DateRangeFilter';
import { useTransactionStore } from '../../store/transactionStore';
import { formatDate } from '../../utils/calculations';
import { CashEntry } from '../../types';
import { Icon, AmountText } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

type FilterType = 'all' | 'in' | 'out';

const CashEntryRow = React.memo(({ item, onPress, handleDelete, readOnly }: { item: CashEntry; onPress: () => void; handleDelete: (id: string) => void; readOnly?: boolean }) => {
  const { t } = useLanguageStore();
  const isIn = item.direction === 'in';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Direction by meaning: green in, red out — the arrow says it without colour too. */}
      <Icon name={isIn ? 'arrow-down-left' : 'arrow-up-right'} size={iconSize.md} tint={isIn ? color.moneyIn : color.moneyOut} />
      <View style={styles.rowInfo}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowDesc, { flexShrink: 1 }]} numberOfLines={1}>{item.description}</Text>
          {!!item.attachment_url && <Icon name="paperclip" size={iconSize.sm} tint={color.textSecondary} />}
        </View>
        <Text style={styles.rowDate}>{formatDate(item.date)}</Text>
      </View>
      <View style={styles.rowRight}>
        <AmountText paisa={item.amount_paisa} tone={isIn ? 'in' : 'out'} />
        {!readOnly && (
        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn} accessibilityRole="button" accessibilityLabel={t('entryDelete')}>
          <Icon name="trash-2" size={iconSize.sm} tint={color.textSecondary} />
        </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
});

export const CashHistory = ({ navigation, route }: any) => {
  // Opened from a staff member's Entries → Cash: only their rows, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { loadCashBook } = useTransactionStore();

  // Rows are PAGED (keyset, PAGE_SIZE at a time); the summary and the per-day subtotals
  // are SQL aggregates over the WHOLE filtered set, fetched once per filter change.
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [summary, setSummary] = useState<{ cashIn: number; cashOut: number; cashBalance: number } | null>(null);
  const [dayTotals, setDayTotals] = useState<Map<string, CashDayTotal>>(new Map());
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Opens on this month, like the Bill Book; the range control below widens it.
  const [range, setRange] = useState<DateRange>(() => thisMonthRange());
  const [error, setError] = useState('');
  const request = useRef(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const activeFilter = useMemo(
    () => ({ ...range, direction: filter, search, ...(viewAs ? { createdBy: viewAs.userId } : {}) }),
    [range, filter, search, viewAs?.userId]
  );

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setEntries([]);
    setSummary(null);
    setCursor(null);
    setError('');
    if (!user?.id) { setLoading(false); return; }
    try {
      const [page, days] = await Promise.all([
        getFilteredCashHistory(user.id, activeFilter, PAGE_SIZE),
        getCashHistoryDayTotals(user.id, activeFilter),
      ]);
      if (current !== request.current) return;
      setEntries(page.entries);
      setSummary(page.cashSummary);
      setCursor(page.nextCursor);
      setDayTotals(new Map(days.map(d => [d.day, d])));
    } catch (err) {
      if (current === request.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [user?.id, activeFilter]);

  // Next page: strictly after the last loaded row. Totals are NOT refetched here.
  const loadMore = useCallback(async () => {
    if (!user?.id || !cursor || loadingMore || loading) return;
    const current = request.current;
    setLoadingMore(true);
    try {
      const page = await getFilteredCashHistory(user.id, activeFilter, PAGE_SIZE, 0, cursor);
      if (current !== request.current) return;
      setEntries(prev => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (__DEV__) console.error('[CashHistory] load more failed:', err);
    } finally {
      if (current === request.current) setLoadingMore(false);
    }
  }, [user?.id, activeFilter, cursor, loadingMore, loading]);

  // Group the loaded rows by calendar day. A day that straddles a page boundary keeps
  // ONE section: the next page's rows append to it, and its header always shows the
  // day's whole SQL subtotal, not a count of what happens to be loaded.
  const sections = useMemo(() => {
    const byDay = new Map<string, CashEntry[]>();
    for (const e of entries) {
      const day = toDateValue(e.date) || String(e.date);
      const list = byDay.get(day);
      if (list) list.push(e); else byDay.set(day, [e]);
    }
    return [...byDay.entries()].map(([day, data]) => ({ day, data }));
  }, [entries]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { ++request.current; };
  }, [load]));

  const handleDelete = useCallback((id: string) => {
    Alert.alert(t('entryDelete'), t('entryDeleteConfirm'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteCashEntry(id, user!.id);
            if (user) await loadCashBook(user.id);
            await load();
          } catch {
            Alert.alert(t('commonError'), t('entryDeleteFailed'));
          }
        },
      },
    ]);
  }, [user, loadCashBook, load]);

  const result = summary;
  const { cashIn: totalIn, cashOut: totalOut, cashBalance: net } = summary || { cashIn: 0, cashOut: 0, cashBalance: 0 };

  const renderItem = useCallback(({ item }: { item: CashEntry }) => {
    return <CashEntryRow item={item} onPress={() => navigation.navigate('CashEntryDetail', { entry: item, readOnly: !!viewAs })} handleDelete={handleDelete} readOnly={!!viewAs} />;
  }, [handleDelete, navigation]);

  // Day header with that day's SQL subtotal. In is green, out is red — labels carry
  // the words too, so the figures never rely on colour alone.
  const renderSectionHeader = useCallback(({ section }: { section: { day: string } }) => {
    // Named `day`, not `t`: `t` is the translator, and shadowing it here is what broke
    // the Purchase Book day header the moment a label was translated.
    const day = dayTotals.get(section.day);
    return (
      <View style={styles.dateHeaderBanner}>
        <View style={styles.dateHeaderLeft}>
          <Text style={styles.dateTitle}>{formatDisplayDate(section.day)}</Text>
          {day && <Text style={styles.entriesCountText}>{day.entryCount} {day.entryCount === 1 ? 'entry' : 'entries'}</Text>}
        </View>
        {day && (
          <View style={styles.dateHeaderRight}>
            <View style={styles.dayFigure}>
              <Text style={styles.columnLabel}>Out</Text>
              <AmountText paisa={day.cashOut} tone="out" size="label" />
            </View>
            <View style={styles.dayFigure}>
              <Text style={styles.columnLabel}>In</Text>
              <AmountText paisa={day.cashIn} tone="in" size="label" />
            </View>
          </View>
        )}
      </View>
    );
  }, [dayTotals]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{viewAs ? `${viewAs.name} · Cash history` : 'Cash history'}</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Summary strip — whole filtered set (SQL). In green, out red, net is neutral ink. */}
      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{t('histTotalIn')}</Text>
          {result ? <AmountText paisa={totalIn} tone="in" fit /> : <Text style={styles.summaryDash}>—</Text>}
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{t('histTotalOut')}</Text>
          {result ? <AmountText paisa={totalOut} tone="out" fit /> : <Text style={styles.summaryDash}>—</Text>}
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Net</Text>
          {result ? <AmountText paisa={net} signed fit /> : <Text style={styles.summaryDash}>—</Text>}
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('histSearch')}
          placeholderTextColor={color.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel={t('histClearSearch')}>
            <Icon name="x" size={iconSize.sm} tint={color.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['all', 'in', 'out'] as FilterType[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]} numberOfLines={1}>
              {f === 'all' ? 'All' : f === 'in' ? 'Cash in' : 'Cash out'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.rangeWrap}>
        <DateRangeFilter value={range} onChange={setRange}
          fieldStyle={[styles.searchWrap, styles.rangeField]} textStyle={styles.rangeText} />
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}><Text style={styles.retryText}>{t('histRetry')}</Text></TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('histNoTransactions')}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          SectionSeparatorComponent={() => <View style={styles.gap} />}
          onRefresh={load}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },

  summaryStrip: {
    flexDirection: 'row', backgroundColor: color.surfaceRaised,
    paddingVertical: space.md, paddingHorizontal: space.sm,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  summaryItem: { flex: 1, alignItems: 'center', paddingHorizontal: space.xs },
  summaryLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: 2 },
  summaryDash: { ...typeScale.bodyMedium, color: color.textMuted },
  summaryDivider: { width: hairline, backgroundColor: color.border, marginVertical: space.xs },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surfaceRaised, margin: space.md,
    paddingHorizontal: space.md, minHeight: touchTarget,
    borderRadius: radius.md, borderWidth: hairline, borderColor: color.border,
    gap: space.sm,
  },
  searchInput: { ...typeScale.body, flex: 1, color: color.textPrimary, paddingVertical: space.sm },
  clearBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },

  filterRow: {
    flexDirection: 'row', paddingHorizontal: space.md, gap: space.sm, marginBottom: space.xs,
  },
  filterTab: {
    flex: 1, minHeight: touchTarget, paddingHorizontal: space.sm, borderRadius: radius.pill,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: hairline, borderColor: color.borderStrong,
  },
  filterTabActive: { backgroundColor: color.accent, borderColor: color.accent },
  filterTabText: { ...typeScale.label, color: color.textSecondary },
  filterTabTextActive: { ...typeScale.label, fontWeight: typeScale.bodyMedium.fontWeight, color: color.textInverse },

  rangeWrap: { paddingHorizontal: space.md },
  rangeField: { margin: 0 },
  rangeText: { ...typeScale.label, color: color.textPrimary },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surface, borderRadius: radius.md,
    padding: space.md, gap: space.md, minHeight: touchTarget + space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  rowInfo: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowDesc: { ...typeScale.bodyMedium, color: color.textPrimary },
  rowDate: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0 },
  deleteBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.lg, gap: space.sm },
  emptyText: { ...typeScale.body, color: color.textSecondary, textAlign: 'center' },
  retryBtn: { minHeight: touchTarget, paddingHorizontal: space.lg, justifyContent: 'center' },
  retryText: { ...typeScale.bodyMedium, color: color.accent },

  listContent: { padding: space.lg, paddingBottom: 135 },
  gap: { height: space.sm },
  footerSpinner: { margin: space.lg },

  // Day header — a raised band, like the Cash Book's day header.
  dateHeaderBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  dateHeaderLeft: { flex: 1 },
  dateTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  entriesCountText: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  dateHeaderRight: { flexDirection: 'row', gap: space.lg, flexShrink: 0 },
  dayFigure: { alignItems: 'flex-end' },
  columnLabel: { ...typeScale.caption, color: color.textSecondary },
});
