import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getCashFlowSummary, CashFlowSummary } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatSignedCurrency } from '../../utils/calculations';
import { handleReportExport } from '../../utils/exportUtils';
import { ReportScreen, ReportIntro, FigureCard, FigureRow, ReportSection, BarList, BarRow } from '../../components/reports/ReportParts';

type Props = StackScreenProps<any, any>;

/** Your own Cash Book over the range: what you started with, what came in and out, what is left. */
export const CashFlowReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<CashFlowSummary | null>(null);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      setSummary(await getCashFlowSummary(user.id, newFilter));
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
    const data = [
      { Metric: 'Opening cash', Amount: formatSignedCurrency(summary.openingCash) },
      { Metric: 'Cash in', Amount: formatSignedCurrency(summary.cashIn) },
      { Metric: 'Cash out', Amount: formatSignedCurrency(summary.cashOut) },
      { Metric: 'Net cash flow', Amount: formatSignedCurrency(summary.netCashFlow) },
      { Metric: 'Closing cash', Amount: formatSignedCurrency(summary.closingCash) },
    ];
    handleReportExport(`Cash_Flow_${filterLabel}`, data, 'Cash Flow');
  };

  const max = summary ? Math.max(summary.cashIn, summary.cashOut, 1) : 1;

  return (
    <ReportScreen title={t('repCashFlow')} onBack={() => navigation.goBack()} onExport={handleExport} loading={loading}>
      <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />
      {!loading && summary && (
        <>
          <ReportIntro>Your own Cash Book over the period you picked above.</ReportIntro>
          <FigureCard>
            <FigureRow label={t('repClosingCash')} hint="What you had at the end of the period" paisa={summary.closingCash} big />
            <FigureRow label={t('repNetCashFlow')} hint="Cash in minus cash out" paisa={summary.netCashFlow} />
          </FigureCard>

          <ReportSection title={t('repCashMovement')}>
            <FigureCard>
              <FigureRow label={t('repOpeningCash')} hint="What you had before the period" paisa={summary.openingCash} />
              <FigureRow label={t('cashIn')} paisa={summary.cashIn} tone="in" />
              <FigureRow label={t('cashOut')} paisa={summary.cashOut} tone="out" />
              <FigureRow label={t('repClosingCash')} paisa={summary.closingCash} />
            </FigureCard>
          </ReportSection>

          <ReportSection title={t('repInOutCompared')}>
            <BarList>
              <BarRow label={t('cashIn')} paisa={summary.cashIn} max={max} tone="in" first />
              <BarRow label={t('cashOut')} paisa={summary.cashOut} max={max} tone="out" />
            </BarList>
          </ReportSection>
        </>
      )}
    </ReportScreen>
  );
};
