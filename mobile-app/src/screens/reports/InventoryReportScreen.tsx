import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getInventorySummary, getProductPerformance, InventorySummary, ProductPerformanceGroup } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatSignedCurrency } from '../../utils/calculations';
import { handleReportExport } from '../../utils/exportUtils';
import { AmountText } from '../../components/ui/primitives';
import { ReportScreen, ReportIntro, FigureCard, FigureRow, ReportSection, BarList, BarRow, EmptyNote, StatTile, TileRow, CurrencyHeading } from '../../components/reports/ReportParts';

type Props = StackScreenProps<any, any>;

/** Stock on hand (today) and what sold best in the period. */
export const InventoryReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [performance, setPerformance] = useState<ProductPerformanceGroup[]>([]);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      const [sum, perf] = await Promise.all([
        getInventorySummary(user.id),
        getProductPerformance(user.id, newFilter.startDate, newFilter.endDate, 'revenue', 'DESC', 10),
      ]);
      setSummary(sum);
      setPerformance(perf);
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
    if (performance.length === 0) return;
    // Currency is its own column, and profit is blank outside the account's own
    // currency because the cost side of it has no currency at all.
    const data = performance.flatMap(g => g.rows.map(p => ({
      'Item': p.itemName,
      'Currency': g.currency,
      'Qty sold': p.quantitySold,
      'Revenue': formatSignedCurrency(p.revenue, g.currency),
      'Profit': p.profit === null ? '—' : formatSignedCurrency(p.profit, g.currency),
    })));
    handleReportExport(`Inventory_Performance_${filterLabel}`, data, 'Products');
  };

  // One scale per currency: a revenue bar only ever compares items priced alike.
  const max = (g: ProductPerformanceGroup) => Math.max(1, ...g.rows.map(p => p.revenue));
  const mixed = performance.length > 1;

  return (
    <ReportScreen title={t('repInventory')} onBack={() => navigation.goBack()} onExport={handleExport} loading={loading}>
      <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />
      {!loading && summary && (
        <>
          <ReportIntro>Stock figures are as of today; best sellers follow the period you picked above.</ReportIntro>

          <TileRow>
            <StatTile label={t('repItemsInStock')} value={summary.totalItems} icon="package" />
            <StatTile label={t('stockLowStock')} value={summary.lowStockCount} icon="alert-triangle" tone={summary.lowStockCount > 0 ? 'attention' : undefined} />
          </TileRow>
          <TileRow>
            <StatTile label={t('repOutOfStock')} value={summary.outOfStockCount} icon="x-circle" tone={summary.outOfStockCount > 0 ? 'attention' : undefined} />
            <StatTile label={t('repStockValueSale')} value={<AmountText paisa={summary.totalSellingValue} fit />} icon="tag" />
          </TileRow>

          <FigureCard>
            <FigureRow label={t('repStockAtCost')} hint="What the stock on hand cost you" paisa={summary.totalValue} signed={false} />
            <FigureRow label={t('repStockAtSale')} hint="What it sells for" paisa={summary.totalSellingValue} signed={false} />
            <FigureRow label={t('repExpectedProfit')} hint="Sale price minus cost, if all of it sells" paisa={summary.expectedProfit} />
          </FigureCard>

          <ReportSection title={t('repBestSellers')}>
            {performance.length > 0 ? performance.map(g => (
              <React.Fragment key={g.currency}>
                <CurrencyHeading code={g.currency} show={mixed} />
                <BarList>
                  {g.rows.map((p, i) => (
                    <BarRow key={`${g.currency}-${p.itemId || i}`} first={i === 0} label={`${i + 1}. ${p.itemName}`}
                      detail={p.profit === null
                        ? `${p.quantitySold} sold`
                        : `${p.quantitySold} sold · profit ${formatSignedCurrency(p.profit, g.currency)}`}
                      paisa={p.revenue} currency={g.currency} max={max(g)} />
                  ))}
                </BarList>
              </React.Fragment>
            )) : <EmptyNote>No sales in this period.</EmptyNote>}
          </ReportSection>
        </>
      )}
    </ReportScreen>
  );
};
