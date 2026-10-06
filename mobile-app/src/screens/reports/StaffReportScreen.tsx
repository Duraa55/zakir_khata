import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, StyleSheet } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { getStaffPerformance, getStaffAttendanceSummary, StaffPerformance, StaffAttendanceSummary } from '../../services/database/reports';
import { DateFilterPicker, presetRange } from '../../components/reports/DateFilterPicker';
import { formatSignedCurrency } from '../../utils/calculations';
import { handleReportExport } from '../../utils/exportUtils';
import { Card } from '../../components/ui/primitives';
import { ReportScreen, ReportIntro, ReportSection, BarList, BarRow, EmptyNote, ReportTabs } from '../../components/reports/ReportParts';
import { color, space, hairline, type as typeScale } from '../../theme/tokens';
import { soleTotal, stackedTotalText, isMixed } from '../../utils/currencyTotals';

type Props = StackScreenProps<any, any>;

/**
 * The people who report directly to you: what each recorded in the period (sales from
 * posted bills, bills, expenses) and their attendance. An admin sees their staff; a
 * staff member has nobody below them, so their report is empty.
 */
export const StaffReportScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [performance, setPerformance] = useState<StaffPerformance[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendanceSummary[]>([]);
  // Starts on the same range the picker shows by default, not all-time.
  const [filter, setFilter] = useState(() => presetRange('currentMonth'));
  const [filterLabel, setFilterLabel] = useState('Current Month');
  const [activeTab, setActiveTab] = useState<'performance' | 'attendance'>('performance');

  const loadData = async (newFilter: any) => {
    if (!user) return;
    setLoading(true);
    try {
      const [perf, att] = await Promise.all([
        getStaffPerformance(user.id, newFilter),
        getStaffAttendanceSummary(user.id, newFilter),
      ]);
      setPerformance(perf);
      setAttendance(att);
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
    if (activeTab === 'performance' && performance.length > 0) {
      const data = performance.map(p => ({
        'Staff': p.staffName,
        'Sales': stackedTotalText(p.salesGenerated, formatSignedCurrency, ' / '),
        'Bills': p.billsCreated,
        'Expenses': p.expensesAdded,
        'Activities': p.activitiesCount
      }));
      handleReportExport(`Staff_Performance_${filterLabel}`, data, 'Performance');
    } else if (activeTab === 'attendance' && attendance.length > 0) {
      const data = attendance.map(a => ({
        'Staff': a.staffName,
        'Present': a.daysPresent,
        'Absent': a.daysAbsent,
        'Half days': a.daysHalfDay,
        'Days logged': a.daysPresent + a.daysAbsent + a.daysHalfDay
      }));
      handleReportExport(`Staff_Attendance_${filterLabel}`, data, 'Attendance');
    }
  };

  // Sales bars share one scale, which only exists while every person sold in the same
  // single currency. Otherwise the figures stack and the bars go — the list is ordered
  // by bills created, a count, so the ordering never depends on a currency either.
  const salesComparable = !performance.some(p => isMixed(p.salesGenerated))
    && new Set(performance.map(p => soleTotal(p.salesGenerated)?.currency)).size <= 1;
  const max = Math.max(1, ...performance.map(p => soleTotal(p.salesGenerated)?.amount ?? 0));

  return (
    <ReportScreen title={t('repStaff')} onBack={() => navigation.goBack()} onExport={handleExport} loading={loading}>
      <DateFilterPicker onFilterChange={(f, l) => { setFilter(f); setFilterLabel(l); }} />
      <ReportTabs
        value={activeTab}
        onChange={setActiveTab}
        options={[{ id: 'performance', label: 'Work done' }, { id: 'attendance', label: 'Attendance' }]}
      />
      {!loading && activeTab === 'performance' && (
        <>
          <ReportIntro>Only the people who report directly to you.</ReportIntro>
          <ReportSection title={t('repSalesAndEntries')}>
            {performance.length > 0 ? (
              <BarList>
                {performance.map((p, i) => (
                  <BarRow key={p.staffId} first={i === 0} label={p.staffName}
                    detail={`${p.billsCreated} ${p.billsCreated === 1 ? 'bill' : 'bills'} · ${p.expensesAdded} ${p.expensesAdded === 1 ? 'expense' : 'expenses'} · ${p.activitiesCount} actions`}
                    totals={p.salesGenerated} max={salesComparable ? max : 0} />
                ))}
              </BarList>
            ) : <EmptyNote>No one reports to you yet.</EmptyNote>}
          </ReportSection>
        </>
      )}
      {!loading && activeTab === 'attendance' && (
        <ReportSection title={t('repAttendance')}>
          {attendance.length > 0 ? (
            <Card tone="outlined" padded={false}>
              {attendance.map((a, i) => (
                <View key={a.staffId} style={[styles.attRow, i > 0 && styles.attRowBorder]}>
                  <Text style={styles.attName}>{a.staffName}</Text>
                  <View style={styles.attCounts}>
                    <Text style={styles.attCount}>{a.daysPresent} present</Text>
                    <Text style={[styles.attCount, a.daysAbsent > 0 && styles.attAbsent]}>{a.daysAbsent} absent</Text>
                    <Text style={styles.attCount}>{a.daysHalfDay} half day</Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : <EmptyNote>No attendance logged in this period.</EmptyNote>}
        </ReportSection>
      )}
    </ReportScreen>
  );
};

const styles = StyleSheet.create({
  attRow: { paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs },
  attRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  attName: { ...typeScale.bodyMedium, color: color.textPrimary },
  attCounts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  attCount: { ...typeScale.label, color: color.textSecondary },
  // An absence needs a look — amber, not red: it is not money.
  attAbsent: { color: color.attention },
});
