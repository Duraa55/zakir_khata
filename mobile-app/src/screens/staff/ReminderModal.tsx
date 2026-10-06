import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Linking, Platform, StyleSheet } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { addReminder } from '../../services/database/reminderDb';
import { formatCurrency } from '../../utils/calculations';
import { internationalPhone } from '../../utils/phone';
import { Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, type as typeScale } from '../../theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  partyName: string;
  netBalance: number;
  phone?: string | null;
}

export const ReminderModal: React.FC<Props> = ({ visible, onClose, partyName, netBalance, phone }) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const [submitting, setSubmitting] = useState(false);
  const intl = internationalPhone(phone);

  const handleSetReminder = async (days: number) => {
    if (!user?.id) return;
    setSubmitting(true);
    try {
      const date = new Date();
      date.setDate(date.getDate() + days);
      const isoDate = date.toISOString();

      await addReminder({
        user_id: user.id,
        title: `Payment due: ${partyName}`,
        description: `Collect ${formatCurrency(Math.abs(netBalance))} from ${partyName}.`,
        type: 'payment',
        due_date: isoDate
      });
      Alert.alert(t('remSetTitleDone'), t('remSetBody', { date: date.toLocaleDateString('en-PK') }));
    } catch (e) {
      Alert.alert(t('commonError'), t('remFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const getMessageText = () => {
    const amount = formatCurrency(Math.abs(netBalance));
    return `Hello ${partyName},\n\nThis is a friendly reminder regarding your pending payment of ${amount}. Please make the payment at your earliest convenience.\n\nThank you,\n${user?.businessName || 'Our Shop'}`;
  };

  const handleWhatsApp = async () => {
    if (!intl) {
      Alert.alert(t('remNoPhoneTitle'), t('remNoPhoneBody'));
      return;
    }
    const text = encodeURIComponent(getMessageText());
    const url = `whatsapp://send?phone=${intl}&text=${text}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
      else Alert.alert(t('remNoWhatsAppTitle'), t('remNoWhatsAppBody'));
    } catch (err) {
      if (__DEV__) console.error('Error opening WhatsApp', err);
    }
  };

  const handleSMS = async () => {
    if (!intl) {
      Alert.alert(t('remNoPhoneTitle'), t('remNoPhoneBody'));
      return;
    }
    const text = encodeURIComponent(getMessageText());
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:+${intl}${separator}body=${text}`;
    try {
      await Linking.openURL(url);
    } catch (err) {
      if (__DEV__) console.error('Error opening SMS', err);
    }
  };

  const DayBtn = ({ days, label, wide }: { days: number; label: string; wide?: boolean }) => (
    <TouchableOpacity style={[styles.dayBtn, wide && styles.dayBtnWide]} onPress={() => handleSetReminder(days)} disabled={submitting} accessibilityRole="button">
      <Text style={styles.dayBtnText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('remSetTitle')}</Text>
          <Text style={styles.sub}>When do you want to be reminded to collect {formatCurrency(Math.abs(netBalance))}?</Text>

          <View style={styles.dayRow}>
            <DayBtn days={1} label={t('remTomorrow')} />
            <DayBtn days={3} label={t('remIn3Days')} />
            <DayBtn days={7} label={t('remNextWeek')} wide />
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>{t('remSendMessage')}</Text>
          <View style={styles.quickRow}>
            <Button label={t('supWhatsApp')} icon="message-circle" variant="secondary" onPress={handleWhatsApp} style={styles.quickBtn} />
            <Button label={t('remSms')} icon="message-square" variant="secondary" onPress={handleSMS} style={styles.quickBtn} />
          </View>

          <Button label={t('commonClose')} variant="quiet" onPress={onClose} fullWidth />

          {submitting && (
            <View style={styles.busy}>
              <ActivityIndicator size="large" color={color.accent} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color.scrim, padding: space.lg },
  card: {
    width: '100%', maxWidth: 400, backgroundColor: color.surface, borderRadius: radius.lg,
    padding: space.xl, borderWidth: hairline, borderColor: color.border,
  },
  title: { ...typeScale.title, color: color.textPrimary, marginBottom: space.xs },
  sub: { ...typeScale.body, color: color.textSecondary, marginBottom: space.lg },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  dayBtn: {
    flex: 1, minHeight: touchTarget, borderRadius: radius.md, borderWidth: hairline, borderColor: color.borderStrong,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm,
  },
  dayBtnWide: { flexBasis: '100%' },
  dayBtnText: { ...typeScale.bodyMedium, color: color.accent },
  divider: { height: hairline, backgroundColor: color.border, marginBottom: space.lg },
  sectionLabel: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  quickRow: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  quickBtn: { flex: 1 },
  busy: {
    ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim, borderRadius: radius.lg,
    justifyContent: 'center', alignItems: 'center',
  },
});
