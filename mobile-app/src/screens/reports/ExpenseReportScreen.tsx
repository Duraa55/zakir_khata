import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getExpenseSummary, getExpenseTrend, ExpenseCategoryGroup } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatSignedCurrency } from '../../utils/calculations';
import { handleReportExport } from '../../utils/exportUtils';
import { ReportScreen, ReportIntro, FigureCard, FigureRow, ReportSection, BarList, BarRow, EmptyNote, CurrencyHeading } from '../../components/reports/ReportParts';
import { soleTotal, isMixed, type CurrencyTotal } from '../../utils/currencyTotals';

type Props = StackScreenProps<any, any>;

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
};

/** Where the money went: total, by category, and month by month. Expenses are money out (red). */
export const ExpenseReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ totalExpenses: CurrencyTotal[]; byCurrency: ExpenseCategoryGroup[] } | null>(null);
  const [trend, setTrend] = useState<{ date: string; total: CurrencyTotal[] }[]>([]);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      const [sum, trn] = await Promise.all([getExpenseSummary(user.id, newFilter), getExpenseTrend(user.id, newFilter)]);
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
    if (!summary) return;
    // A Currency column, and one Total row PER CURRENCY: a single "Total" over a mixed
    // period would be a number with no unit, and a share of it would be meaningless.
    const data = summary.byCurrency.flatMap(g => [
      ...g.categories.map(c => ({
        Category: c.category,
        Currency: g.currency,
        Amount: formatSignedCurrency(c.total, g.currency),
        'Share %': c.percentage.toFixed(2) + '%',
      })),
      { Category: 'Total', Currency: g.currency, Amount: formatSignedCurrency(g.total, g.currency), 'Share %': '100%' },
    ]);
    handleReportExport(`Expense_Report_${filterLabel}`, data, 'Expenses');
  };

  // One scale per currency group — bars only ever compare rows inside one currency.
  const catMax = (g: ExpenseCategoryGroup) => Math.max(1, ...g.categories.map(c => c.total));
  const mixed = (summary?.byCurrency.length ?? 0) > 1;
  const months = [...trend].reverse();
  // The month bars share one scale, which only exists while every month is single-currency.
  const monthsComparable = !trend.some(t => isMixed(t.total)) && !mixed;
  const monthMax = Math.max(1, ...trend.map(t => soleTotal(t.total)?.amount ?? 0));

  return (
    <ReportScreen title={t('repExpenseTitle')} onBack={() => navigation.goBack()} onExport={handleExport} loading={loading}>
      <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />
      {!loading && summary && (
        <>
          <ReportIntro>Everything recorded in the Expense Book in the period you picked above.</ReportIntro>
          <FigureCard>
            <FigureRow label={t('repTotalExpenses')} hint="All expenses added together" totals={summary.totalExpenses} tone="out" signed={false} big />
          </FigureCard>

          <ReportSection title={t('repByCategory')}>
            {summary.byCurrency.length > 0 ? summary.byCurrency.map(g => (
              <React.Fragment key={g.currency}>
                <CurrencyHeading code={g.currency} show={mixed} />
                <BarList>
                  {g.categories.map((c, i) => (
                    <BarRow key={`${g.currency}-${c.category || i}`} first={i === 0} label={c.category || 'Uncategorised'}
                      detail={`${c.percentage.toFixed(0)}% of the ${g.currency} total`}
                      paisa={c.total} currency={g.currency} max={catMax(g)} tone="out" />
                  ))}
                </BarList>
              </React.Fragment>
            )) : <EmptyNote>No expenses in this period.</EmptyNote>}
          </ReportSection>

          <ReportSection title={t('repMonthByMonth')}>
            {months.length > 0 ? (
              <BarList>
                {months.map((m, i) => (
                  <BarRow key={m.date} first={i === 0} label={monthLabel(m.date)}
                    totals={m.total} max={monthsComparable ? monthMax : 0} tone="out" />
                ))}
              </BarList>
            ) : <EmptyNote>No expenses in this period.</EmptyNote>}
          </ReportSection>
        </>
      )}
    </ReportScreen>
  );
};
