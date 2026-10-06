import React, { useEffect, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { addCustomer, updateCustomer, canViewCnic } from '../../services/database/customerDb';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';
import { pickCustomerPhoto, persistCustomerPhoto } from '../../utils/customerPhoto';
import { Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, type as typeScale } from '../../theme/tokens';


export const AddCustomerModal = ({ navigation, route }: any) => {
  const { user } = useAuthStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [cnic, setCnic] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCnic, setShowCnic] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (user?.id) canViewCnic(user.id).then(setShowCnic).catch(() => setShowCnic(false)); }, [user?.id]);

  const onSaveCallback = route.params?.onSave;

  const { t } = useLanguageStore();

  const handleSave = async () => {
    if (!user) return;
    if (!name.trim()) {
      return Alert.alert(t('commonError'), t('customerNameRequired'));
    }

    setLoading(true);
    try {
      // Validation (phone/email/CNIC format) lives in addCustomer so every add path
      // enforces the same rules; a thrown message is shown as-is below.
      const newCustomer = await addCustomer({
        user_id: user.id,
        name, phone, notes, email, address, city,
        ...(showCnic ? { cnic } : {}),
      });
      if (photoUri) {
        // Copy out of the picker cache into app storage, then point the row at the copy.
        const durable = await persistCustomerPhoto(photoUri, newCustomer.id);
        await updateCustomer(newCustomer.id, user.id, { photo_local_path: durable });
        newCustomer.photo_local_path = durable;
      }
      
      if (onSaveCallback) {
        onSaveCallback(newCustomer);
      } else {
        Alert.alert(t('commonSuccess'), t('customerAdded'));
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert(t('commonError'), e.message || t('customerSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenContainer scrollable={true} hasTabBar={true}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn} accessibilityRole="button">
            <Text style={styles.cancelText}>{t('commonCancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('customerAddNew')}</Text>
          <View style={styles.cancelBtn} />
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('commonPhoto')}</Text>
            <TouchableOpacity style={styles.photoRow} onPress={async () => { const uri = await pickCustomerPhoto(); if (uri) setPhotoUri(uri); }}>
              <CustomerAvatar name={name || '?'} uri={photoUri} style={styles.avatar} textStyle={styles.avatarText} />
              <Text style={styles.photoHint}>{photoUri ? 'Change photo' : 'Add photo (optional)'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('customerNameLabel')} *</Text>
            <TextInput
              style={styles.input}
              placeholder={t('customerNameExample')}
              placeholderTextColor={color.textMuted}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('staffPhoneLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('customerPhoneExample')}
              placeholderTextColor={color.textMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('customerEmailShort')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('customerEmailExample')}
              placeholderTextColor={color.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          {showCnic && <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('customerCnicShort')}</Text>
            <TextInput
              style={styles.input}
              placeholder="12345-1234567-1"
              placeholderTextColor={color.textMuted}
              value={cnic}
              onChangeText={setCnic}
              keyboardType="numbers-and-punctuation"
              maxLength={15}
            />
          </View>}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('customerAddressShort')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('customerAddressExample')}
              placeholderTextColor={color.textMuted}
              value={address}
              onChangeText={setAddress}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('customerCityShort')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('staffAreaPlaceholder')}
              placeholderTextColor={color.textMuted}
              value={city}
              onChangeText={setCity}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('commonNote')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder={t('customerNotesExample')}
              placeholderTextColor={color.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>
        </View>

        <View style={styles.footer}>
          <Button label={t(loading ? 'commonSaving' : 'customerSave')} onPress={handleSave} loading={loading} disabled={loading} fullWidth style={styles.saveBtn} />
        </View>
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.sm, minHeight: 56, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  cancelBtn: { minWidth: 64, minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: space.sm },
  cancelText: { ...typeScale.bodyMedium, color: color.accent },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  form: { flex: 1, padding: space.lg },
  inputGroup: { marginBottom: space.lg },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, paddingVertical: space.sm,
    ...typeScale.body, color: color.textPrimary,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget },
  // The initial-letter circle: neutral tone, no colour meaning.
  avatar: {
    width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...typeScale.title, color: color.textPrimary },
  photoHint: { ...typeScale.bodyMedium, color: color.accent },
  footer: { padding: space.lg, backgroundColor: color.surface, borderTopWidth: hairline, borderTopColor: color.border },
  saveBtn: { minHeight: 50 },
});
