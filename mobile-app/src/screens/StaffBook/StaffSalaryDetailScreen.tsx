import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StaffRecord } from '../../types/staff.types';
import { updateStaffSalary } from '../../services/database/staffDb';
import {
  getSalaryTransactionsByStaffId,
  getSalaryTotals,
  SalaryTotals,
  addStaffSalaryTransaction,
  StaffSalaryTransaction
} from '../../services/database/staffSalaryDb';
import { formatCurrency, rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { getDisplayName } from '../../utils/displayName';
import { useAuthStore } from '../../store/authStore';
import { color, space, radius, hairline, touchTarget, type as typeScale } from '../../theme/tokens';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';
import {
  getSalaryMonthState,
  closeSalaryMonth,
  canCloseSalaryMonthFor,
  SalaryMonthState,
} from '../../services/database/salaryClosingDb';

const getCurrentMonthKey = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
};

export const StaffSalaryDetailScreen = ({ route, navigation }: any) => {
  const [staff, setStaff] = useState<StaffRecord>(route.params?.staff);
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  const [transactions, setTransactions] = useState<StaffSalaryTransaction[]>([]);
  // Figures come from SQL aggregates over the whole set, never from the loaded rows.
  const [allTimeStats, setAllTimeStats] = useState<SalaryTotals>({ totalCashOut: 0, totalCashIn: 0, count: 0 });
  const [monthlyStats, setMonthlyStats] = useState<SalaryTotals>({ totalCashOut: 0, totalCashIn: 0, count: 0 });
  // The month's salary position: advance carried in, due after it, what is still owed
  // and anything paid beyond the due. All computed in SQL.
  const [monthState, setMonthState] = useState<SalaryMonthState | null>(null);
  const [canClose, setCanClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Month filter state (defaults to Current Month 'YYYY-MM')
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey);
  const monthScrollRef = useRef<ScrollView>(null);

  // Salary Payment Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [inputAmount, setInputAmount] = useState('');
  const [inputDate, setInputDate] = useState(() => todayDate());
  const [inputNote, setInputNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Set Monthly Salary Modal State
  const [salaryModalVisible, setSalaryModalVisible] = useState(false);
  const [inputMonthlySalary, setInputMonthlySalary] = useState(
    staff?.monthly_salary ? paisaToRupeesString(staff.monthly_salary) : ''
  );
  const [savingSalary, setSavingSalary] = useState(false);

  const loadSalaryData = async () => {
    if (!staff?.id) return;
    try {
      setLoading(true);
      const [data, allTime, forMonth, state] = await Promise.all([
        getSalaryTransactionsByStaffId(staff.id),
        getSalaryTotals(staff.id),
        getSalaryTotals(staff.id, selectedMonth),
        selectedMonth === 'ALL' ? Promise.resolve(null) : getSalaryMonthState(staff.id, selectedMonth),
      ]);
      setTransactions(data);
      setAllTimeStats(allTime);
      setMonthlyStats(forMonth);
      setMonthState(state);
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSalaryData();
  }, [staff?.id, selectedMonth]);

  useEffect(() => {
    if (staff?.id) canCloseSalaryMonthFor(staff.id).then(setCanClose);
  }, [staff?.id]);

  // Closing a month snapshots it and moves to the next one, which opens with any
  // advance already applied. Nothing is locked: a later payment just makes the closed
  // month drift, and it can be closed again.
  const handleCloseMonth = () => {
    if (!staff?.id || selectedMonth === 'ALL' || !monthState) return;
    const carry = monthState.extraPaidPaisa;
    Alert.alert(
      t('salaryCloseTitle', { month: formatMonthLabel(selectedMonth) }),
      carry > 0
        ? t('salaryCloseWithCarry', { amount: formatCurrency(carry) })
        : 'This month is saved as it stands and the next month starts.',
      [
        { text: t('commonCancel'), style: 'cancel' },
        {
          text: 'Close month',
          onPress: async () => {
            setClosing(true);
            try {
              const { nextMonth } = await closeSalaryMonth(staff.id, selectedMonth);
              setSelectedMonth(nextMonth);
            } catch (e: any) {
              if (__DEV__) console.error('[Salary] close failed:', e);
              Alert.alert(t('commonError'), e?.message || t('salaryCloseFailed'));
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  };

  // Available Months (Chronological Jan to Dec for current year + transaction months)
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    const currentYear = new Date().getFullYear();

    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      monthSet.add(`${currentYear}-${mm}`);
    }

    transactions.forEach(t => {
      if (t.month && t.month.match(/^\d{4}-\d{2}$/)) {
        monthSet.add(t.month);
      }
    });

    const sorted = Array.from(monthSet).sort();
    return ['ALL', ...sorted];
  }, [transactions]);

  // Auto scroll to active month
  useEffect(() => {
    const index = availableMonths.indexOf(selectedMonth);
    if (index >= 0 && monthScrollRef.current) {
      setTimeout(() => {
        monthScrollRef.current?.scrollTo({ x: Math.max(0, index * 60 - 40), animated: true });
      }, 100);
    }
  }, [selectedMonth, availableMonths]);

  // Filtered transactions by selected month — the LIST only; the figures above are SQL.
  const filteredTransactions = useMemo(() => {
    if (selectedMonth === 'ALL') return transactions;
    return transactions.filter(t => t.month === selectedMonth || (t.date && t.date.startsWith(selectedMonth)));
  }, [transactions, selectedMonth]);

  // Calculated Salary Tracking — the month's due is the salary LESS any advance
  // carried in, so an overpayment last month is worked off here.
  const monthlySalary = staff?.monthly_salary || 0;
  const paidSoFar = monthlyStats.totalCashOut;
  const dueThisMonth = monthState ? monthState.duePaisa : monthlySalary;
  const remainingDue = monthState ? monthState.remainingPaisa : Math.max(0, monthlySalary - paidSoFar);
  const extraPaid = monthState ? monthState.extraPaidPaisa : Math.max(0, paidSoFar - monthlySalary);

  // Status Badge Logic
  const statusBadge = useMemo(() => {
    if (monthlySalary <= 0) return null;
    if (paidSoFar === 0) return { label: 'Unpaid', color: color.moneyOut };
    if (remainingDue > 0) return { label: 'Partial', color: color.attention };
    return { label: 'Fully paid', color: color.moneyIn };
  }, [monthlySalary, paidSoFar, remainingDue]);

  const openModal = () => {
    if (dueThisMonth > 0 || monthlySalary > 0) {
      // remainingDue is PAISA; the box takes RUPEES. Without this converter a Rs 30
      // salary pre-filled as "3000" — and saving it stored Rs 3,000.
      setInputAmount(remainingDue > 0 ? paisaToRupeesString(remainingDue) : '');
    } else {
      setInputAmount('');
    }
    setInputNote('');
    const todayStr = todayDate();
    if (selectedMonth !== 'ALL' && !todayStr.startsWith(selectedMonth)) {
      setInputDate(`${selectedMonth}-01`);
    } else {
      setInputDate(todayStr);
    }
    setModalVisible(true);
  };

  const handleSaveTransaction = async () => {
    // staff_salary_transactions.amount is stored as integer paisa.
    const amount = rupeesToPaisa(inputAmount);
    if (amount === null) {
      Alert.alert(t('salaryAmountInvalidTitle'), t('salaryAmountInvalid'));
      return;
    }
    if (!user?.id || !staff?.id) return;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!inputDate || !dateRegex.test(inputDate)) {
      Alert.alert(t('salaryDateInvalidTitle'), t('salaryDateInvalid'));
      return;
    }

    setSaving(true);
    try {
      const monthKey = inputDate.substring(0, 7);
      const newTxn = await addStaffSalaryTransaction({
        staff_id: staff.id,
        user_id: user.id,
        type: 'cash_out',
        amount,
        date: inputDate,
        month: monthKey,
        note: inputNote.trim() || undefined,
      });

      setTransactions(prev => [newTxn, ...prev]);
      setModalVisible(false);
      loadSalaryData();
    } catch (err) {
      if (__DEV__) console.error(err);
      Alert.alert(t('commonError'), t('salarySaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMonthlySalary = async () => {
    // staff_records.monthly_salary is stored as integer paisa (0 = not set). The one
    // shared converter does it — a hand-written × 100 is how unit drift starts.
    const typed = inputMonthlySalary.trim();
    const val = typed === '' || parseFloat(typed) === 0 ? 0 : rupeesToPaisa(typed);
    if (val === null) {
      Alert.alert(t('salaryAmountInvalidTitle'), t('salaryMonthlyInvalid'));
      return;
    }
    if (!user?.id || !staff?.id) return;

    setSavingSalary(true);
    try {
      await updateStaffSalary(staff.id, user.id, val);
      setStaff(prev => ({ ...prev, monthly_salary: val }));
      setSalaryModalVisible(false);
      Alert.alert(t('commonSuccess'), t('salaryMonthlyUpdated'));
    } catch (err) {
      if (__DEV__) console.error(err);
      Alert.alert(t('commonError'), t('salaryMonthlyFailed'));
    } finally {
      setSavingSalary(false);
    }
  };

  const formatMonthLabel = (monthKey: string) => {
    if (monthKey === 'ALL') return 'All months';
    const [yyyy, mm] = monthKey.split('-');
    const date = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
    return date.toLocaleString('default', { month: 'short', year: '2-digit' });
  };

  const renderItem = ({ item: t }: { item: StaffSalaryTransaction }) => {
    const isOut = t.type === 'cash_out';
    return (
      <View style={styles.txnRow}>
        <View style={styles.txnLeft}>
          <Text style={styles.badge}>
            {isOut ? 'Salary paid' : 'Cash received'}
          </Text>
          <Text style={styles.txnDate}>{new Date(t.date).toLocaleDateString()}{t.note ? ` • ${t.note}` : ''}</Text>
        </View>
        <View style={styles.txnRight}>
          <Text style={styles.txnAmount}>
            {isOut ? '-' : '+'}{formatCurrency(t.amount)}
          </Text>
        </View>
      </View>
    );
  };

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>{t('salaryTitle')}</Text>
          <View style={{ width: touchTarget }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('salaryStaffNotFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>{getDisplayName(staff)}</Text>
            {statusBadge && (
              <View style={[styles.statusBadgePill, { borderColor: statusBadge.color }]}>
                <Text style={[styles.statusBadgeText, { color: statusBadge.color }]}>{statusBadge.label}</Text>
              </View>
            )}
          </View>
          <Text style={styles.headerSub} numberOfLines={1}>{staff.role}</Text>
        </View>

        <TouchableOpacity
          style={styles.setSalaryHeaderBtn}
          onPress={() => {
            setInputMonthlySalary(staff.monthly_salary ? paisaToRupeesString(staff.monthly_salary) : '');
            setSalaryModalVisible(true);
          }}
        >
          <Text style={styles.setSalaryHeaderBtnText}>{t('salarySet')}</Text>
        </TouchableOpacity>
      </View>

      <ScreenContainer scrollable={false} hasTabBar={false} style={styles.container}>
        {/* Card 1: Grand Total All-Time Salary Card */}
        <View style={styles.grandSummaryCard}>
          <Text style={styles.grandSummaryTitle}>{t('salaryTotalGiven')}</Text>
          <Text style={styles.grandSummaryAmount}>
            {formatCurrency(allTimeStats.totalCashOut)}
          </Text>
        </View>

        {/* Card 2: This Month Salary Tracking Summary Card — figures are neutral ink;
            the paid / partial / unpaid pill in the header carries the status. */}
        <View style={styles.thisMonthCard}>
          <Text style={styles.thisMonthTitle}>
            Monthly salary tracking ({formatMonthLabel(selectedMonth)})
          </Text>
          <View style={styles.thisMonthGrid}>
            <View style={styles.thisMonthBox}>
              <Text style={styles.thisMonthLabel}>{t('salaryMonthly')}</Text>
              <Text style={styles.thisMonthValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {monthlySalary > 0 ? formatCurrency(monthlySalary) : 'Not set'}
              </Text>
            </View>
            <View style={styles.thisMonthBox}>
              <Text style={styles.thisMonthLabel}>{t('salaryPaidSoFar')}</Text>
              <Text style={styles.thisMonthValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {formatCurrency(paidSoFar)}
              </Text>
            </View>
            <View style={styles.thisMonthBox}>
              <Text style={styles.thisMonthLabel}>{t('salaryRemainingDue')}</Text>
              <Text style={[styles.thisMonthValue, remainingDue > 0 && { color: color.attention }, remainingDue <= 0 && { color: color.textMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {monthlySalary > 0 ? formatCurrency(remainingDue) : 'N/A'}
              </Text>
            </View>
            {/* Only when there IS an overpayment — no Rs 0 placeholder. Neutral ink:
                an advance is a state, not money in or out of the shop. */}
            {extraPaid > 0 && (
              <View style={styles.thisMonthBox}>
                <Text style={styles.thisMonthLabel}>{t('salaryExtraPaid')}</Text>
                <Text style={styles.thisMonthValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {formatCurrency(extraPaid)}
                </Text>
              </View>
            )}
          </View>

          {/* A reduced due always says why. */}
          {!!monthState && monthState.openingAdvancePaisa > 0 && (
            <Text style={styles.advanceNote}>
              {t('salaryAdvanceApplied', {
                due: formatCurrency(dueThisMonth),
                advance: formatCurrency(monthState.openingAdvancePaisa),
                month: formatMonthLabel(monthState.advanceFromMonth || ''),
              })}
            </Text>
          )}
          {!!monthState?.latestClosing && (
            <Text style={styles.advanceNote}>
              {t('salaryClosedBy', { name: monthState.latestClosing.closed_by_name })}
              {monthState.drifted ? t('salaryChangedSinceClosing') : ''}
            </Text>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={openModal}
          >
            <Text style={styles.actionBtnText}>+ Pay salary</Text>
          </TouchableOpacity>
          {canClose && selectedMonth !== 'ALL' && (
            <TouchableOpacity
              style={[styles.closeMonthBtn, closing && { opacity: 0.5 }]}
              onPress={handleCloseMonth}
              disabled={closing}
              accessibilityRole="button"
            >
              <Text style={styles.closeMonthBtnText} numberOfLines={1}>{t('salaryCloseMonth')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Month Filter Section */}
        <View style={styles.monthSection}>
          <ScrollView
            ref={monthScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthScroll}
          >
            {availableMonths.map(mKey => {
              const active = selectedMonth === mKey;
              return (
                <TouchableOpacity
                  key={mKey}
                  style={[styles.monthPill, active && styles.monthPillActive]}
                  onPress={() => setSelectedMonth(mKey)}
                >
                  <Text style={[styles.monthPillText, active && styles.monthPillTextActive]}>
                    {formatMonthLabel(mKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Inline Monthly Summary */}
          <View style={styles.inlineSummary}>
            <Text style={styles.summaryText}>
              Paid in {formatMonthLabel(selectedMonth)}: <Text style={styles.summaryFigure}>{formatCurrency(monthlyStats.totalCashOut)}</Text>
            </Text>
          </View>
        </View>

        {/* Transactions List */}
        <View style={styles.listContainer}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Transactions ({monthlyStats.count})</Text>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={color.accent} />
            </View>
          ) : filteredTransactions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No transactions for {formatMonthLabel(selectedMonth)}.</Text>
            </View>
          ) : (
            <FlatList
              data={filteredTransactions}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
            />
          )}
        </View>
      </ScreenContainer>

      {/* Set Monthly Salary Modal */}
      <Modal visible={salaryModalVisible} transparent animationType="slide" onRequestClose={() => setSalaryModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('salarySetFixedTitle')}</Text>
              <TouchableOpacity style={styles.closeBtnWrap} onPress={() => setSalaryModalVisible(false)}>
                <Text style={styles.closeBtn}>×</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>{t('salaryMonthlyFixedLabel')} (Rs.) *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 50000"
                placeholderTextColor={color.textMuted}
                keyboardType="numeric"
                value={inputMonthlySalary}
                onChangeText={setInputMonthlySalary}
                autoFocus
              />

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveMonthlySalary}
                disabled={savingSalary}
              >
                {savingSalary ? (
                  <ActivityIndicator color={color.textInverse} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('salarySaveMonthly')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Salary Transaction Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('salaryPay')}</Text>
              <TouchableOpacity style={styles.closeBtnWrap} onPress={() => setModalVisible(false)}>
                <Text style={styles.closeBtn}>×</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>{t('commonAmount')} (Rs.) *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="0.00"
                placeholderTextColor={color.textMuted}
                keyboardType="numeric"
                value={inputAmount}
                onChangeText={setInputAmount}
                autoFocus
              />

              <Text style={styles.modalLabel}>{t('commonDate')} *</Text>
              <DateField
                style={styles.modalInput}
                value={inputDate}
                onChange={setInputDate}
              />

              <Text style={styles.modalLabel}>{t('salaryNoteLabel')}</Text>
              <TextInput
                style={[styles.modalInput, { minHeight: 48, textAlignVertical: 'top' }]}
                placeholder={t('salaryNotePlaceholder')}
                placeholderTextColor={color.textMuted}
                value={inputNote}
                onChangeText={setInputNote}
                multiline
              />

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveTransaction}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={color.textInverse} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('salarySavePayment')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center' },
  backArrow: { fontSize: 22, color: color.textPrimary },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  headerTitle: { ...typeScale.heading, color: color.textPrimary, flexShrink: 1 },
  headerSub: { ...typeScale.caption, color: color.textSecondary },

  // Outlined, coloured by meaning only: red unpaid, amber partial, green fully paid.
  statusBadgePill: {
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: hairline,
    backgroundColor: color.surface,
    flexShrink: 0,
  },
  statusBadgeText: {
    ...typeScale.caption,
    fontSize: 11,
    fontWeight: '500',
  },
  setSalaryHeaderBtn: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    flexShrink: 0,
  },
  setSalaryHeaderBtnText: {
    ...typeScale.label,
    fontWeight: '500',
    color: color.accent,
  },

  grandSummaryCard: {
    backgroundColor: color.surfaceRaised,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: color.border,
    alignItems: 'center',
  },
  grandSummaryTitle: {
    ...typeScale.caption,
    color: color.textSecondary,
    marginBottom: 2,
    textAlign: 'center',
  },
  grandSummaryAmount: {
    ...typeScale.title,
    color: color.textPrimary,
  },

  thisMonthCard: {
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: color.border,
  },
  thisMonthTitle: {
    ...typeScale.caption,
    color: color.textSecondary,
    marginBottom: space.sm,
    textAlign: 'center',
  },
  thisMonthGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  thisMonthBox: {
    flex: 1,
    alignItems: 'center',
  },
  thisMonthLabel: {
    ...typeScale.caption,
    color: color.textSecondary,
    marginBottom: 2,
    textAlign: 'center',
  },
  thisMonthValue: {
    ...typeScale.bodyMedium,
    fontSize: 14,
    color: color.textPrimary,
  },

  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  actionBtn: {
    flex: 1,
    minHeight: touchTarget,
    justifyContent: 'center',
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: color.accent,
  },
  actionBtnText: {
    ...typeScale.bodyMedium,
    fontSize: 14,
    color: color.textInverse,
  },
  closeMonthBtn: {
    flex: 1,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  closeMonthBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  // Never a reduced figure without its reason.
  advanceNote: { ...typeScale.caption, color: color.textSecondary, marginTop: space.sm, textAlign: 'center' },

  monthSection: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    backgroundColor: color.surface,
    borderBottomWidth: hairline,
    borderBottomColor: color.border,
  },
  monthScroll: {
    gap: 6,
    paddingRight: space.md,
    alignItems: 'center',
  },
  monthPill: {
    backgroundColor: color.surfaceRaised,
    paddingHorizontal: space.md,
    minHeight: 36,
    justifyContent: 'center',
    marginVertical: 4,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: color.border,
  },
  monthPillActive: {
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  monthPillText: {
    ...typeScale.caption,
    color: color.textSecondary,
  },
  monthPillTextActive: {
    color: color.textInverse,
    fontWeight: '500',
  },

  inlineSummary: {
    marginTop: space.xs,
    paddingVertical: space.sm,
    borderTopWidth: hairline,
    borderTopColor: color.border,
    alignItems: 'center',
  },
  summaryText: {
    ...typeScale.caption,
    color: color.textSecondary,
    textAlign: 'center',
  },
  summaryFigure: { fontWeight: '500', color: color.textPrimary },

  listContainer: { flex: 1 },
  listHeader: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  listTitle: { ...typeScale.label, fontWeight: '500', color: color.textPrimary },

  txnRow: {
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.sm,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    borderWidth: hairline,
    borderColor: color.border,
  },
  // flex: 1 so a long note wraps before it squeezes the amount.
  txnLeft: { flex: 1 },
  badge: {
    ...typeScale.caption,
    fontWeight: '500',
    color: color.textPrimary,
    marginBottom: 2,
  },
  txnDate: { ...typeScale.caption, color: color.textSecondary },
  txnRight: { alignItems: 'flex-end', flexShrink: 0 },
  txnAmount: { ...typeScale.bodyMedium, color: color.textPrimary },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { padding: space.xxxl, alignItems: 'center' },
  emptyText: { ...typeScale.label, color: color.textSecondary, textAlign: 'center' },

  modalOverlay: {
    flex: 1,
    backgroundColor: color.scrim,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: 28,
    borderWidth: hairline,
    borderColor: color.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  modalTitle: {
    ...typeScale.heading,
    color: color.textPrimary,
    flex: 1,
  },
  closeBtnWrap: { width: touchTarget, height: touchTarget, alignItems: 'flex-end', justifyContent: 'center' },
  closeBtn: {
    fontSize: 24,
    color: color.textSecondary,
  },
  modalBody: {},
  modalLabel: {
    ...typeScale.label,
    fontWeight: '500',
    color: color.textPrimary,
    marginBottom: space.xs,
  },
  modalInput: {
    backgroundColor: color.surfaceRaised,
    borderWidth: hairline,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: touchTarget,
    fontSize: 14,
    color: color.textPrimary,
    marginBottom: space.md,
  },
  saveBtn: {
    borderRadius: radius.md,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: space.xs,
    backgroundColor: color.accent,
  },
  saveBtnText: {
    ...typeScale.bodyMedium,
    fontSize: 14,
    color: color.textInverse,
  },
});
