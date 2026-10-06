import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getProfitLossSummary, ProfitLossSummary } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatSignedCurrency } from '../../utils/calculations';
import { handleReportExport } from '../../utils/exportUtils';
import { ReportScreen, ReportIntro, FigureCard, FigureRow, ReportSection, BarList, BarRow, EmptyNote } from '../../components/reports/ReportParts';
import { soleTotal, stackedTotalText, type CurrencyTotal } from '../../utils/currencyTotals';

type Props = StackScreenProps<any, any>;

/** What a derived figure says when the period spans currencies and cannot produce one. */
const NOT_ACROSS = 'Not shown across currencies';

/**
 * What you earned: sales (posted bills, returns taken off) minus the cost of the goods
 * you kept sold, minus expenses. Profit is a balance, so it is neutral ink with a sign.
 */
export const ProfitLossReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ProfitLossSummary | null>(null);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      setSummary(await getProfitLossSummary(user.id, newFilter));
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
    if (!summary) return;
    const stack = (totals: CurrencyTotal[]) => stackedTotalText(totals, formatSignedCurrency, ' / ');
    const derived = (v: number | null) =>
      summary.profitAvailable && v !== null ? formatSignedCurrency(v, summary.profitCurrency) : NOT_ACROSS;
    const data = [
      { Metric: 'Sales (after returns)', Amount: stack(summary.totalRevenue) },
      { Metric: 'Cost of goods sold', Amount: stack(summary.totalCOGS) },
      { Metric: 'Gross profit', Amount: derived(summary.grossProfit) },
      { Metric: 'Expenses', Amount: stack(summary.totalExpenses) },
      { Metric: 'Net profit', Amount: derived(summary.netProfit) },
      { Metric: 'Profit margin', Amount: summary.profitAvailable && summary.profitMarginPct !== null
          ? summary.profitMarginPct.toFixed(2) + '%' : NOT_ACROSS },
    ];
    handleReportExport(`Profit_Loss_${filterLabel}`, data, 'P&L');
  };

  // The comparison bars put three figures on ONE scale, which only exists when all
  // three are in one currency — the same condition that lets profit be computed at all.
  // Otherwise the bars are dropped rather than drawn against a scale that means nothing.
  const scalar = (totals: CurrencyTotal[]) => soleTotal(totals)?.amount ?? 0;
  const comparable = !!summary && summary.profitAvailable;
  const max = summary && comparable
    ? Math.max(scalar(summary.totalRevenue), scalar(summary.totalCOGS), scalar(summary.totalExpenses), 1)
    : 1;

  return (
    <ReportScreen title={t('repPnl')} onBack={() => navigation.goBack()} onExport={handleExport} loading={loading}>
      <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />
      {!loading && summary && (
        <>
          <ReportIntro>Posted bills only — drafts and bills on hold are not sales, and returned goods are taken off.</ReportIntro>
          {summary.profitAvailable ? (
            <FigureCard>
              <FigureRow label={t('repNetProfit')} hint={`${(summary.profitMarginPct ?? 0).toFixed(1)}% of sales`}
                paisa={summary.netProfit ?? 0} currency={summary.profitCurrency ?? undefined} big />
            </FigureCard>
          ) : (
            <EmptyNote>
              This period holds more than one currency, so there is no single profit figure —
              subtracting AED from rupees needs an exchange rate this app does not keep. Sales,
              cost and expenses are shown per currency below.
            </EmptyNote>
          )}

          <ReportSection title={t('repHowItAddsUp')}>
            <FigureCard>
              <FigureRow label={t('repSales')} hint="Posted bills, after returns" totals={summary.totalRevenue} tone="in" signed={false} />
              <FigureRow label={t('repCogs')} hint="What the items you sold cost you" totals={summary.totalCOGS} tone="out" signed={false} />
              {summary.profitAvailable
                ? <FigureRow label={t('repGrossProfit')} hint="Sales minus cost of goods" paisa={summary.grossProfit ?? 0} currency={summary.profitCurrency ?? undefined} />
                : <FigureRow label={t('repGrossProfit')} hint="Sales minus cost of goods" note={NOT_ACROSS} />}
              <FigureRow label={t('repExpenses')} hint="From the Expense Book" totals={summary.totalExpenses} tone="out" signed={false} />
              {summary.profitAvailable
                ? <FigureRow label={t('repNetProfit')} hint="Gross profit minus expenses" paisa={summary.netProfit ?? 0} currency={summary.profitCurrency ?? undefined} />
                : <FigureRow label={t('repNetProfit')} hint="Gross profit minus expenses" note={NOT_ACROSS} />}
            </FigureCard>
          </ReportSection>

          {comparable && (
            <ReportSection title={t('repCompared')}>
              <BarList>
                <BarRow label={t('repSales')} paisa={scalar(summary.totalRevenue)} currency={summary.profitCurrency ?? undefined} max={max} tone="in" first />
                <BarRow label={t('repCogs')} paisa={scalar(summary.totalCOGS)} currency={summary.profitCurrency ?? undefined} max={max} tone="out" />
                <BarRow label={t('repExpenses')} paisa={scalar(summary.totalExpenses)} currency={summary.profitCurrency ?? undefined} max={max} tone="out" />
              </BarList>
            </ReportSection>
          )}
        </>
      )}
    </ReportScreen>
  );
};
