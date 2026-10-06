import React, { useEffect, useCallback } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useSupplierStore } from '../../store/useSupplierStore';
import { internationalPhone } from '../../utils/phone';
import { formatDisplayDate } from '../../utils/dates';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon, IconName, AmountText } from '../../components/ui/primitives';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', online: 'Online',
};

const InfoRow = ({ icon, label, value }: { icon: IconName; label: string; value?: string | null }) =>
  value ? (
    <View style={styles.infoRow}>
      <Icon name={icon} size={iconSize.sm} tint={color.textMuted} />
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  ) : null;

const QuickAction = ({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) => (
  <TouchableOpacity style={styles.quickBtn} onPress={onPress} accessibilityRole="button">
    <Icon name={icon} size={iconSize.md} tint={color.accent} />
    <Text style={styles.quickLabel}>{label}</Text>
  </TouchableOpacity>
);

export const SupplierProfileScreen = ({ navigation, route }: any) => {
  const { supplierId } = route.params;
  const { selectedSupplier: supplier, payments, loading, loadSupplierById, deleteSupplier } = useSupplierStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  const load = useCallback(() => loadSupplierById(supplierId), [supplierId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const handleCall = () => supplier?.phone && Linking.openURL(`tel:${supplier.phone}`);
  // Country-aware: a Dubai supplier's number is not rewritten as a Pakistani one.
  const handleWhatsApp = () => {
    const intl = internationalPhone(supplier?.phone);
    if (intl) Linking.openURL(`whatsapp://send?phone=${intl}`);
  };
  const openPayment = () => supplier && navigation.navigate('AddSupplierPayment', { supplierId, supplierName: supplier.name });
  const openLedger = () => supplier && navigation.navigate('SupplierLedger', { supplierId, supplierName: supplier.name });

  const handleDelete = () => {
    if (!user) return;
    Alert.alert(t('supDelete'), t('supDeleteBody'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('commonDelete'), style: 'destructive',
        onPress: async () => {
          await deleteSupplier(supplierId, user.id);
          navigation.goBack();
        }
      }
    ]);
  };

  if (loading || !supplier) {
    return <View style={styles.center}><ActivityIndicator size="large" color={color.accent} /></View>;
  }

  const outstanding = supplier.outstanding_balance ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('supProfileTitle')}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('AddSupplierModal', { supplierId, edit: true })} style={styles.headerAction} accessibilityRole="button">
          <Icon name="edit-2" size={iconSize.sm} tint={color.accent} />
          <Text style={styles.headerActionText}>{t('commonEdit')}</Text>
        </TouchableOpacity>
      </View>

      <ScreenContainer scrollable={true} hasTabBar={false} contentContainerStyle={styles.content}>
        <View style={styles.identityCard}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarText}>{supplier.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.supplierName}>{supplier.name}</Text>
          {!!supplier.business_name && <Text style={styles.businessName}>{supplier.business_name}</Text>}
          {!!supplier.city && (
            <View style={styles.cityLine}>
              <Icon name="map-pin" size={iconSize.sm} tint={color.textMuted} />
              <Text style={styles.cityText}>{supplier.city}</Text>
            </View>
          )}

          {/* Pay and Ledger work without a phone number; Call and WhatsApp need one. */}
          <View style={styles.quickActions}>
            {!!supplier.phone && <QuickAction icon="phone" label={t('supCall')} onPress={handleCall} />}
            {!!supplier.phone && <QuickAction icon="message-circle" label={t('supWhatsApp')} onPress={handleWhatsApp} />}
            <QuickAction icon="credit-card" label={t('supPay')} onPress={openPayment} />
            <QuickAction icon="book-open" label={t('supLedger')} onPress={openLedger} />
          </View>
        </View>

        {outstanding > 0 && (
          <View style={styles.outstandingCard}>
            <Text style={styles.outstandingLabel}>{t('supOutstanding')}</Text>
            <AmountText paisa={outstanding} tone="out" size="title" fit />
            <TouchableOpacity style={styles.payNowBtn} onPress={openPayment} accessibilityRole="button">
              <Text style={styles.payNowText}>{t('supPayNow')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('supContactInfo')}</Text>
          <InfoRow icon="phone" label={t('commonPhone')} value={supplier.phone} />
          <InfoRow icon="mail" label={t('customerEmailShort')} value={supplier.email} />
          <InfoRow icon="map-pin" label={t('customerAddressShort')} value={supplier.address} />
          <InfoRow icon="home" label={t('customerCityShort')} value={supplier.city} />
          {!supplier.phone && !supplier.email && !supplier.address && !supplier.city && (
            <Text style={styles.muted}>{t('supNoContact')}</Text>
          )}
        </View>

        {!!supplier.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('commonNote')}</Text>
            <Text style={styles.notesText}>{supplier.notes}</Text>
          </View>
        )}

        {payments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('supRecentPayments')}</Text>
            {payments.slice(0, 5).map((p, i) => (
              <View key={p.id} style={[styles.paymentRow, i > 0 && styles.paymentRowBorder]}>
                <View style={styles.paymentInfo}>
                  <Text style={styles.paymentDate}>{formatDisplayDate(p.payment_date)}</Text>
                  <Text style={styles.paymentMethod}>{METHOD_LABEL[p.payment_method] ?? p.payment_method}</Text>
                  {!!p.reference && <Text style={styles.paymentRef}>Ref: {p.reference}</Text>}
                </View>
                <AmountText paisa={p.amount} tone="in" />
              </View>
            ))}
          </View>
        )}

        <View style={styles.navBtns}>
          <TouchableOpacity style={styles.navBtn} onPress={openLedger} accessibilityRole="button">
            <Icon name="book-open" size={iconSize.md} tint={color.accent} />
            <Text style={styles.navBtnText}>{t('supViewLedger')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => navigation.navigate('CreatePurchaseInvoice', { supplierId, supplierName: supplier.name })}
            accessibilityRole="button"
          >
            <Icon name="file-plus" size={iconSize.md} tint={color.accent} />
            <Text style={styles.navBtnText}>{t('supNewInvoice')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} accessibilityRole="button">
          <Icon name="trash-2" size={iconSize.sm} tint={color.moneyOut} />
          <Text style={styles.deleteBtnText}>{t('supDelete')}</Text>
        </TouchableOpacity>
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touchTarget, paddingHorizontal: space.md },
  headerActionText: { ...typeScale.bodyMedium, color: color.accent },
  content: { paddingBottom: space.xxl },
  identityCard: {
    margin: space.lg, borderRadius: radius.lg, padding: space.xl,
    alignItems: 'center', borderWidth: hairline, borderColor: color.border, backgroundColor: color.surface,
  },
  avatarLarge: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    justifyContent: 'center', alignItems: 'center', marginBottom: space.md,
  },
  avatarText: { ...typeScale.title, fontSize: 28, color: color.textPrimary },
  supplierName: { ...typeScale.title, fontSize: 22, color: color.textPrimary, textAlign: 'center' },
  businessName: { ...typeScale.body, color: color.textSecondary, marginTop: space.xs, textAlign: 'center' },
  cityLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  cityText: { ...typeScale.label, color: color.textMuted },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  quickBtn: {
    alignItems: 'center', justifyContent: 'center', gap: space.xs, minWidth: 68, minHeight: 60,
    paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: color.surfaceRaised,
  },
  quickLabel: { ...typeScale.caption, color: color.textPrimary },
  outstandingCard: {
    marginHorizontal: space.lg, marginBottom: space.md, borderRadius: radius.md, padding: space.lg,
    borderWidth: hairline, borderColor: color.border, alignItems: 'center', gap: space.xs,
  },
  outstandingLabel: { ...typeScale.label, color: color.textSecondary },
  payNowBtn: {
    backgroundColor: color.accent, paddingHorizontal: space.xl, minHeight: touchTarget,
    justifyContent: 'center', borderRadius: radius.md, marginTop: space.sm,
  },
  payNowText: { ...typeScale.bodyMedium, color: color.textInverse },
  section: {
    marginHorizontal: space.lg, marginBottom: space.md, borderRadius: radius.md, padding: space.lg,
    borderWidth: hairline, borderColor: color.border,
  },
  sectionTitle: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.md },
  infoText: { flex: 1 },
  infoLabel: { ...typeScale.caption, color: color.textMuted },
  infoValue: { ...typeScale.body, color: color.textPrimary },
  muted: { ...typeScale.body, color: color.textMuted },
  notesText: { ...typeScale.body, color: color.textSecondary },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  paymentRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  paymentInfo: { flex: 1 },
  paymentDate: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  paymentMethod: { ...typeScale.caption, color: color.textSecondary },
  paymentRef: { ...typeScale.caption, color: color.textMuted },
  navBtns: { flexDirection: 'row', marginHorizontal: space.lg, marginBottom: space.md, gap: space.md },
  navBtn: {
    flex: 1, borderRadius: radius.md, padding: space.lg, gap: space.xs,
    alignItems: 'center', borderWidth: hairline, borderColor: color.border,
  },
  navBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  deleteBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.xs,
    marginHorizontal: space.lg, marginTop: space.sm, minHeight: touchTarget,
  },
  deleteBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.moneyOut },
});
