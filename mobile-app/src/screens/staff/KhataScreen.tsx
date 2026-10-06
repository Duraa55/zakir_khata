import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, SectionList, TouchableOpacity, Alert, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { getFilteredKhata, getKhataDayTotals, getKhataGrandTotals, KhataDayTotal, PartyBalance } from '../../services/database/transactionDb';
import { CustomerBalanceList } from '../../components/khata/CustomerBalanceList';
import { PAGE_SIZE, PageCursor } from '../../services/database/pagination';
import { DateRangeFilter, DateRange, describeRange } from '../../components/ui/DateRangeFilter';
import { thisMonthRange, toDateValue, formatDisplayDate } from '../../utils/dates';
import { TransactionItem } from '../../components/TransactionItem';
import { Transaction } from '../../types';
import { generateTransactionPDF } from '../../utils/pdfGenerator';
import { Icon, AmountText } from '../../components/ui/primitives';
import { PdfReportButton } from '../../components/ui/PdfReportButton';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale, chrome } from '../../theme/tokens';

export const KhataScreen = ({ navigation, route }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  // Khata opens on WHO OWES WHAT. The transaction list is still here under Activity —
  // it answers "what happened today", which is a real question, just not the first one.
  const [tab, setTab] = useState<'customers' | 'activity'>('customers');
  // All-time, SQL, over the whole searched set — never summed from the loaded page.
  const [grand, setGrand] = useState<{ totalLena: number; totalDena: number; netBalance: number } | null>(null);
  // Staff Book → staff → Entries → Khata: that person's khata, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  // Rows are PAGED (keyset, PAGE_SIZE at a time); Total Lena / Dena / Net and the
  // per-day subtotals are SQL aggregates over the WHOLE filtered set, fetched once
  // per filter change — never from loaded rows.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<{ totalLena: number; totalDena: number; netBalance: number } | null>(null);
  const [dayTotals, setDayTotals] = useState<Map<string, KhataDayTotal>>(new Map());
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Opens on this month (was: all time). All-time balances per customer live in the
  // Customer Ledger, linked directly under the summary bar.
  const [range, setRange] = useState<DateRange>(() => thisMonthRange());
  const request = useRef(0);
  const [filterType, setFilterType] = useState<'all' | 'lena' | 'dena'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const activeFilter = useMemo(
    () => ({ ...range, type: filterType, search: searchQuery, ...(viewAs ? { createdBy: viewAs.userId } : {}) }),
    [range, filterType, searchQuery, viewAs?.userId]
  );

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    setTransactions([]);
    setSummary(null);
    setCursor(null);
    if (!user?.id) { setLoading(false); return; }
    try {
      const [page, days] = await Promise.all([
        getFilteredKhata(user.id, activeFilter, PAGE_SIZE),
        getKhataDayTotals(user.id, activeFilter),
      ]);
      if (current !== request.current) return;
      setTransactions(page.transactions);
      setSummary(page.balanceSummary);
      setCursor(page.nextCursor);
      setDayTotals(new Map(days.map(d => [d.day, d])));
    } catch (e) {
      if (current === request.current) setError(e instanceof Error ? e.message : String(e));
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
      const page = await getFilteredKhata(user.id, activeFilter, PAGE_SIZE, 0, cursor);
      if (current !== request.current) return;
      setTransactions(prev => [...prev, ...page.transactions]);
      setCursor(page.nextCursor);
    } catch (e) {
      if (__DEV__) console.error('[Khata] load more failed:', e);
    } finally {
      if (current === request.current) setLoadingMore(false);
    }
  }, [user?.id, activeFilter, cursor, loadingMore, loading]);

  // Group loaded rows by calendar day; a day straddling a page boundary keeps ONE
  // section whose header shows the day's whole SQL subtotal.
  const sections = useMemo(() => {
    const byDay = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const day = toDateValue(t.date) || String(t.date);
      const list = byDay.get(day);
      if (list) list.push(t); else byDay.set(day, [t]);
    }
    return [...byDay.entries()].map(([day, data]) => ({ day, data }));
  }, [transactions]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { ++request.current; };
  }, [load]));

  const result = summary;
  const balanceSummary = summary || { totalLena: 0, totalDena: 0, netBalance: 0 };
  // Customers shows ALL-TIME balances, Activity shows the selected range. Both come
  // from SQL over the whole set; neither is summed from the rows on screen.
  const shown = tab === 'customers' ? grand : (result ? balanceSummary : null);

  // The header must describe exactly the list beneath it, so it follows the same search.
  useEffect(() => {
    if (!user?.id || tab !== 'customers') return;
    let live = true;
    const id = setTimeout(() => {
      getKhataGrandTotals(user.id, { search: searchQuery }, viewAs?.userId)
        .then(g => { if (live) setGrand(g); })
        .catch(e => { if (__DEV__) console.error('[Khata] grand totals failed:', e); });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [user?.id, tab, searchQuery, viewAs?.userId]);

  const handleGeneratePDF = async () => {
    if (!user?.id) return;
    try {
      // The export covers the WHOLE filtered range, not just the pages loaded so far.
      const { transactions: all, balanceSummary: totals } = await getFilteredKhata(user.id, activeFilter);
      if (all.length === 0) {
        Alert.alert(t('noData'), t('khataNothingToExport'));
        return;
      }
      // Totals from the same SQL summary the screen shows — never re-added in JS.
      await generateTransactionPDF(all, user?.businessName || 'My Business', viewAs?.name || user?.name || 'Staff', viewAs ? `Khata report · ${viewAs.name}` : 'Khata report', totals);
    } catch {
      Alert.alert(t('errorTitle'), t('khataPdfFailed'));
    }
  };

  // Day header — the day's own Lena (credit given: money out, red) and Dena (payment
  // taken: money in, green). The words carry it too, never colour alone.
  const renderSectionHeader = useCallback(({ section }: { section: { day: string } }) => {
    const day = dayTotals.get(section.day);
    return (
      <View style={styles.dayHeader}>
        <View style={styles.dayLeft}>
          <Text style={styles.dayTitle}>{formatDisplayDate(section.day)}</Text>
          {day && <Text style={styles.dayCount}>{day.entryCount} {t(day.entryCount === 1 ? 'khataEntrySingular' : 'khataEntryPlural')}</Text>}
        </View>
        {day && (
          <View style={styles.dayRight}>
            <View style={styles.dayFigure}>
              <Text style={styles.dayColLabel}>{t('khataLena')}</Text>
              <AmountText paisa={day.lena} tone="out" size="label" />
            </View>
            <View style={styles.dayFigure}>
              <Text style={styles.dayColLabel}>{t('khataDena')}</Text>
              <AmountText paisa={day.dena} tone="in" size="label" />
            </View>
          </View>
        )}
      </View>
    );
  }, [dayTotals, t]);

  const renderTransactionItem = React.useCallback(({ item }: { item: Transaction }) => (
    <TransactionItem
      transaction={item}
      onPress={() => { if (!viewAs) navigation.navigate('EditTransaction', { transactionId: item.id }); }}
    />
  ), [navigation, viewAs]);

  return (
    <SafeAreaView style={styles.safe}>
      {viewAs && <ReadOnlyBanner name={viewAs.name} book="Khata" onBack={() => navigation.goBack()} />}
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{t('khataTitle')}</Text>
          {tab === 'activity' && <PdfReportButton onPress={handleGeneratePDF} />}
        </View>

        {/* Customers first, Activity second — the default answers the question a
            shopkeeper actually opens the app with. */}
        <View style={styles.tabRow}>
          {(['customers', 'activity'] as const).map(key => (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              style={[styles.tabBtn, tab === key && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]} numberOfLines={1}>
                {key === 'customers' ? t('khataTabCustomers') : t('khataTabActivity')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Filter Pills — Activity only: a balance has no type to filter by. */}
        {tab === 'activity' && <View style={styles.filterRow}>
          {(['all', 'lena', 'dena'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filterType === f && styles.filterBtnActive]}
              onPress={() => setFilterType(f)}
            >
              <Text style={[styles.filterText, filterType === f && styles.filterTextActive]}>
                {f === 'all' ? t('khataAll') : f === 'lena' ? t('khataLena') : t('khataDena')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>}

        {/* Search */}
        <View style={styles.searchBox}>
          <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('khataSearchPlaceholder')}
            placeholderTextColor={color.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        {/* A balance is all-time, so a date range only makes sense for Activity. */}
        {tab === 'activity' && (
          <DateRangeFilter value={range} onChange={setRange}
            fieldStyle={styles.rangeField} textStyle={styles.rangeText} />
        )}
      </View>

      {/* Summary Bar — for the SELECTED RANGE (this month by default). Lena (credit
          given) red, Dena (payment taken) green; the net is a balance: neutral ink. */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{t('khataTotalLena')}</Text>
          {shown ? <AmountText paisa={shown.totalLena} tone="out" fit /> : <Text style={styles.summaryDash}>—</Text>}
        </View>
        <View style={styles.vertDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{t('khataTotalDena')}</Text>
          {shown ? <AmountText paisa={shown.totalDena} tone="in" fit /> : <Text style={styles.summaryDash}>—</Text>}
        </View>
        <View style={styles.vertDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{t('khataNetBalance')}</Text>
          {shown ? <AmountText paisa={shown.netBalance} signed fit /> : <Text style={styles.summaryDash}>—</Text>}
        </View>
      </View>

      {/* Activity says what range its figures cover. Customers are always all-time. */}
      {tab === 'activity' && (
        <View style={styles.ledgerLink}>
          <Text style={styles.ledgerLinkText} numberOfLines={1}>{t('khataTotalsFor', { range: describeRange(range) })}</Text>
        </View>
      )}

      {tab === 'customers' ? (
        <CustomerBalanceList
          userId={user!.id}
          search={searchQuery}
          viewAs={viewAs}
          onOpen={(party: PartyBalance) => navigation.navigate('CustomerDetail', {
            partyName: party.partyName, userId: user?.id, ...(viewAs ? { viewAs } : {}),
          })}
        />
      ) : loading ? (
        <View style={styles.emptyContainer}><ActivityIndicator color={color.accent} /></View>
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}><Text style={styles.retryText}>{t('retry')}</Text></TouchableOpacity>
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="book-open" size={40} tint={color.textMuted} />
          <Text style={styles.emptyText}>{viewAs ? `${viewAs.name} has no khata entries in this range` : t('khataNoTransactions')}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderTransactionItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          SectionSeparatorComponent={() => <View style={styles.gap} />}
          refreshing={loading}
          onRefresh={load}
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
    backgroundColor: color.surface, paddingHorizontal: space.lg, paddingTop: chrome.barPadY, paddingBottom: chrome.barPadY, gap: chrome.rowGap,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  headerTitle: { ...typeScale.heading, color: color.textPrimary, flex: 1 },

  filterRow: { flexDirection: 'row', gap: space.sm },
  // Segmented control. Equal halves so an Urdu label (~40% longer) has the same room
  // as its English counterpart, and the whole row stays one line.
  tabRow: {
    flexDirection: 'row', backgroundColor: color.surfaceRaised,
    borderRadius: radius.md, padding: space.xs, gap: space.xs,
  },
  tabBtn: {
    flex: 1, minHeight: touchTarget - space.sm, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm,
  },
  tabBtnActive: { backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border },
  tabText: { ...typeScale.label, color: color.textSecondary },
  tabTextActive: { ...typeScale.bodyMedium, color: color.textPrimary },
  filterBtn: {
    flex: 1, minHeight: chrome.barMinHeight, borderRadius: radius.pill, paddingHorizontal: space.sm,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBtnActive: { backgroundColor: color.accent, borderColor: color.accent },
  filterText: { ...typeScale.label, color: color.textSecondary },
  filterTextActive: { color: color.textInverse, fontWeight: typeScale.bodyMedium.fontWeight },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: chrome.barMinHeight,
  },
  searchInput: { ...typeScale.body, flex: 1, color: color.textPrimary, paddingVertical: space.sm },
  rangeField: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget,
  },
  rangeText: { ...typeScale.label, color: color.textPrimary },

  summaryBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surfaceRaised, paddingVertical: chrome.cardPadY, paddingHorizontal: space.sm,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  summaryItem: { flex: 1, alignItems: 'center', paddingHorizontal: space.xs },
  vertDivider: { width: hairline, height: 28, backgroundColor: color.border },
  summaryLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: 2 },
  summaryDash: { ...typeScale.bodyMedium, color: color.textMuted },

  // Range caption + Customer Ledger link: one slim row under the summary.
  ledgerLink: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surface, minHeight: chrome.barMinHeight, paddingHorizontal: space.lg,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  ledgerLinkText: { ...typeScale.caption, flex: 1, color: color.textSecondary },
  ledgerLinkActionWrap: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  ledgerLinkAction: { ...typeScale.label, color: color.accent, flexShrink: 1 },

  // Day header — a raised band with the day's Lena / Dena.
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

  listContent: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: chrome.listBottom },
  gap: { height: space.sm },
  footerSpinner: { margin: space.lg },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xxl, gap: space.sm },
  emptyText: { ...typeScale.body, color: color.textSecondary, textAlign: 'center' },
  retryBtn: { minHeight: touchTarget, paddingHorizontal: space.lg, justifyContent: 'center' },
  retryText: { ...typeScale.bodyMedium, color: color.accent },
});
