import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getSalesReportSummary, getSalesTrend, SalesSummary, SalesTrendData } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatSignedCurrency } from '../../utils/calculations';
import { formatDisplayDate } from '../../utils/dates';
import { handleReportExport } from '../../utils/exportUtils';
import { Card, SectionHeader, AmountText, AmountStack, Icon } from '../../components/ui/primitives';
import { soleTotal, stackedTotalText, isMixed } from '../../utils/currencyTotals';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

type Props = StackScreenProps<any, any>;

export const SalesReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [trend, setTrend] = useState<SalesTrendData[]>([]);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      const sum = await getSalesReportSummary(user.id, newFilter);
      const trn = await getSalesTrend(user.id, newFilter, 'day');
      setSummary(sum);
      setTrend(trn);
    } catch (e) {
      if (__DEV__) console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(filter);
  }, [filter, user]);

  const handleExport = async () => {
    if (!summary || trend.length === 0) return;
    try {
      // Amounts are formatted, not raw paisa — a raw 150000 in the file reads as
      // Rs. 1,50,000 for a Rs. 1,500 sale.
      // A day that spans currencies exports BOTH figures on their own lines — the same
      // lines the screen shows. It must never collapse to one number here either.
      const data = trend.map(t => ({
        Date: t.date,
        'Total Sales': stackedTotalText(t.total, formatSignedCurrency, ' / '),
        'Number of Bills': t.count
      }));
      data.push({
        Date: 'Total',
        'Total Sales': stackedTotalText(summary.totalSales, formatSignedCurrency, ' / '),
        'Number of Bills': summary.totalBills,
      });
      handleReportExport(`Sales_Report_${filterLabel}`, data, 'Sales');
    } catch (e) {
      if (__DEV__) console.error('Export failed', e);
    }
  };

  // Newest day first, so today's figure is the first thing read. The bar only
  // compares days with each other; the exact amount sits beside it.
  const days = [...trend].reverse();
  // A bar compares days with one another. Across currencies there is nothing to
  // compare, so when the range is mixed the bars go away and the figures stand alone —
  // a single-currency range keeps exactly the bars it always had.
  const spansCurrencies = isMixed(summary?.totalSales ?? []) || trend.some(t => isMixed(t.total));
  const busiest = Math.max(1, ...trend.map(t => soleTotal(t.total)?.amount ?? 0));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('repSalesTitle')}</Text>
        <TouchableOpacity onPress={handleExport} style={[styles.headerBtn, { alignItems: 'flex-end' }]}>
          <Text style={styles.exportText}>{t('repExport')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />

        {loading ? (
          <ActivityIndicator size="large" color={color.accent} style={{ marginTop: space.xxxl }} />
        ) : summary ? (
          <>
            <Text style={styles.intro}>{t('repSalesIntro')}</Text>

            {/* Headline figures, each with one line saying what it means. */}
            <Card tone="outlined" style={styles.figures}>
              <View style={styles.figureRow}>
                <View style={styles.figureText}>
                  <Text style={styles.figureLabel}>{t('repTotalSales')}</Text>
                  <Text style={styles.figureHint}>{t('repAllBillsAdded')}</Text>
                </View>
                <AmountStack totals={summary.totalSales} size="title" />
              </View>

              <View style={styles.divider} />

              <View style={styles.figureRow}>
                <View style={styles.figureText}>
                  <Text style={styles.figureLabel}>{t('repBillsMade')}</Text>
                  <Text style={styles.figureHint}>{t('repBillsMadeDesc')}</Text>
                </View>
                <Text style={styles.count}>{summary.totalBills}</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.figureRow}>
                <View style={styles.figureText}>
                  <Text style={styles.figureLabel}>{t('repAverageBill')}</Text>
                  <Text style={styles.figureHint}>{t('repAverageBillDesc')}</Text>
                </View>
                <AmountStack totals={summary.averageBillValue} />
              </View>
            </Card>

            <View style={styles.section}>
              <SectionHeader title={t('repSalesByDay')} />
              {days.length > 0 ? (
                <Card tone="outlined" padded={false}>
                  {days.map((d, i) => (
                    <View key={d.date} style={[styles.dayRow, i > 0 && styles.dayRowBorder]}>
                      <View style={styles.dayTop}>
                        <View style={styles.figureText}>
                          <Text style={styles.dayDate}>{formatDisplayDate(d.date)}</Text>
                          <Text style={styles.figureHint}>{d.count} {d.count === 1 ? 'bill' : 'bills'}</Text>
                        </View>
                        <AmountStack totals={d.total} />
                      </View>
                      {!spansCurrencies && (
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${Math.max(2, ((soleTotal(d.total)?.amount ?? 0) / busiest) * 100)}%` }]} />
                        </View>
                      )}
                    </View>
                  ))}
                </Card>
              ) : (
                <Card tone="outlined">
                  <Text style={styles.empty}>{t('repNoBills')}</Text>
                </Card>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, height: 56, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  headerBtn: { minWidth: touchTarget, height: touchTarget, justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  exportText: { ...typeScale.bodyMedium, color: color.accent },

  scroll: { flex: 1, backgroundColor: color.surface },
  content: { padding: space.lg, paddingBottom: space.xxxl },

  intro: { ...typeScale.label, color: color.textSecondary, marginBottom: space.md },

  figures: { gap: space.md },
  // Label takes the slack (Urdu runs ~40% longer); the figure never shrinks.
  figureRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  figureText: { flex: 1 },
  figureLabel: { ...typeScale.bodyMedium, color: color.textPrimary },
  figureHint: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  count: { ...typeScale.title, color: color.textPrimary, flexShrink: 0 },
  divider: { height: hairline, backgroundColor: color.border },

  section: { marginTop: space.xxl },
  dayRow: { paddingVertical: space.md, paddingHorizontal: space.lg },
  dayRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  dayTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dayDate: { ...typeScale.body, color: color.textPrimary },
  barTrack: {
    height: 6, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    marginTop: space.sm, overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.pill, backgroundColor: color.accent },

  empty: { ...typeScale.body, color: color.textMuted },
});
