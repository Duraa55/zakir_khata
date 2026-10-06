import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { getTransactionById, updateTransaction } from '../../services/database/transactionDb';
import { useTransactionStore } from '../../store/transactionStore';
import { rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { EntryHistoryMarker } from '../../components/ui/EntryHistory';
import { DateField } from '../../components/ui/DateField';
import { toDateValue } from '../../utils/dates';
import { Button } from '../../components/ui/primitives';
import { color } from '../../theme/tokens';
import { KhataTypeToggle, FormHeader, formStyles as styles } from './KhataEntryForm';

interface RouteParams { transactionId: string }

export const EditTransactionScreen: React.FC = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { loadTransactions } = useTransactionStore();
  const { transactionId } = route.params as RouteParams;

  const [partyName, setPartyName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'lena' | 'dena'>('lena');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => { loadData(); }, [transactionId]);

  const loadData = async () => {
    try {
      // `tx`, not `t`: `t` is the translator, and the catch below calls it.
      const tx = await getTransactionById(transactionId);
      if (tx) {
        setPartyName(tx.partyName);
        setAmount(paisaToRupeesString(tx.amount_paisa));
        setType(tx.type);
        setNotes(tx.notes ?? '');
        // The LOCAL calendar day — a legacy timestamp row must not open on the UTC day.
        setDate(toDateValue(tx.date) || tx.date);
      }
    } catch {
      Alert.alert(t('commonError'), t('khataLoadFailed'));
    } finally {
      setInitialLoading(false);
    }
  };

  const validate = (): number | null => {
    if (!partyName.trim()) { Alert.alert(t('commonError'), t('khataPartyRequired')); return null; }
    const paisa = rupeesToPaisa(amount);
    if (paisa === null) { Alert.alert(t('commonError'), t('commonAmountInvalid')); return null; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert(t('commonError'), t('khataDateInvalid')); return null; }
    return paisa;
  };

  const handleUpdate = async () => {
    const paisa = validate();
    if (paisa === null || !user) return;

    setLoading(true);
    try {
      // updateTransaction(id, userId, updates) — same shape as updateCashEntry.
      // amount_paisa is integer paisa (from rupeesToPaisa); date stays YYYY-MM-DD.
      await updateTransaction(transactionId, user.id, {
        partyName: partyName.trim(),
        amount_paisa: paisa,
        type,
        notes: notes.trim(),
        date,
      });
      await loadTransactions(user.id);
      Alert.alert(t('commonSaved'), t('khataEntryUpdated'), [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err: any) {
      if (__DEV__) console.error('[EditTransaction] Failed to update:', err);
      Alert.alert(t('commonError'), err?.message || t('khataUpdateFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color={color.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FormHeader title={t('khataEditEntry')} onBack={() => navigation.goBack()} />
      <ScreenContainer scrollable={true} hasTabBar={false} contentContainerStyle={styles.content}>
        <EntryHistoryMarker entryId={transactionId} />

          <View style={styles.field}>
            <Text style={styles.label}>{t('khataPartyName')} *</Text>
            <TextInput
              style={styles.input}
              placeholder={t('khataEnterParty')}
              placeholderTextColor={color.textMuted}
              value={partyName}
              onChangeText={setPartyName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('commonAmount')} (Rs.) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 1500.50"
              placeholderTextColor={color.textMuted}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('khataTypeLabel')} *</Text>
            <KhataTypeToggle value={type} onChange={setType} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('commonDate')} *</Text>
            <DateField
              style={styles.input}
              textStyle={styles.dateText}
              value={date}
              onChange={setDate}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('poNotesLabel')}</Text>
            <TextInput
              style={[styles.input, styles.notes]}
              placeholder={t('khataEnterNotes')}
              placeholderTextColor={color.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button label={loading ? 'Updating…' : 'Update entry'} onPress={handleUpdate} loading={loading} disabled={loading} fullWidth style={styles.save} />
      </ScreenContainer>
    </SafeAreaView>
  );
};
