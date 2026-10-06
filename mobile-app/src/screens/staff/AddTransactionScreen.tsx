import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { createTransaction } from '../../services/database/transactionDb';
import { searchCustomers, Customer } from '../../services/database/customerDb';
import { useTransactionStore } from '../../store/transactionStore';
import { rupeesToPaisa } from '../../utils/calculations';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';
import { Icon, Button } from '../../components/ui/primitives';
import { color, iconSize } from '../../theme/tokens';
import { KhataTypeToggle, FormHeader, formStyles as styles } from './KhataEntryForm';

interface Props {
  navigation: any;
}

export const AddTransactionScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { loadTransactions } = useTransactionStore();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partyName, setPartyName] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'lena' | 'dena'>('lena');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayDate());
  const [loading, setLoading] = useState(false);

  // The picker narrows via SQL as you type — at most 20 matches, never the whole
  // customer list — so starting an entry costs the same at 40 customers or 4,000.
  useEffect(() => {
    let active = true;
    if (!user?.id) return;
    searchCustomers(user.id, partyName, 20)
      .then(page => { if (active) setCustomers(page.rows); })
      .catch(e => { if (__DEV__) console.error('[AddTransaction] customer search failed:', e); });
    return () => { active = false; };
  }, [user?.id, partyName]);

  const filteredCustomers = customers;

  const validate = (): number | null => {
    if (!partyName.trim()) {
      Alert.alert(t('commonError'), t('khataPartyRequired'));
      return null;
    }
    const paisa = rupeesToPaisa(amount);
    if (paisa === null) {
      Alert.alert(t('commonError'), t('commonAmountInvalid'));
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert(t('commonError'), t('khataDateInvalid'));
      return null;
    }
    return paisa;
  };

  const handleSave = async () => {
    const paisa = validate();
    if (paisa === null || !user) return;

    setLoading(true);
    try {
      await createTransaction(user.id, partyName.trim(), paisa, type, notes.trim() || undefined, date, undefined);
      await loadTransactions(user.id);
      Alert.alert(t('commonSaved'), t('khataEntryAdded'), [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch {
      Alert.alert(t('commonError'), t('khataSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FormHeader title={t('khataAddEntry')} onBack={() => navigation.goBack()} />
      <ScreenContainer scrollable={true} hasTabBar={false} contentContainerStyle={styles.content}>
          <View style={[styles.field, { zIndex: 50 }]}>
            <Text style={styles.label}>{t('khataCustomerName')} *</Text>
            <TextInput
              style={styles.input}
              placeholder={t('khataSelectOrEnter')}
              placeholderTextColor={color.textMuted}
              value={partyName}
              onChangeText={(txt) => { setPartyName(txt); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
            />
            {showDropdown && (
              <View style={styles.dropdown}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {filteredCustomers.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.dropItem}
                      onPress={() => { setPartyName(c.name); setShowDropdown(false); }}
                    >
                      <Text style={styles.dropName}>{c.name}</Text>
                      {c.phone && <Text style={styles.dropSub}>{c.phone}</Text>}
                    </TouchableOpacity>
                  ))}
                  {partyName.trim() !== '' && !filteredCustomers.find(c => c.name.toLowerCase() === partyName.trim().toLowerCase()) && (
                    <TouchableOpacity
                      style={styles.dropCreate}
                      onPress={() => { setShowDropdown(false); navigation.navigate('AddCustomerModal', { onSave: (nc: Customer) => { setPartyName(nc.name); setCustomers([nc, ...customers]); } }); }}
                    >
                      <Icon name="user-plus" size={iconSize.sm} tint={color.accent} />
                      <Text style={styles.dropCreateText} numberOfLines={1}>Create new customer "{partyName}"</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}
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
              onFocus={() => setShowDropdown(false)}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('khataTypeLabel')} *</Text>
            <KhataTypeToggle value={type} onChange={t => { setType(t); setShowDropdown(false); }} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('commonDate')} *</Text>
            <DateField
              style={styles.input}
              textStyle={styles.dateText}
              value={date}
              onChange={d => { setShowDropdown(false); setDate(d); }}
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
              onFocus={() => setShowDropdown(false)}
            />
          </View>

          <Button label={loading ? 'Saving…' : 'Save entry'} onPress={handleSave} loading={loading} disabled={loading} fullWidth style={styles.save} />
      </ScreenContainer>
    </SafeAreaView>
  );
};
