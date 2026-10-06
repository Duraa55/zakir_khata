import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useSupplierStore } from '../../store/useSupplierStore';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { color, space, radius, type as typeScale, hairline, touchTarget } from '../../theme/tokens';

interface Props {
  navigation: any;
  route?: { params?: { supplierId?: string; edit?: boolean } };
}

export const AddSupplierModal = ({ navigation, route }: Props) => {
  const isEdit = route?.params?.edit ?? false;
  const supplierId = route?.params?.supplierId;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { addSupplier, updateSupplier, selectedSupplier, loadSupplierById } = useSupplierStore();

  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEdit && supplierId) {
      loadSupplierById(supplierId).then(() => {});
    }
  }, [isEdit, supplierId]);

  useEffect(() => {
    if (isEdit && selectedSupplier) {
      setName(selectedSupplier.name || '');
      setBusinessName(selectedSupplier.business_name || '');
      setPhone(selectedSupplier.phone || '');
      setEmail(selectedSupplier.email || '');
      setAddress(selectedSupplier.address || '');
      setCity(selectedSupplier.city || '');
      setNotes(selectedSupplier.notes || '');
    }
  }, [selectedSupplier, isEdit]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Supplier name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user) return;
    setLoading(true);
    try {
      if (isEdit && supplierId) {
        await updateSupplier(supplierId, user.id, {
          name: name.trim(),
          business_name: businessName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        Alert.alert(t('supUpdatedTitle'), t('supUpdatedBody'), [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } else {
        await addSupplier(
          user.id, name.trim(),
          phone.trim() || undefined,
          businessName.trim() || undefined,
          address.trim() || undefined,
          email.trim() || undefined,
          city.trim() || undefined,
          notes.trim() || undefined,
        );
        Alert.alert(t('supAddedTitle'), t('supAddedBody'), [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
    } catch (err) {
      Alert.alert(t('commonError'), t('supSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Edit Supplier' : 'Add Supplier'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={false} contentContainerStyle={styles.form}>
        <Field label={t('supNameLabel') + ' *'} value={name} onChange={setName} placeholder={t('supNameExample')} error={errors.name} />
        <Field label={t('supBusinessLabel')} value={businessName} onChange={setBusinessName} placeholder={t('supBusinessExample')} />
        <Field label={t('supPhoneLabel')} value={phone} onChange={setPhone} placeholder="03001234567" keyboardType="phone-pad" />
        <Field label={t('supEmailLabel')} value={email} onChange={setEmail} placeholder={t('supEmailExample')} keyboardType="email-address" />
        <Field label={t('customerCityShort')} value={city} onChange={setCity} placeholder={t('staffAreaPlaceholder')} />
        <Field label={t('customerAddressShort')} value={address} onChange={setAddress} placeholder={t('supAddressExample')} multiline />
        <Field label={t('commonNote')} value={notes} onChange={setNotes} placeholder={t('supNotesExample')} multiline />

        <TouchableOpacity style={[styles.saveBtn, loading && { opacity: 0.6 }]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={color.textInverse} /> : <Text style={styles.saveBtnText}>{isEdit ? 'Update supplier' : 'Save supplier'}</Text>}
        </TouchableOpacity>
      </ScreenContainer>
    </SafeAreaView>
  );
};

const Field = ({ label, value, onChange, placeholder, keyboardType = 'default', multiline = false, error = '' }: any) => (
  <View style={styles.fieldWrap}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.inputMulti, error ? styles.inputErr : null]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      keyboardType={keyboardType}
      multiline={multiline}
      numberOfLines={multiline ? 3 : 1}
      textAlignVertical={multiline ? 'top' : 'center'}
      placeholderTextColor={color.textSecondary}
    />
    {!!error && <Text style={styles.errText}>{error}</Text>}
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: 16, height: 56,
    borderBottomWidth: 1, borderBottomColor: color.border,
  },
  backBtn: { width: 36 },
  backArrow: { fontSize: 22, color: color.textPrimary, fontWeight: '500' },
  headerTitle: { fontSize: 18, fontWeight: '500', color: color.textPrimary },
  form: { padding: 20, paddingBottom: 40 },
  fieldWrap: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '500', color: color.textPrimary, marginBottom: 6 },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: 1, borderColor: color.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: color.textPrimary,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  inputErr: { borderColor: color.moneyOut },
  errText: { fontSize: 12, color: color.moneyOut, marginTop: 4 },
  saveBtn: { backgroundColor: color.accent, borderRadius: radius.md, paddingVertical: space.md, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  saveBtnText: { color: color.textInverse, fontWeight: '500', fontSize: 16, letterSpacing: 0.5 },
});
