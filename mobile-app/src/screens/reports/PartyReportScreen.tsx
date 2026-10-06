import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getCustomerPerformance, getKhataSummary, CustomerPerformanceGroup, KhataSummary } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatCurrency, formatSignedCurrency } from '../../utils/calculations';
import { formatDisplayDate, toDateValue } from '../../utils/dates';
import { handleReportExport } from '../../utils/exportUtils';
import { ReportScreen, ReportIntro, ReportSection, BarList, BarRow, EmptyNote, ReportTabs, CurrencyHeading } from '../../components/reports/ReportParts';

type Props = StackScreenProps<any, any>;

/**
 * Who buys most (posted bills) and the Khata balances. Lena = credit given (red — the
 * customer owes it), dena = payment taken (green); a balance still owed is red.
 */
export const PartyReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerPerformanceGroup[]>([]);
  const [khata, setKhata] = useState<KhataSummary[]>([]);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');
  const [activeTab, setActiveTab] = useState<'customers' | 'khata'>('customers');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      const [cust, khat] = await Promise.all([
        getCustomerPerformance(user.id, newFilter, 'totalPurchases', 10),
        getKhataSummary(user.id, newFilter, 'all', 10),
      ]);
      setCustomers(cust);
      setKhata(khat);
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
    if (activeTab === 'customers' && customers.length > 0) {
      // Flattened for the sheet, but every row names its own currency: without that
      // column the figures are bare numbers that cannot be compared or summed.
      const data = customers.flatMap(g => g.rows.map(c => ({
        'Customer': c.customerName,
        'Currency': g.currency,
        'Total purchases': formatSignedCurrency(c.totalPurchases, g.currency),
        'Total paid': formatSignedCurrency(c.totalPaid, g.currency),
        'Total due': formatSignedCurrency(c.totalDue, g.currency),
        'Last active': c.lastActive
      })));
      handleReportExport(`Customer_Performance_${filterLabel}`, data, 'Customers');
    } else if (activeTab === 'khata' && khata.length > 0) {
      const data = khata.map(k => ({
        'Party': k.partyName,
        'Credit given (lena)': formatSignedCurrency(k.totalLena),
        'Payments taken (dena)': formatSignedCurrency(k.totalDena),
        'Balance to receive': formatSignedCurrency(k.netBalance)
      }));
      handleReportExport(`Khata_Balances_${filterLabel}`, data, 'Khata');
    }
  };

  // One scale PER CURRENCY: a bar compares rows with each other, and rows in two
  // currencies are not comparable, so they never share a scale.
  const custMax = (g: CustomerPerformanceGroup) => Math.max(1, ...g.rows.map(c => c.totalPurchases));
  const mixed = customers.length > 1;
  const khataMax = Math.max(1, ...khata.map(k => Math.abs(k.netBalance)));

  return (
    <ReportScreen title={t('repCustomers')} onBack={() => navigation.goBack()} onExport={handleExport} loading={loading}>
      <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />
      <ReportTabs
        value={activeTab}
        onChange={setActiveTab}
        options={[{ id: 'customers', label: 'Top buyers' }, { id: 'khata', label: 'Khata balances' }]}
      />
      {!loading && activeTab === 'customers' && (
        <>
          <ReportIntro>
            {mixed
              ? 'Customers ranked by what they bought (posted bills) in the period — ranked separately per currency, because Rs and AED cannot be compared without a rate.'
              : 'Customers ranked by what they bought (posted bills) in the period.'}
          </ReportIntro>
          <ReportSection title={t('repTop10Purchases')}>
            {customers.length > 0 ? customers.map(g => (
              <React.Fragment key={g.currency}>
                <CurrencyHeading code={g.currency} show={mixed} />
                <BarList>
                  {g.rows.map((c, i) => (
                    <BarRow key={`${c.customerId}-${c.customerName}-${i}`} first={i === 0} label={`${i + 1}. ${c.customerName}`}
                      detail={`Due ${formatCurrency(c.totalDue, g.currency)} · last ${formatDisplayDate(toDateValue(c.lastActive) || c.lastActive)}`}
                      paisa={c.totalPurchases} currency={g.currency} max={custMax(g)} />
                  ))}
                </BarList>
              </React.Fragment>
            )) : <EmptyNote>No bills in this period.</EmptyNote>}
          </ReportSection>
        </>
      )}
      {!loading && activeTab === 'khata' && (
        <>
          <ReportIntro>Balances from Khata entries in the period — red is still owed to you.</ReportIntro>
          <ReportSection title={t('repTop10Balances')}>
            {khata.length > 0 ? (
              <BarList>
                {khata.map((k, i) => (
                  <BarRow key={`${k.partyName}-${i}`} first={i === 0} label={`${i + 1}. ${k.partyName}`}
                    detail={`Lena ${formatCurrency(k.totalLena)} · dena ${formatCurrency(k.totalDena)}`}
                    paisa={k.netBalance} max={khataMax} tone={k.netBalance > 0 ? 'out' : k.netBalance < 0 ? 'in' : 'neutral'} />
                ))}
              </BarList>
            ) : <EmptyNote>No Khata entries in this period.</EmptyNote>}
          </ReportSection>
        </>
      )}
    </ReportScreen>
  );
};
