import React, { useEffect, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, Alert, Modal, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getTransactionsByParty, getPartySummary, createTransaction } from '../../services/database/transactionDb';
import { getCustomerByName, customerPhotoUri, Customer } from '../../services/database/customerDb';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';
import { Transaction } from '../../types';
import { formatCurrency, formatDate, rupeesToPaisa } from '../../utils/calculations';
import { generateTransactionPDF } from '../../utils/pdfGenerator';
import { useAuthStore } from '../../store/authStore';
import { accountCurrencyLabel } from '../../utils/currency';
import { ReminderModal } from './ReminderModal';
import { Icon, AmountText, Button, IconName } from '../../components/ui/primitives';
import { PdfReportButton } from '../../components/ui/PdfReportButton';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

interface RouteParams { partyName: string; userId: string; viewAs?: { userId: string; name: string } }

/**
 * One customer's ledger. Lena = credit given (the customer owes more: red), dena = a
 * payment taken (money in: green). The totals are SQL aggregates (getPartySummary) over
 * the same rows the list shows; only the running balance per row is walked in order.
 */
export const CustomerDetailScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<any>();
  // `viewAs`: opened from Staff Book → Entries — that person's customer, read-only.
  const { partyName, userId, viewAs } = route.params as RouteParams;
  const { t } = useLanguageStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState({ totalLena: 0, totalDena: 0, netBalance: 0 });
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { user } = useAuthStore();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);

  const [amountInput, setAmountInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [data, totals, cust] = await Promise.all([
        getTransactionsByParty(userId, partyName, viewAs?.userId),
        getPartySummary(userId, partyName, viewAs?.userId),
        getCustomerByName(userId, partyName, viewAs?.userId),
      ]);
      setTransactions(data);
      setSummary(totals);
      setCustomer(cust);
    } finally {
      setLoading(false);
    }
  };

  const { totalLena, totalDena, netBalance } = summary;

  let runningBalance = 0;
  const withRunning = [...transactions].reverse().map(t => {
    runningBalance += t.type === 'lena' ? t.amount_paisa : -t.amount_paisa;
    return { ...t, runningBalance };
  }).reverse();

  const handleDownload = async () => {
    if (transactions.length === 0) {
      Alert.alert(t('commonNothingToExport'), t('commonNoTransactions'));
      return;
    }
    setGenerating(true);
    try {
      await generateTransactionPDF(
        withRunning,
        user?.businessName || 'My Business',
        user?.name || 'Staff',
        `Ledger: ${partyName}`,
        summary
      );
    } catch (err) {
      Alert.alert(t('commonError'), t('commonPdfFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const closeModal = () => { setShowPaymentModal(false); setShowCreditModal(false); setAmountInput(''); setNotesInput(''); };

  const handleSaveTransaction = async (type: 'lena' | 'dena') => {
    const paisa = rupeesToPaisa(amountInput);
    if (!paisa) {
      Alert.alert(t('commonAmountInvalid'), t('commonAmountRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await createTransaction(userId, partyName, paisa, type, notesInput);
      closeModal();
      await load();
    } catch (e) {
      Alert.alert(t('commonError'), t('khataSaveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Status by meaning: still owed is red, part-paid amber, an advance received green.
  const getStatusBadge = (): { label: string; tone: string; icon: IconName } => {
    if (netBalance > 0) {
      if (totalDena > 0) return { label: t('khataStatusPartial'), tone: color.attention, icon: 'clock' };
      return { label: t('khataStatusDue'), tone: color.moneyOut, icon: 'alert-circle' };
    }
    if (netBalance < 0) return { label: t('khataStatusAdvance'), tone: color.moneyIn, icon: 'arrow-down-left' };
    if (totalLena > 0) return { label: t('khataStatusPaid'), tone: color.textPrimary, icon: 'check-circle' };
    return { label: t('khataStatusNoBalance'), tone: color.textMuted, icon: 'minus-circle' };
  };

  const renderItem = ({ item }: { item: typeof withRunning[0] }) => {
    const isCredit = item.type === 'lena';
    return (
      <View style={styles.entry}>
        <Icon name={isCredit ? 'arrow-up-right' : 'arrow-down-left'} size={iconSize.md} tint={isCredit ? color.moneyOut : color.moneyIn} />
        <View style={styles.entryInfo}>
          <Text style={styles.entryTitle}>{isCredit ? 'Credit given' : 'Payment received'}</Text>
          <Text style={styles.entryDate}>{formatDate(item.date)}</Text>
          {!!item.notes && <Text style={styles.entryNotes}>{item.notes}</Text>}
        </View>
        <View style={styles.entryRight}>
          <AmountText paisa={item.amount_paisa} tone={isCredit ? 'out' : 'in'} />
          <Text style={styles.entryBalance}>
            Balance {formatCurrency(Math.abs(item.runningBalance))}{item.runningBalance > 0 ? ' due' : item.runningBalance < 0 ? ' advance' : ''}
          </Text>
        </View>
      </View>
    );
  };

  const status = getStatusBadge();
  const modalIsPayment = showPaymentModal;
  const typedPaisa = rupeesToPaisa(amountInput) || 0;

  const ContactLine = ({ icon, text }: { icon: IconName; text: string }) => (
    <View style={styles.contactLine}>
      <Icon name={icon} size={iconSize.sm} tint={color.textSecondary} />
      <Text style={styles.contactText}>{text}</Text>
    </View>
  );
  const hasContact = !!(customer?.phone || customer?.email || customer?.cnic || customer?.address || customer?.city || customer?.notes);

  const header = (
    <View>
      <View style={styles.profile}>
        <CustomerAvatar name={partyName} uri={customerPhotoUri(customer)} style={styles.avatar} textStyle={styles.avatarText} />
        <Text style={styles.partyName} numberOfLines={2}>{partyName}</Text>
      </View>

      {customer && hasContact && (
        <View style={styles.contactCard}>
          {customer.phone && <ContactLine icon="phone" text={customer.phone} />}
          {customer.email && <ContactLine icon="mail" text={customer.email} />}
          {/* A sub-staff gets the CNIC redacted to null, so the row simply does not render. */}
          {customer.cnic && <ContactLine icon="credit-card" text={customer.cnic} />}
          {(customer.address || customer.city) && <ContactLine icon="map-pin" text={[customer.address, customer.city].filter(Boolean).join(', ')} />}
          {customer.notes && <ContactLine icon="file-text" text={customer.notes} />}
        </View>
      )}

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t('commonStatus')}</Text>
          <View style={[styles.badge, { borderColor: status.tone }]}>
            <Icon name={status.icon} size={12} tint={status.tone} />
            <Text style={[styles.badgeText, { color: status.tone }]}>{status.label}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t('khataTotalCreditGiven')}</Text>
          <AmountText paisa={totalLena} tone="out" size="label" />
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t('khataTotalPaymentReceived')}</Text>
          <AmountText paisa={totalDena} tone="in" size="label" />
        </View>
        <View style={styles.balanceBox}>
          <Text style={styles.balanceLabel}>{t(netBalance < 0 ? 'khataAdvanceHeld' : 'khataRemainingBalance')}</Text>
          <AmountText paisa={Math.abs(netBalance)} tone={netBalance > 0 ? 'out' : netBalance < 0 ? 'in' : 'neutral'} size="title" />
        </View>
      </View>

      {!viewAs && (
        <>
          <View style={styles.actions}>
            <Button label={t('khataGiveCredit')} icon="arrow-up-right" variant="secondary" onPress={() => setShowCreditModal(true)} style={styles.actionBtn} />
            <Button label={t('khataRecordPayment')} icon="arrow-down-left" variant="secondary" onPress={() => setShowPaymentModal(true)} style={styles.actionBtn} />
          </View>
          <Button label={t('khataReminder')} icon="bell" variant="quiet" onPress={() => setShowReminderModal(true)} fullWidth style={styles.reminderBtn} />
        </>
      )}
      <Text style={styles.sectionTitle}>{t('khataEntries')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {viewAs ? <ReadOnlyBanner name={viewAs.name} book={partyName} onBack={() => navigation.goBack()} /> : (
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{t('khataCustomerLedger')}</Text>
        {generating ? <ActivityIndicator color={color.accent} style={styles.backBtn} /> : <PdfReportButton onPress={handleDownload} />}
      </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : (
        <FlatList
          data={withRunning}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>{t('khataNoEntries')}</Text>}
        />
      )}

      {/* Give credit / Record payment */}
      <Modal visible={showPaymentModal || showCreditModal} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t(modalIsPayment ? 'khataRecordPayment' : 'khataGiveCredit')}</Text>
            <Text style={styles.sheetSub}>
              {t(modalIsPayment ? 'khataHowMuchPaid' : 'khataHowMuchCredit')}
            </Text>

            <TextInput
              style={styles.amountInput}
              // Khata has no picker either: the ACCOUNT default denominates the entry.
              placeholder={t('khataAmountPlaceholder', { currency: accountCurrencyLabel(user?.defaultCurrency) })}
              placeholderTextColor={color.textMuted}
              keyboardType="decimal-pad"
              value={amountInput}
              onChangeText={setAmountInput}
            />

            <TextInput
              style={styles.notesInput}
              placeholder={t('khataNotesPlaceholder')}
              placeholderTextColor={color.textMuted}
              value={notesInput}
              onChangeText={setNotesInput}
            />

            {/* New balance preview — the same arithmetic the save will do. */}
            {typedPaisa > 0 && (
              <View style={styles.preview}>
                <Text style={styles.previewLabel}>{t('khataNewBalance')}</Text>
                <AmountText
                  paisa={Math.abs(netBalance + (modalIsPayment ? -typedPaisa : typedPaisa))}
                  size="label"
                />
              </View>
            )}

            <View style={styles.sheetButtons}>
              <Button label={t('commonCancel')} variant="secondary" onPress={closeModal} style={styles.sheetBtn} />
              <Button
                label={t('commonSave')}
                onPress={() => handleSaveTransaction(modalIsPayment ? 'dena' : 'lena')}
                loading={submitting}
                disabled={submitting}
                style={styles.sheetBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

      {showReminderModal && (
        <ReminderModal
          visible={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          partyName={partyName}
          netBalance={netBalance}
          phone={customer?.phone}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  listContent: { padding: space.lg, paddingBottom: 100 },

  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  avatar: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...typeScale.title, color: color.textPrimary },
  partyName: { ...typeScale.title, color: color.textPrimary, flex: 1 },

  contactCard: {
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md, gap: space.sm,
    borderWidth: hairline, borderColor: color.border, marginBottom: space.md,
  },
  contactLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  contactText: { ...typeScale.label, color: color.textPrimary, flex: 1 },

  summaryCard: {
    backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg,
    borderWidth: hairline, borderColor: color.border,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  summaryLabel: { ...typeScale.body, color: color.textSecondary, flex: 1 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0,
    paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: hairline,
  },
  badgeText: { ...typeScale.caption },
  divider: { height: hairline, backgroundColor: color.border, marginVertical: space.sm },
  balanceBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md, marginTop: space.md,
  },
  balanceLabel: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },

  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  actionBtn: { flex: 1 },
  reminderBtn: { marginTop: space.sm },
  sectionTitle: { ...typeScale.heading, color: color.textPrimary, marginTop: space.lg, marginBottom: space.sm },

  entry: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.lg, marginBottom: space.sm,
    backgroundColor: color.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: color.border,
  },
  entryInfo: { flex: 1 },
  entryTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  entryDate: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  entryNotes: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },
  entryRight: { alignItems: 'flex-end', flexShrink: 0 },
  entryBalance: { ...typeScale.caption, color: color.textMuted, marginTop: space.xs },
  emptyText: { ...typeScale.body, color: color.textMuted, textAlign: 'center', marginTop: space.xxl },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface, padding: space.xl, paddingBottom: space.xxxl,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
  },
  sheetTitle: { ...typeScale.title, color: color.textPrimary, marginBottom: space.xs },
  sheetSub: { ...typeScale.body, color: color.textSecondary, marginBottom: space.lg },
  amountInput: {
    ...typeScale.title, fontSize: 24, textAlign: 'center', color: color.textPrimary,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, minHeight: 56, marginBottom: space.md,
  },
  notesInput: {
    ...typeScale.body, color: color.textPrimary, backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: touchTarget, marginBottom: space.lg,
  },
  preview: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md, marginBottom: space.lg,
  },
  previewLabel: { ...typeScale.label, color: color.textSecondary },
  sheetButtons: { flexDirection: 'row', gap: space.md },
  sheetBtn: { flex: 1, minHeight: 50 },
});
