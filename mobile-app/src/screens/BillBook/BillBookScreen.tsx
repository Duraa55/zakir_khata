import React, { useState, useEffect, useRef } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, SectionList, ScrollView,
  Animated, ActivityIndicator, Dimensions, Alert, Keyboard, Platform
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useBillStore } from '../../store/useBillStore';
import { Bill } from '../../types/bill.types';
import { formatCurrency } from '../../utils/calculations';
import { DateRangeFilter, DateRange, describeRange } from '../../components/ui/DateRangeFilter';
import { toDateValue, formatDisplayDate } from '../../utils/dates';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { SummaryBar, SummaryFigure, AmountText, AmountStack } from '../../components/ui/primitives';
import { PdfReportButton } from '../../components/ui/PdfReportButton';
import { color, space, radius, hairline, touchTarget, chrome, type as typeScale } from '../../theme/tokens';

const BillItemView = React.memo(({ item, onPress }: { item: Bill, onPress: (item: Bill) => void }) => {
  const { t } = useLanguageStore();
  return (
    <TouchableOpacity 
      style={styles.itemRow}
      onPress={() => onPress(item)}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.billNumber}>{t('billNumberPrefix')} {item.bill_no}</Text>
        {/* Part paid: what is still owed, beside the total. An unpaid bill shows its
            total once — the two figures would be the same number. */}
        {item.paid > 0 && item.due > 0 && <AmountText paisa={item.due} tone="out" size="label" currency={item.currency} />}
      </View>

      <View style={styles.itemFooter}>
        <Text style={styles.partyName} numberOfLines={1}>{item.party_name}</Text>
        <View style={styles.totalWrap}>
          <Text style={styles.billTotal}>{formatCurrency(item.total, item.currency)}</Text>
          <Text style={styles.chevron}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export const BillBookScreen = ({ navigation, route }: any) => {
  // Staff Book → staff → Entries → Bill: that person's bills, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { bills, loading, loadingMore, dayTotals, summary, fetchBills, loadMoreBills, filter, setFilter } = useBillStore();

  const range: DateRange = { startDate: filter.startDate, endDate: filter.endDate };
  const setRange = (next: DateRange) => { if (user) setFilter(user.id, { ...filter, ...next }, viewAs?.userId); };
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);

  const loadData = () => {
    if (user) fetchBills(user.id, undefined, viewAs?.userId);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation, user]);

  useEffect(() => {
    loadData();
  }, [user]);

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

  const handleBillPress = React.useCallback((item: Bill) => {
    navigation.navigate('BillDetailScreen', { billId: item.id });
  }, [navigation]);

  const filteredBills = bills;

  const rangeLabel = describeRange(range);

  const renderItem = React.useCallback(({ item }: { item: Bill }) => {
    return <BillItemView item={item} onPress={handleBillPress} />;
  }, [handleBillPress]);

  // Loaded bills grouped by bill day; a day straddling a page boundary keeps ONE
  // section whose header shows the day's whole SQL subtotal.
  const sections = React.useMemo(() => {
    const byDay = new Map<string, Bill[]>();
    for (const b of bills) {
      const day = toDateValue(b.bill_date as string) || String(b.bill_date);
      const list = byDay.get(day);
      if (list) list.push(b); else byDay.set(day, [b]);
    }
    return [...byDay.entries()].map(([day, data]) => ({ day, data }));
  }, [bills]);

  // Day header: how many bills, what was billed and what was actually received that day.
  const renderSectionHeader = React.useCallback(({ section }: { section: { day: string } }) => {
    const day = dayTotals[section.day];
    return (
      <View style={styles.dayHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dayTitle}>{formatDisplayDate(section.day)}</Text>
          {day && <Text style={styles.dayCount}>{day.billCount} {t(day.billCount === 1 ? 'billSingular' : 'billPlural')}</Text>}
        </View>
        {day && (
          <View style={styles.dayRight}>
            <View style={styles.dayCols}>
              <Text style={styles.dayColLabel}>{t('billBilled')}</Text>
              <Text style={styles.dayColLabel}>{t('billPaid')}</Text>
            </View>
            <View style={styles.dayCols}>
              <AmountStack totals={day.totalBilled} size="label" textStyle={styles.dayColVal} />
              <AmountStack totals={day.totalPaid} tone="in" size="label" textStyle={styles.dayColVal} />
            </View>
          </View>
        )}
      </View>
    );
  }, [dayTotals, t]);

  const loadMore = React.useCallback(() => { if (user) loadMoreBills(user.id); }, [user, loadMoreBills]);

  return (
    <View style={styles.container}>
      
      {/* Top Header with Profile & Books Bar */}
      {viewAs
        ? <ReadOnlyBanner name={viewAs.name} book="Bill" onBack={() => navigation.goBack()} />
        : <TopHeaderWithBooks navigation={navigation} activeBook="BillBook" />}



      {/* Summary Card */}
      <SummaryBar>
        {/* One bill or many is two dictionary entries, not an English "s" glued on:
            Urdu does not pluralise this way. Same shape as dashEntryEdited/dashEntriesEdited. */}
        <SummaryFigure label={t(summary.billCount === 1 ? 'billHeroSaleOne' : 'billHeroSaleMany',
          { range: rangeLabel, count: summary.billCount })}>
          <AmountStack totals={summary.totalBilled} size="title" fit textStyle={styles.summaryAmount} />
        </SummaryFigure>
      </SummaryBar>

      {/* Date Range Filter — sits above the list, sized by its own content. It used to
          be wrapped in a flex: 1 View, which inside this auto-height box resolved to
          zero height: the box collapsed to a sliver and the list drew over the fields. */}
      {/* One compact line: the active range, and the export beside it. */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarFilter}>
        <DateRangeFilter value={range} onChange={setRange}
          fieldStyle={styles.dateBox} textStyle={styles.dateLabel} />
        </View>
        {!viewAs && <PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'bill' })} />}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : filteredBills.length === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: chrome.listBottom, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.xl }}>
          <View style={styles.emptyState}>
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <Text style={styles.instructionText}>{t('billStep1')}</Text>
              <Text style={styles.instructionText}>{t('billStep2')}</Text>
              <Text style={styles.instructionText}>{t('billStep3')}</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: chrome.rowGap, paddingBottom: chrome.listBottom }}
          SectionSeparatorComponent={() => <View style={{ height: space.sm }} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: space.lg }} color={color.accent} /> : null}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}

      {/* Add Item Button */}
      {!isKeyboardVisible && !viewAs && (
        <View style={[styles.addBtnContainer, { bottom: 0 }]}>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => navigation.navigate('CreateNewBillModal')}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.addBtnText} numberOfLines={1}>{t('billCreateNew')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },


  // Day header — the Cash Book day-header banner with Billed / Paid columns.
  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: color.surface, borderRadius: radius.md,
    paddingVertical: chrome.dayPadY, paddingHorizontal: space.md,
    borderWidth: hairline, borderColor: color.border, marginBottom: space.sm,
  },
  dayTitle: { ...typeScale.caption, color: color.textSecondary },
  dayCount: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  dayRight: { alignItems: 'flex-end', flexShrink: 0, marginLeft: space.md },
  dayCols: { flexDirection: 'row', gap: space.lg },
  dayColLabel: { ...typeScale.caption, color: color.textSecondary, minWidth: 60, textAlign: 'right', marginBottom: 2 },
  dayColVal: { ...typeScale.label, fontWeight: '500', minWidth: 60, textAlign: 'right', flexShrink: 0 },

  summaryAmount: { color: color.onBrand },

  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginBottom: chrome.rowGap,
  },
  // A visible bordered box, so each date reads as a control you can tap.
  dateBox: {
    flexDirection: 'row', alignItems: 'center', minHeight: touchTarget, marginTop: space.xs,
    paddingHorizontal: space.md, borderRadius: radius.sm,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
  },
  dateLabel: { ...typeScale.caption, color: color.textSecondary },

  toolbarFilter: { flex: 1 },
  itemRow: {
    backgroundColor: color.surface, borderRadius: radius.md,
    paddingVertical: chrome.rowPadY, paddingHorizontal: space.md, marginBottom: chrome.rowGap,
    borderWidth: hairline, borderColor: color.border, minHeight: touchTarget,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, gap: space.sm },
  billNumber: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  itemFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  // flex: 1 so a long (or Urdu) customer name gives way before the amount does.
  partyName: { ...typeScale.label, color: color.textSecondary, flex: 1 },
  totalWrap: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0 },
  billTotal: { ...typeScale.bodyMedium, color: color.textPrimary },
  chevron: { ...typeScale.heading, color: color.textMuted },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  instructionText: { ...typeScale.label, color: color.textSecondary },

  addBtnContainer: {
    position: 'absolute', right: space.lg,
    borderTopWidth: hairline, borderTopColor: color.border,
  },
  addBtn: {
    backgroundColor: color.accent, minHeight: chrome.fab, paddingHorizontal: space.lg,
    borderRadius: radius.pill, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm,
  },
  addBtnText: { ...typeScale.bodyMedium, color: color.textInverse },
});
