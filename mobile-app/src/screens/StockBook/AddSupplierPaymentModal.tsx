import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { useAuthStore } from '../../store/authStore';
import { useSupplierStore } from '../../store/useSupplierStore';
import { useActivityStore } from '../../store/useActivityStore';
import { SupplierPayment } from '../../types/supplier.types';
import { rupeesToPaisa, formatCurrency, paisaToRupeesString } from '../../utils/calculations';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon, IconName, Button } from '../../components/ui/primitives';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';

type PaymentMethod = SupplierPayment['payment_method'];

const METHODS: { key: PaymentMethod; label: string; icon: IconName }[] = [
  { key: 'cash', label: 'Cash', icon: 'dollar-sign' },
  { key: 'bank_transfer', label: 'Bank transfer', icon: 'credit-card' },
  { key: 'cheque', label: 'Cheque', icon: 'file-text' },
  { key: 'online', label: 'Online', icon: 'smartphone' },
];

export const AddSupplierPaymentModal = ({ navigation, route }: any) => {
  // maxAmount is the invoice's balance due, in PAISA.
  const { supplierId, supplierName, invoiceId, invoiceNumber, maxAmount } = route.params;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { recordPayment } = useSupplierStore();
  const { logActivity } = useActivityStore();

  // Shown in rupees; String(paisa) here used to prefill a 100x amount.
  const [amount, setAmount] = useState(maxAmount ? paisaToRupeesString(maxAmount) : '');
  const [paymentDate, setPaymentDate] = useState(todayDate());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const paisa = rupeesToPaisa(amount);
    if (!amount.trim()) e.amount = 'Amount is required';
    else if (paisa === null || paisa <= 0) e.amount = 'Enter a valid positive amount';
    else if (invoiceId && maxAmount != null && paisa > maxAmount) e.amount = `No more than the balance due, ${formatCurrency(maxAmount)}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) e.date = 'Choose a payment date';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user) return;
    const paisa = rupeesToPaisa(amount)!;
    setLoading(true);
    try {
      const payment = await recordPayment(
        user.id, supplierId, paisa, paymentDate, method,
        invoiceId ?? undefined, reference.trim() || undefined, notes.trim() || undefined,
      );

      await logActivity({
        user_id: user.id,
        user_name: user.name || 'User',
        action: 'create',
        entity_type: 'supplier',
        entity_id: payment.id,
        description: `Payment to ${supplierName}`,
        amount: paisa,
      });

      navigation.goBack();
    } catch (err: any) {
      if (__DEV__) console.error(err);
      Alert.alert(t('spNotSavedTitle'), err?.message || t('spNotSaved'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('piRecordPayment')}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            to {supplierName}{invoiceNumber ? ` · invoice ${invoiceNumber}` : ''}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={false} contentContainerStyle={styles.form}>
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('commonAmount')}</Text>
          <View style={[styles.amountRow, errors.amount ? styles.inputErr : null]}>
            <Text style={styles.rsSign}>Rs.</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={color.textMuted}
              value={amount}
              onChangeText={t => { setAmount(t); setErrors(p => ({ ...p, amount: '' })); }}
              keyboardType="decimal-pad"
              autoFocus
            />
          </View>
          {!!errors.amount && <Text style={styles.errText}>{errors.amount}</Text>}
        </View>

        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('spPaymentDate')}</Text>
          <DateField
            style={[styles.input, errors.date ? styles.inputErr : null]}
            value={paymentDate}
            onChange={d => { setPaymentDate(d); setErrors(p => ({ ...p, date: '' })); }}
          />
          {!!errors.date && <Text style={styles.errText}>{errors.date}</Text>}
        </View>

        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('spPaymentMethod')}</Text>
          <View style={styles.methodGrid}>
            {METHODS.map(m => {
              const on = method === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.methodBtn, on && styles.methodBtnActive]}
                  onPress={() => setMethod(m.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Icon name={m.icon} size={iconSize.sm} tint={on ? color.accent : color.textSecondary} />
                  <Text style={[styles.methodLabel, on && styles.methodLabelActive]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {(method === 'cheque' || method === 'bank_transfer' || method === 'online') && (
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>{t('spReference')}</Text>
            <TextInput
              style={styles.input}
              value={reference}
              onChangeText={setReference}
              placeholder={method === 'cheque' ? 'Cheque number' : 'Transaction ID'}
              placeholderTextColor={color.textMuted}
            />
          </View>
        )}

        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('poNotesLabel')}</Text>
          <TextInput
            style={[styles.input, styles.notes]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('spNotesPlaceholder')}
            placeholderTextColor={color.textMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        <Button label={t('piRecordPayment')} icon="check" onPress={handleSave} loading={loading} fullWidth style={styles.saveBtn} />
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  headerSub: { ...typeScale.caption, color: color.textSecondary },
  form: { padding: space.xl, paddingBottom: space.xxl },
  fieldWrap: { marginBottom: space.lg },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, ...typeScale.body, color: color.textPrimary,
  },
  notes: { minHeight: 80, paddingTop: space.md, textAlignVertical: 'top' },
  inputErr: { borderColor: color.moneyOut },
  errText: { ...typeScale.caption, color: color.moneyOut, marginTop: space.xs },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md,
  },
  rsSign: { ...typeScale.bodyMedium, fontSize: 18, color: color.textSecondary },
  amountInput: { flex: 1, ...typeScale.title, fontSize: 28, color: color.textPrimary, paddingVertical: space.md },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  methodBtn: {
    flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: space.sm,
    minHeight: touchTarget, paddingHorizontal: space.md, backgroundColor: color.surfaceRaised, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.border,
  },
  methodBtnActive: { borderColor: color.accent, backgroundColor: color.surface },
  methodLabel: { ...typeScale.label, color: color.textSecondary },
  methodLabelActive: { color: color.textPrimary },
  saveBtn: { marginTop: space.sm },
});
