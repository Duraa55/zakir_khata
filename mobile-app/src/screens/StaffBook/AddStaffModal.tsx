import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { messageLabel } from '../../i18n/messageLabel';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useActivityStore } from '../../store/useActivityStore';
import { useStaffStore } from '../../store/useStaffStore';
import { TranslateToUrdu } from '../../components/TranslateToUrdu';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Icon } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { DateField } from '../../components/ui/DateField';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';
import { pickStaffPhoto, persistStaffPhoto, pickStaffDocument, persistStaffDocument, documentLabel } from '../../utils/customerPhoto';
import { updateStaffPhoto, updateStaffDocuments } from '../../services/database/staffDb';
import { todayDate } from '../../utils/dates';
import { rupeesToPaisa } from '../../utils/calculations';
import { accountPasswordProblem } from '../../services/database/managedAccountDb';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';
import { CountryCodePicker } from '../../components/CountryCodePicker';
import { CurrencyPicker } from '../../components/ui/CurrencyPicker';
import { currencyFromPhone, accountCurrencyLabel, type CurrencyCode } from '../../utils/currency';

export const AddStaffModal = ({ navigation }: any) => {
  const { user } = useAuthStore();
  // One shared opener: images preview in-app, other files go to the phone, a missing
  // file says so — the same behaviour in every book.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();
  const { addStaff } = useStaffStore();
  const { logActivity } = useActivityStore();

  // The picker's cache URI while the form is open; only the durable copy is ever saved.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [documentUrls, setDocumentUrls] = useState<string[]>([]);

  const [nameEn, setNameEn] = useState('');
  const [nameUr, setNameUr] = useState('');
  
  // The dial code is part of the LOGIN number, and it is what suggests the currency.
  // Without it a Dubai number typed the local way ("0501234567") reads as Pakistani.
  const [dialCode, setDialCode] = useState('+92');
  const [phone, setPhone] = useState('');
  // A SUGGESTION, re-derived while the admin is still typing the number, and dropped the
  // moment they pick a currency themselves — a person with a Pakistani number may work
  // in Dubai, so their choice must never be overwritten by the next keystroke.
  const [currency, setCurrency] = useState<CurrencyCode>('PKR');
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const suggestCurrency = (code: string, local: string) => {
    if (currencyTouched) return;
    setCurrency(currencyFromPhone(code + local.replace(/^0+/, '')));
  };
  const [role, setRole] = useState('');
  const [joiningDate, setJoiningDate] = useState(todayDate());
  const [area, setArea] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  // The staff member's phone is their login username; the admin types the password.
  const [password, setPassword] = useState('');
  const [salary, setSalary] = useState('');

  // An admin adds staff; a staff member adds their own sub-staff (same form).
  const addingSubStaff = user?.role !== 'admin';
  const { t } = useLanguageStore();

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameEn.trim()) e.nameEn = t('commonNameRequired');
    // The number IS the login username, so it is required only when there is a login.
    if (!addingSubStaff && !phone.trim()) e.phone = t('commonPhoneRequired');
    if (!role.trim()) e.role = t('staffRoleRequired');
    if (!joiningDate.trim()) e.joiningDate = t('commonDateRequired');
    if (!area.trim()) e.area = t('staffAreaRequired');

    if (email && !/^\S+@\S+\.\S+$/.test(email)) e.email = t('commonEmailInvalid');
    // No password for a sub-staff record — there is nothing to log in to.
    if (!addingSubStaff) {
      const pwProblem = accountPasswordProblem(password);
      if (pwProblem) e.password = messageLabel(t, pwProblem);
    }
    if (salary.trim() && rupeesToPaisa(salary) === null) e.salary = t('commonAmountInvalid');

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePickPicture = async () => {
    const uri = await pickStaffPhoto();
    if (uri) setPhotoUri(uri);
  };

  const handleAddDocument = async () => {
    // Was a placeholder that invented a filename like "doc_1726…​.pdf" and stored it —
    // a name pointing at nothing. Now it picks a real file.
    const uri = await pickStaffDocument();
    if (uri) setDocumentUrls(prev => [...prev, uri]);
  };

  const handleSubmit = async () => {
    if (!validate() || !user) {
      if (Object.keys(errors).length > 0) {
        Alert.alert(t('commonError'), t('commonFixFields'));
      }
      return;
    }

    setLoading(true);
    try {
      // One save: creates the login and the staff record together, linked.
      const created = await addStaff({
        name_en: nameEn.trim(),
        name_ur: nameUr.trim() || undefined,
        // A blank optional number is absent, not an empty dial code: '+92' alone would
        // be stored as a phone number that is really just a country.
        phone: phone.trim() ? dialCode + phone.trim().replace(/^0+/, '') : undefined,
        // Both belong to a LOGIN. A sub-staff record has none, so sending either would
        // imply a password was set and a currency chosen when neither exists.
        password: addingSubStaff ? undefined : password,
        default_currency: addingSubStaff ? undefined : currency,
        role: role.trim(),
        joining_date: joiningDate,
        area: area.trim(),
        business_type: businessType.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        document_urls: documentUrls.length > 0 ? documentUrls : undefined,
        monthly_salary: salary.trim() ? (rupeesToPaisa(salary) ?? 0) : 0,
      });
      if (photoUri) {
        // Same as customers: copy out of the picker cache into app storage, then
        // point the row at the copy.
        const durable = await persistStaffPhoto(photoUri, created.id);
        await updateStaffPhoto(created.id, user.id, durable);
        created.photo_local_path = durable;
      }
      if (documentUrls.length > 0) {
        // Documents are filed under the new staff id, for the same reason: the picker's
        // cache directory can be reclaimed by Android at any time.
        const durableDocs: string[] = [];
        for (const doc of documentUrls) durableDocs.push(await persistStaffDocument(doc, created.id));
        await updateStaffDocuments(created.id, user.id, durableDocs);
        created.document_urls = durableDocs;
      }
      
      // Log Activity
      await logActivity({
        user_id: user.id,
        user_name: user.name || 'User',
        action: 'create',
        entity_type: 'staff',
        description: `added ${addingSubStaff ? 'sub-staff' : 'staff member'} ${nameEn.trim()}`
      });

      Alert.alert(
        t('commonSuccess'),
        addingSubStaff
          ? t('staffRecordAdded', { name: nameEn.trim() })
          : t('staffCanLogIn', { name: nameEn.trim(), phone: created.phone ?? '' }),
        [{ text: t('commonOk'), onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      if (__DEV__) console.error(err);
      // The data layer's own message: weak password, number already has a login, not allowed…
      Alert.alert(t('commonError'), messageLabel(t, err?.message) || t('commonSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t(addingSubStaff ? 'staffAddSubTitle' : 'staffAddTitle')}</Text>
        <View style={{ width: touchTarget }} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.form}>
        {/* A staff member adds people they PAY, not people who use the app. Saying so
            here is why the form has no password and an optional number. */}
        {addingSubStaff && <Text style={styles.noteText}>{t('staffSubNoLoginNote')}</Text>}

        {/* Picture Section */}
        <View style={styles.pictureContainer}>
          <TouchableOpacity onPress={handlePickPicture} accessibilityRole="button" accessibilityLabel={photoUri ? 'Change photo' : 'Add photo'}>
            <CustomerAvatar name={nameEn || '?'} uri={photoUri} style={styles.pictureBox} textStyle={styles.pictureInitial} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.cameraIconBtn} onPress={handlePickPicture}>
            <Icon name="camera" size={iconSize.md} tint={color.textInverse} />
          </TouchableOpacity>
        </View>

        {/* Name */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('staffNameLabel')} *</Text>
          <TextInput
            style={[styles.input, errors.nameEn ? styles.inputError : null]}
            placeholder={t('staffNamePlaceholder')}
            placeholderTextColor={color.textMuted}
            value={nameEn}
            onChangeText={t => { setNameEn(t); setErrors(p => ({ ...p, nameEn: '' })); }}
            autoFocus
          />
          <TranslateToUrdu value={nameUr} onSave={setNameUr} />
          {!!errors.nameEn && <Text style={styles.errText}>{errors.nameEn}</Text>}
        </View>

        {/* Phone */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{addingSubStaff ? t('staffPhoneOptional') : `${t('staffPhoneLabel')} *`}</Text>
          <View style={styles.phoneRow}>
            <CountryCodePicker
              selectedCode={dialCode}
              onSelect={code => { setDialCode(code); suggestCurrency(code, phone); }}
            />
            <TextInput
              style={[styles.input, styles.phoneInput, errors.phone ? styles.inputError : null]}
              placeholder="300 1234567"
              placeholderTextColor={color.textMuted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={v => { setPhone(v); setErrors(p => ({ ...p, phone: '' })); suggestCurrency(dialCode, v); }}
            />
          </View>
          {!!errors.phone && <Text style={styles.errText}>{errors.phone}</Text>}
          {!addingSubStaff && <Text style={styles.hintText}>{t('staffPhoneHint')}</Text>}
        </View>

        {/* Currency and password both belong to the LOGIN (users.default_currency,
            users.passwordHash). A sub-staff record has neither, so showing them would
            collect two answers that go nowhere. */}
        {!addingSubStaff && (
          <>
            {/* Currency — suggested from the dial code above, always changeable. */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>{t('currencyLabel')}</Text>
              <CurrencyPicker
                value={currency}
                onChange={code => { setCurrency(code); setCurrencyTouched(true); }}
              />
              <Text style={styles.hintText}>{t('currencyHint')}</Text>
            </View>

            {/* Login password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>{t('staffPasswordLabel')} *</Text>
              <TextInput
                style={[styles.input, errors.password ? styles.inputError : null]}
                placeholder={t('staffPasswordPlaceholder')}
                placeholderTextColor={color.textMuted}
                secureTextEntry
                autoCapitalize="none"
                value={password}
                onChangeText={t => { setPassword(t); setErrors(p => ({ ...p, password: '' })); }}
              />
              {!!errors.password && <Text style={styles.errText}>{errors.password}</Text>}
            </View>
          </>
        )}

        {/* Role */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('staffRoleLabel')} *</Text>
          <TextInput
            style={[styles.input, errors.role ? styles.inputError : null]}
            placeholder={t('staffRolePlaceholder')}
            placeholderTextColor={color.textMuted}
            value={role}
            onChangeText={t => { setRole(t); setErrors(p => ({ ...p, role: '' })); }}
          />
          {!!errors.role && <Text style={styles.errText}>{errors.role}</Text>}
        </View>

        {/* Joining Date */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('staffJoiningDateLabel')} *</Text>
          <DateField
            style={[styles.input, errors.joiningDate ? styles.inputError : null]}
            value={joiningDate}
            onChange={d => { setJoiningDate(d); setErrors(p => ({ ...p, joiningDate: '' })); }}
          />
          {!!errors.joiningDate && <Text style={styles.errText}>{errors.joiningDate}</Text>}
        </View>

        {/* Monthly salary */}
        <View style={styles.fieldWrap}>
          {/* staff_records.monthly_salary has no currency column: the account's own. */}
          <Text style={styles.label}>{t('staffSalaryLabel', { currency: accountCurrencyLabel(user?.defaultCurrency) })}</Text>
          <TextInput
            style={[styles.input, errors.salary ? styles.inputError : null]}
            placeholder="e.g. 30000"
            placeholderTextColor={color.textMuted}
            keyboardType="numeric"
            value={salary}
            onChangeText={t => { setSalary(t); setErrors(p => ({ ...p, salary: '' })); }}
          />
          {!!errors.salary && <Text style={styles.errText}>{errors.salary}</Text>}
        </View>

        {/* Area & Business */}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={[styles.fieldWrap, { flex: 1 }]}>
            <Text style={styles.label}>{t('staffAreaLabel')} *</Text>
            <TextInput
              style={[styles.input, errors.area ? styles.inputError : null]}
              placeholder={t('staffAreaPlaceholder')}
              placeholderTextColor={color.textMuted}
              value={area}
              onChangeText={t => { setArea(t); setErrors(p => ({ ...p, area: '' })); }}
            />
            {!!errors.area && <Text style={styles.errText}>{errors.area}</Text>}
          </View>

          <View style={[styles.fieldWrap, { flex: 1 }]}>
            <Text style={styles.label}>{t('staffBusinessTypeLabel')}</Text>
            <TextInput
              style={[styles.input, errors.businessType ? styles.inputError : null]}
              placeholder={t('staffBusinessTypePlaceholder')}
              placeholderTextColor={color.textMuted}
              value={businessType}
              onChangeText={t => { setBusinessType(t); setErrors(p => ({ ...p, businessType: '' })); }}
            />
            {!!errors.businessType && <Text style={styles.errText}>{errors.businessType}</Text>}
          </View>
        </View>

        {/* Optional: Email & Address */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('staffEmailLabel')}</Text>
          <TextInput
            style={[styles.input, errors.email ? styles.inputError : null]}
            placeholder={t('customerEmailExample')}
            placeholderTextColor={color.textMuted}
            keyboardType="email-address"
            value={email}
            onChangeText={t => { setEmail(t); setErrors(p => ({ ...p, email: '' })); }}
          />
          {!!errors.email && <Text style={styles.errText}>{errors.email}</Text>}
        </View>

        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('staffAddressLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('staffAddressPlaceholder')}
            placeholderTextColor={color.textMuted}
            value={address}
            onChangeText={setAddress}
          />
        </View>

        {/* Documents */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('staffDocumentsLabel')}</Text>
          {documentUrls.map((doc, i) => (
            <View key={i} style={styles.docItem}>
              <TouchableOpacity style={styles.docOpen} onPress={() => openAttachment(doc)} accessibilityRole="button">
                <Icon name="paperclip" size={iconSize.sm} tint={color.textSecondary} />
                <Text style={styles.docText} numberOfLines={1}>{documentLabel(doc)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeBtn} onPress={() => setDocumentUrls(documentUrls.filter((_, idx) => idx !== i))}>
                <Text style={styles.removeText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.attachBtn} onPress={handleAddDocument}>
            <Text style={styles.attachText}>{t('staffAddDocument')}</Text>
          </TouchableOpacity>
        </View>

        {/* Save Button inside ScreenContainer */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.65 }, { marginTop: space.md, marginBottom: space.xxl }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={color.textInverse} />
            : <Text style={styles.submitText}>{t('staffSave')}</Text>
          }
        </TouchableOpacity>

      </ScreenContainer>
      {attachmentViewer}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: space.lg, height: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center' },
  backArrow: { fontSize: 24, color: color.textPrimary },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },

  form: { padding: space.lg, paddingBottom: 40 },
  noteText: { ...typeScale.label, color: color.textSecondary, marginBottom: space.lg },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // flex so the number takes whatever the dial-code chip leaves.
  phoneInput: { flex: 1 },
  fieldWrap: { marginBottom: space.lg },
  label: { ...typeScale.label, fontSize: 14, fontWeight: '500', color: color.textPrimary, marginBottom: 6 },

  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: touchTarget,
    fontSize: 14, color: color.textPrimary,
  },
  inputError: { borderColor: color.moneyOut },
  errText: { ...typeScale.caption, color: color.moneyOut, marginTop: space.xs },
  hintText: { ...typeScale.caption, color: color.textSecondary, marginTop: space.xs },

  pictureContainer: { alignSelf: 'center', marginVertical: space.lg, position: 'relative' },
  pictureBox: {
    width: 110, height: 110, backgroundColor: color.surfaceRaised,
    borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center',
    borderWidth: hairline, borderColor: color.border,
  },
  pictureInitial: { ...typeScale.title, fontSize: 40, color: color.textMuted },
  cameraIconBtn: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: color.accent, width: touchTarget, height: touchTarget,
    borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: color.surface,
  },

  attachBtn: {
    borderWidth: hairline, borderStyle: 'dashed', borderColor: color.accent,
    borderRadius: radius.sm, minHeight: 46, paddingHorizontal: space.md,
    justifyContent: 'center', alignItems: 'center', backgroundColor: color.surface,
  },
  attachText: { ...typeScale.label, fontSize: 14, fontWeight: '500', color: color.accent, textAlign: 'center' },
  docItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surface, paddingLeft: space.md, borderRadius: radius.sm,
    borderWidth: hairline, borderColor: color.border, marginBottom: space.sm,
  },
  docOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touchTarget },
  docText: { ...typeScale.body, fontSize: 14, color: color.textPrimary, flex: 1 },
  removeBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 20, color: color.moneyOut },

  submitBtn: {
    backgroundColor: color.accent, borderRadius: radius.md, minHeight: 50,
    justifyContent: 'center', alignItems: 'center',
  },
  submitText: { ...typeScale.bodyMedium, fontSize: 16, color: color.textInverse },
});
