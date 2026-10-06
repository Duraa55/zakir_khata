import React, { useEffect, useState, useRef } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, FlatList, Dimensions, Keyboard, Platform, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTransactionStore } from '../../store/transactionStore';
import { getDayBook, getCashBalanceSummary, DayTotals } from '../../services/database/cashbookDb';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { PdfReportButton } from '../../components/ui/PdfReportButton';
import { CashEntry } from '../../types';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { formatCurrency } from '../../utils/calculations';
import { todayDate, localDate, parseDateValue } from '../../utils/dates';
import { DateField } from '../../components/ui/DateField';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget, chrome } from '../../theme/tokens';
import { Icon, AmountText, SummaryBar, SummaryFigure, SummaryDivider } from '../../components/ui/primitives';

export const CashBookScreen = ({ navigation, route }: any) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { cashSummary, loadCashBook } = useTransactionStore();
  // Opened from a staff member's Entries: only THEIR rows, and nothing can be changed.
  // Its figures live in local state — writing them into the shared store would show
  // the staff member's balance on the viewer's own Cash Book afterwards.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  const [viewAsBalance, setViewAsBalance] = useState(0);
  const [viewAsError, setViewAsError] = useState<string | null>(null);
  
  // The day being viewed. Defaults to today; stepping back shows past days on this
  // same screen. Nothing is archived or hidden when the date rolls over.
  const [viewDate, setViewDate] = useState(todayDate());
  // Tracks the real-world "today" so the view can hop to the new day on its own —
  // see the midnight-rollover effect below.
  const [today, setToday] = useState(todayDate());
  const [todayEntries, setTodayEntries] = useState<CashEntry[]>([]);
  const [dayTotals, setDayTotals] = useState<DayTotals>({ cashIn: 0, cashOut: 0, net: 0, entryCount: 0 });
  const [loading, setLoading] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  
  const pulseAnim = useRef(new Animated.Value(0)).current;

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

  const loadDailyData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (viewAs) {
        setViewAsBalance((await getCashBalanceSummary(user.id, { createdBy: viewAs.userId })).cashBalance);
      } else {
        await loadCashBook(user.id);
      }
      const { entries, dayTotals: totals } = await getDayBook(user.id, viewDate, viewAs ? { createdBy: viewAs.userId } : {});
      setViewAsError(null);
      setTodayEntries(entries);
      setDayTotals(totals);
    } catch (err: any) {
      if (__DEV__) console.error('[CashBook] day load failed:', err);
      // A refused drill-down (outside the viewer's team) says so instead of going blank.
      if (viewAs) setViewAsError(err?.message || t('cashViewAsFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadDailyData();
    });
    return unsubscribe;
  }, [navigation, user]);

  useEffect(() => {
    loadDailyData();
  }, [user, viewDate]);

  // The calendar day changes on its own — no "Close Day" action needed. As long as
  // the shopkeeper was looking at today, a midnight rollover moves the view to the
  // new day automatically; nothing is deleted, and the old day stays one tap back.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = todayDate();
      if (now !== today) {
        setViewDate(prev => (prev === today ? now : prev));
        setToday(now);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [today]);

  // Header label for the day being viewed, e.g. "Sat, 05 Sep 2026" — sentence case.
  const formatDayTitle = (value: string) => {
    const d = parseDateValue(value);
    if (!d) return value;
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = String(d.getDate()).padStart(2, '0');
    const monthName = d.toLocaleDateString('en-US', { month: 'short' });
    return `${dayName}, ${dayNum} ${monthName} ${d.getFullYear()}`;
  };

  const isToday = viewDate === today;
  const stepDay = (days: number) => {
    const base = parseDateValue(viewDate) || new Date();
    base.setDate(base.getDate() + days);
    const next = localDate(base);
    // There is nothing to browse in the future.
    if (next > today) return;
    setViewDate(next);
  };

  const formatEntryTime = (createdAt?: string, date?: string) => {
    const ts = createdAt || date;
    if (ts) {
      try {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        }
      } catch {}
    }
    return '';
  };

  // Day totals come from SQL (getDayBook) over the same predicate as the rows,
  // hierarchy-scoped like every other book — no JS reduce over the loaded list.
  const { cashIn: todayInPaisa, cashOut: todayOutPaisa, net: todayBalancePaisa } = dayTotals;


  const renderEntryItem = ({ item }: { item: CashEntry }) => {
    const isIn = item.direction === 'in';
    const timeStr = formatEntryTime(item.createdAt, item.date);

    return (
      <TouchableOpacity 
        style={styles.entryRow}
        onPress={() => navigation.navigate('CashEntryDetail', { entry: item, readOnly: !!viewAs })}
        activeOpacity={0.7}
      >
        <View style={styles.entryLeft}>
          {!!timeStr && <Text style={styles.timeText}>{timeStr}</Text>}
          <View style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={1}>{item.description || 'Cash Entry'}</Text>
          </View>
        </View>

        <View style={styles.entryAmountsRight}>
          <View style={styles.amountCol}>
            {!isIn && <AmountText paisa={item.amount_paisa} tone="out" />}
          </View>
          <View style={styles.amountCol}>
            {isIn && <AmountText paisa={item.amount_paisa} tone="in" />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Profile & Books Bar — or, when viewing a staff member's
          entries, a read-only banner (the books bar would jump to the viewer's own books). */}
      {viewAs
        ? <ReadOnlyBanner name={viewAs.name} book="Cash" onBack={() => navigation.goBack()} />
        : <TopHeaderWithBooks navigation={navigation} activeBook="CashBook" />}

      {/* Sub Header — same row and button as the Bill Book. The export opens on the day
          being viewed; the sheet's presets still offer a week, a month or a custom span. */}
      <View style={styles.subHeader}>
        {/* The export covers the viewer's whole book, not one person's — hidden in read-only. */}
        {!viewAs && (
        <PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'cash', date: viewDate })} />
        )}
      </View>

      {!!viewAsError && <Text style={styles.viewAsError}>{viewAsError}</Text>}

      {/* Summary — the dashboard's brand surface, so the two read as one app.
          Figures are white here, not green/red: the tone colours were chosen for
          contrast against white, and neither is legible on cyan. */}
      <SummaryBar>
        <SummaryFigure label={t('cashInHandAllTime')} align="center">
          <AmountText paisa={(viewAs ? viewAsBalance : cashSummary.cashBalance) || 0} size="title" fit style={styles.summaryVal} />
        </SummaryFigure>

        <SummaryDivider />

        <SummaryFigure label={t(isToday ? 'cashTodayBalance' : 'cashDayBalance')} align="center">
          <AmountText paisa={todayBalancePaisa} size="title" fit style={styles.summaryVal} />
        </SummaryFigure>

        <SummaryDivider />

        <TouchableOpacity
          style={styles.summaryAction}
          onPress={() => (viewAs ? navigation.navigate('CashHistory', { viewAs }) : navigation.navigate('CashHistory'))}
          activeOpacity={0.7}
        >
          <Icon name="clock" size={iconSize.md} tint={color.onBrand} />
          <Text style={styles.historyText}>{t('cashHistory')}</Text>
        </TouchableOpacity>
      </SummaryBar>

      {/* Day navigator — past days are this same screen, not a separate list */}
      <View style={styles.dayNavRow}>
        <TouchableOpacity onPress={() => stepDay(-1)} style={styles.dayNavBtn} activeOpacity={0.7}>
          <Icon name="chevron-left" size={iconSize.md} tint={color.textPrimary} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <DateField
            value={viewDate}
            onChange={setViewDate}
            maximumDate={new Date()}
            style={styles.dayNavField}
            textStyle={styles.dayNavFieldText}
          />
        </View>

        <TouchableOpacity
          onPress={() => stepDay(1)}
          style={[styles.dayNavBtn, isToday && styles.dayNavBtnDisabled]}
          disabled={isToday}
          activeOpacity={0.7}
        >
          <Icon name="chevron-right" size={iconSize.md} tint={isToday ? color.textMuted : color.textPrimary} />
        </TouchableOpacity>

        {!isToday && (
          <TouchableOpacity onPress={() => setViewDate(today)} style={styles.todayChip} activeOpacity={0.7}>
            <Text style={styles.todayChipText}>{t('commonToday')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Date Header Banner */}
      <View style={styles.dateHeaderBanner}>
        <View style={styles.dateHeaderLeft}>
          <Text style={styles.dateTitle}>{formatDayTitle(viewDate)}</Text>
          <Text style={styles.entriesCountText}>
            {dayTotals.entryCount} {dayTotals.entryCount === 1 ? t('commonEntry') : t('commonEntries')}
          </Text>
        </View>

        <View style={styles.dateHeaderRight}>
          <View style={styles.totalsHeaderRow}>
            <Text style={[styles.columnLabel, { color: color.textSecondary }]}>{t('commonOut')}</Text>
            <Text style={[styles.columnLabel, { color: color.textSecondary }]}>{t('commonIn')}</Text>
          </View>
          <View style={styles.totalsValueRow}>
            <AmountText paisa={todayOutPaisa} tone="out" size="label" />
            <AmountText paisa={todayInPaisa} tone="in" size="label" />
          </View>
        </View>
      </View>

      {/* Daily Entries List */}
      <FlatList
        data={todayEntries}
        keyExtractor={item => item.id}
        renderItem={renderEntryItem}
        contentContainerStyle={{ paddingBottom: chrome.listBottom, paddingTop: 4 }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="inbox" size={32} tint={color.textMuted} />
            <Text style={styles.emptyTitle}>{isToday ? t('cashNoEntriesToday') : t('cashNoEntriesThisDay')}</Text>
            <Text style={styles.emptySubtitle}>{viewAs ? `${viewAs.name} made no cash entries on this day.` : t('cashTapToRecord')}</Text>
          </View>
        }
      />

      {/* Bottom Action Row (Cash Out / Cash In) - Hidden when typing / keyboard open */}
      {/* Read-only: no way to add an entry for someone else. */}
      {!isKeyboardVisible && !viewAs && (
        <View style={[styles.actionRow, { marginBottom: 0 }]}>
          {/* A matched pair, coloured by MEANING: these two buttons are money out and
              money in. Both carry white text (6.47:1 and 5.02:1 on their fills). */}
          <TouchableOpacity
            style={[styles.cashBtn, styles.cashBtnOut]}
            onPress={() => navigation.navigate('CashOutModal', { mode: 'out', date: viewDate })}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Icon name="arrow-up-right" size={iconSize.sm} tint={color.textInverse} />
            <Text style={styles.btnText} numberOfLines={1}>{t('dashCashOut')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cashBtn, styles.cashBtnIn]}
            onPress={() => navigation.navigate('CashInModal', { mode: 'in', date: viewDate })}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Icon name="arrow-down-left" size={iconSize.sm} tint={color.textInverse} />
            <Text style={styles.btnText} numberOfLines={1}>{t('dashCashIn')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },

  subHeader: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: space.lg, paddingTop: chrome.barPadY,
  },
  // Flat: one step of tone and a hairline, no shadow or elevation.
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surfaceRaised, marginHorizontal: space.lg,
    marginTop: chrome.cardMarginY, marginBottom: chrome.cardMarginY,
    borderRadius: radius.lg, paddingVertical: chrome.cardPadY, paddingHorizontal: space.lg,
    borderWidth: hairline, borderColor: color.border,
  },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryAction: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryVal: { textAlign: 'center', color: color.onBrand },
  summarySubLabel: { ...typeScale.caption, color: color.textSecondary, marginTop: 2, textAlign: 'center' },
  summaryDivider: { width: hairline, height: 28, backgroundColor: color.border },
  historyText: { ...typeScale.caption, color: color.onBrandMuted, marginTop: 2 },

  dayNavRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: space.xs, marginBottom: space.sm,
  },
  dayNavBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayNavBtnDisabled: { opacity: 0.4 },
  dayNavField: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget,
  },
  dayNavFieldText: { ...typeScale.label, color: color.textPrimary },
  todayChip: {
    paddingHorizontal: space.md, minHeight: touchTarget, justifyContent: 'center',
    borderRadius: radius.pill, backgroundColor: color.accent,
  },
  todayChipText: { ...typeScale.label, color: color.textInverse },

  dateHeaderBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: color.surface, marginHorizontal: space.lg, marginBottom: space.sm,
    borderRadius: radius.md, paddingVertical: chrome.dayPadY, paddingHorizontal: space.lg,
    borderWidth: hairline, borderColor: color.border,
  },
  // flex: 1 so a long day title takes the slack rather than squeezing the figures.
  dateHeaderLeft: { flex: 1, marginRight: space.md },
  dateTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  entriesCountText: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },

  dateHeaderRight: { alignItems: 'flex-end', flexShrink: 0 },
  totalsHeaderRow: { flexDirection: 'row', gap: space.lg, marginBottom: 2 },
  totalsValueRow: { flexDirection: 'row', gap: space.lg },
  columnLabel: { ...typeScale.caption, minWidth: 60, textAlign: 'right' },

  entryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: color.surface, borderRadius: radius.md,
    paddingVertical: chrome.rowPadY, paddingHorizontal: space.lg,
    marginBottom: chrome.rowGap, marginHorizontal: space.lg,
    borderWidth: hairline, borderColor: color.border,
    minHeight: touchTarget,
  },
  entryLeft: { flex: 1, marginRight: space.sm },
  timeText: { ...typeScale.caption, color: color.textMuted, marginBottom: 2 },
  chip: { alignSelf: 'flex-start' },
  chipText: { ...typeScale.body, color: color.textPrimary },

  entryAmountsRight: { flexDirection: 'row', gap: space.md, alignItems: 'center', flexShrink: 0 },
  amountCol: { minWidth: 60, alignItems: 'flex-end', justifyContent: 'center' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxxl * 1.5, gap: space.sm },
  emptyTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  emptySubtitle: { ...typeScale.label, color: color.textSecondary, textAlign: 'center' },

  actionRow: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', gap: space.md,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderTopWidth: hairline, borderTopColor: color.border,
  },
  cashBtn: {
    flex: 1, minHeight: touchTarget, borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  cashBtnIn: { backgroundColor: color.moneyIn },
  cashBtnOut: { backgroundColor: color.moneyOut },
  btnText: { ...typeScale.bodyMedium, color: color.textInverse },
  viewAsError: { ...typeScale.label, color: color.moneyOut, paddingHorizontal: space.lg, paddingTop: space.sm },
});
