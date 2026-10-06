import React, { useEffect, useRef, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, SectionList, ScrollView,
  Animated, ActivityIndicator, Keyboard, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useExpenseStore } from '../../store/useExpenseStore';
import { Expense } from '../../types/expense.types';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { PdfReportButton } from '../../components/ui/PdfReportButton';
import { SummaryBar, SummaryFigure, AmountText, Icon, Button, AmountStack } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale, chrome } from '../../theme/tokens';
import { DateField } from '../../components/ui/DateField';
import { DateRangeFilter, DateRange, describeRange } from '../../components/ui/DateRangeFilter';
import { toDateValue, todayDate, localDate, parseDateValue, formatDisplayDate } from '../../utils/dates';

export const ExpenseBookScreen = ({ navigation, route }: any) => {
  // Staff Book → staff → Entries → Expense: that person's expenses, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const {
    expenses, loading, loadingMore, dayTotals, monthlyTotal,
    fetchExpenses, loadMoreExpenses, filter, setFilter
  } = useExpenseStore();

  /**
   * ONE authoritative filter: the store's {startDate, endDate}. The day navigator
   * and the range control are two ways of writing to it, never two competing
   * states — which is what made the previous mount-time override swallow the
   * store's "this month" default.
   *
   *   • A single day is simply the range collapsed onto itself (start === end).
   *     Stepping or tapping Today writes that day to both ends.
   *   • Setting a real from–to range leaves start !== end, so the day selection
   *     stops being a day selection by definition — nothing to clear by hand.
   *
   * So "is a day selected?" is derived, never stored.
   */
  const range: DateRange = { startDate: filter.startDate, endDate: filter.endDate };
  const selectedDay =
    filter.startDate && filter.startDate === filter.endDate ? filter.startDate : null;

  const [today, setToday] = useState(todayDate());
  const isToday = selectedDay === today;

  const setRange = (next: DateRange) => {
    if (user) setFilter(user.id, { ...filter, ...next }, viewAs?.userId);
  };
  const selectDay = (day: string) => {
    if (user) setFilter(user.id, { ...filter, startDate: day, endDate: day }, viewAs?.userId);
  };

  // Midnight rollover: only meaningful while a single day is being viewed, and only
  // when that day is the one that just stopped being today.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = todayDate();
      if (now !== today) {
        if (selectedDay === today) selectDay(now);
        setToday(now);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [today, selectedDay]);

  const stepDay = (days: number) => {
    const base = parseDateValue(selectedDay || today) || new Date();
    base.setDate(base.getDate() + days);
    const next = localDate(base);
    if (next > today) return;
    selectDay(next);
  };

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [isKeyboardVisible, setIsKeyboardVisible] = React.useState(false);

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

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);

  const loadData = () => {
    if (user) fetchExpenses(user.id, undefined, viewAs?.userId);
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

  // The headline says which control is actually driving the figure below it.
  const periodLabel = selectedDay
    ? (isToday ? t('commonToday') : formatDisplayDate(selectedDay))
    : describeRange(range);
  const dayNavLabel = t('expensePickDay');

  // Loaded expenses grouped by expense day; a day straddling a page boundary keeps
  // ONE section whose header shows the day's whole SQL subtotal.
  const sections = React.useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    for (const e of expenses) {
      const day = toDateValue(e.expense_date as string) || String(e.expense_date);
      const list = byDay.get(day);
      if (list) list.push(e); else byDay.set(day, [e]);
    }
    return [...byDay.entries()].map(([day, data]) => ({ day, data }));
  }, [expenses]);

  // Day header: entry count and the day's total spend (money out, so red).
  const renderSectionHeader = React.useCallback(({ section }: { section: { day: string } }) => {
    const day = dayTotals[section.day];
    return (
      <View style={styles.dayHeader}>
        <View style={styles.dayLeft}>
          <Text style={styles.dayTitle}>{formatDisplayDate(section.day)}</Text>
          {day && <Text style={styles.dayCount}>{day.entryCount} {t(day.entryCount === 1 ? 'commonEntry' : 'commonEntries')}</Text>}
        </View>
        {day && (
          <View style={styles.dayRight}>
            <Text style={styles.dayColLabel}>{t('expenseSpent')}</Text>
            <AmountStack totals={day.totalExpense} tone="out" size="label" />
          </View>
        )}
      </View>
    );
  }, [dayTotals]);

  const loadMore = React.useCallback(() => { if (user) loadMoreExpenses(user.id); }, [user, loadMoreExpenses]);

  const renderItem = ({ item }: { item: Expense }) => {
    return (
      <TouchableOpacity
        style={styles.itemRow}
        onPress={() => navigation.navigate('ExpenseDetail', { expense: item })}
      >
        <View style={styles.itemTopLine}>
          <Text style={styles.description} numberOfLines={1}>{item.description}</Text>
          <AmountText paisa={item.amount} tone="out" currency={item.currency} />
        </View>

        <View style={styles.itemBottomLine}>
          <Text style={styles.dateText}>{new Date(item.expense_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</Text>
          <View style={styles.divider} />
          <Text style={styles.noteText} numberOfLines={1}>{item.note || 'No additional note'}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>

      {/* Top Header with Profile & Books Bar */}
      {viewAs
        ? <ReadOnlyBanner name={viewAs.name} book="Expense" onBack={() => navigation.goBack()} />
        : <TopHeaderWithBooks navigation={navigation} activeBook="ExpensesTab" />}

      {/* Summary Card — total is the SQL sum of the SAME filter the list uses */}
      <SummaryBar>
        <SummaryFigure label={t('expenseHeroTotal', { period: periodLabel })}>
          <AmountStack totals={monthlyTotal} size="title" fit textStyle={styles.summaryAmount} />
        </SummaryFigure>
      </SummaryBar>

      {/* Day navigator — a shortcut that collapses the range onto one day. The
          from–to control below is the same filter, widened. */}
      <View style={styles.dayNavRow}>
        <TouchableOpacity onPress={() => stepDay(-1)} style={styles.dayNavBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('expensePreviousDay')}>
          <Icon name="chevron-left" size={iconSize.md} tint={color.textPrimary} />
        </TouchableOpacity>

        {/* Jump straight to a day. Empty while a multi-day range is active, so the
            placeholder is the honest state rather than a date nothing is filtered to. */}
        <View style={styles.dayNavFieldWrap}>
          <DateField
            value={selectedDay || ''}
            onChange={selectDay}
            maximumDate={new Date()}
            placeholder={dayNavLabel}
            style={styles.dayNavField}
            textStyle={styles.dayNavFieldText}
          />
        </View>

        <TouchableOpacity
          onPress={() => stepDay(1)}
          style={[styles.dayNavBtn, isToday && styles.dayNavBtnDisabled]}
          disabled={isToday}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('expenseNextDay')}
        >
          <Icon name="chevron-right" size={iconSize.md} tint={isToday ? color.textMuted : color.textPrimary} />
        </TouchableOpacity>

        {!isToday && (
          <TouchableOpacity onPress={() => selectDay(today)} style={styles.todayChip} activeOpacity={0.7}>
            <Text style={styles.todayChipText}>{t('commonToday')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Range filter — previous months stay reachable, and the total above follows it.
          The export shares this line, the same arrangement the Bill Book uses, and goes
          through the same PdfReportButton so the books' exports cannot drift apart. The
          expense PDF and CSV were already written (pdfGenerator's `expense` branch, over
          the very rows this screen shows) and simply had no way in from here. The sheet
          opens on its own default month; the presets still reach a day, a week or any
          custom span, so the range above is not passed as a period. */}
      <View style={styles.rangeWrap}>
        <View style={styles.rangeFilter}>
          <DateRangeFilter value={range} onChange={setRange}
            fieldStyle={styles.rangeField} textStyle={styles.rangeText} />
        </View>
        {/* The export covers the VIEWER's own book, never the person being viewed — hidden in read-only. */}
        {!viewAs && <PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'expense' })} />}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : expenses.length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyScroll}>
          <View style={styles.emptyState}>
            <Icon name="file-text" size={40} tint={color.textMuted} />
            <View style={styles.instructions}>
              <Text style={styles.instructionText}>{t('expenseStep1')}</Text>
              <Text style={styles.instructionText}>{t('expenseStep2')}</Text>
              <Text style={styles.instructionText}>{t('expenseStep3')}</Text>
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
          contentContainerStyle={styles.listContent}
          SectionSeparatorComponent={() => <View style={styles.gap} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}

      {/* Add Button */}
      {!isKeyboardVisible && !viewAs && (
        <View style={[styles.addBtnContainer, { bottom: space.lg }]}>
          <Button label={t('expenseCreate')} icon="plus" onPress={() => navigation.navigate('AddExpenseModal')} style={styles.addBtn} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },

  dayNavRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.md, marginTop: space.xs, marginBottom: space.md,
  },
  dayNavBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radius.pill,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  dayNavBtnDisabled: { borderColor: color.border },
  dayNavFieldWrap: { flex: 1 },
  dayNavField: {
    justifyContent: 'center',
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: touchTarget,
  },
  dayNavFieldText: { ...typeScale.label, color: color.textPrimary },
  rangeWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  rangeFilter: { flex: 1 },
  rangeField: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, marginTop: space.xs,
  },
  rangeText: { ...typeScale.label, color: color.textPrimary },
  todayChip: {
    minHeight: touchTarget, paddingHorizontal: space.md, borderRadius: radius.pill,
    backgroundColor: color.accent, justifyContent: 'center',
  },
  todayChipText: { ...typeScale.label, fontWeight: typeScale.bodyMedium.fontWeight, color: color.textInverse },

  // Day header — a raised band with the day's spend.
  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, paddingVertical: chrome.dayPadY, paddingHorizontal: space.md,
    borderWidth: hairline, borderColor: color.border, marginBottom: space.sm,
  },
  dayLeft: { flex: 1 },
  dayTitle: { ...typeScale.caption, color: color.textSecondary },
  dayCount: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  dayRight: { alignItems: 'flex-end', flexShrink: 0 },
  dayColLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: 2 },

  summaryAmount: { color: color.onBrand },

  itemRow: {
    backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, marginBottom: chrome.rowGap,
    borderWidth: hairline, borderColor: color.border, minHeight: touchTarget + space.md,
  },
  itemTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.lg, marginBottom: space.xs },
  description: { ...typeScale.bodyMedium, flex: 1, color: color.textPrimary },

  itemBottomLine: { flexDirection: 'row', alignItems: 'center' },
  dateText: { ...typeScale.caption, color: color.textSecondary },
  divider: { width: hairline, height: 10, backgroundColor: color.border, marginHorizontal: space.sm },
  noteText: { ...typeScale.caption, flex: 1, color: color.textMuted },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyScroll: { flexGrow: 1, paddingBottom: chrome.listBottom, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.xl },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.lg },
  instructions: { alignItems: 'flex-start', gap: space.sm },
  instructionText: { ...typeScale.body, color: color.textSecondary },

  listContent: { padding: space.md, paddingBottom: chrome.listBottom },
  gap: { height: space.sm },
  footerSpinner: { margin: space.lg },

  addBtnContainer: { position: 'absolute', right: space.lg, alignItems: 'flex-end' },
  addBtn: { minHeight: chrome.fab, paddingHorizontal: space.lg, borderRadius: radius.pill },
});
