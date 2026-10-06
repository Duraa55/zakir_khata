import React, { useEffect, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Modal, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Card, Row, Icon, Button } from '../../components/ui/primitives';
import { DateField } from '../../components/ui/DateField';
import { formatDisplayDate, toDateValue } from '../../utils/dates';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';
import { staffPhotoUri } from '../../services/database/staffDb';
import { canCreateStaff, removeStaffAccess, updateStaffProfile } from '../../services/database/managedAccountDb';
import { getAccountCurrency, getStaffRecordById, getStaffRecords } from '../../services/database/staffDb';
import type { StaffRecord } from '../../types/staff.types';
import { documentLabel } from '../../utils/customerPhoto';
import { useAuthStore } from '../../store/authStore';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';
import { CurrencyPicker } from '../../components/ui/CurrencyPicker';
import type { CurrencyCode } from '../../utils/currency';

export const StaffDetail = ({ route, navigation }: any) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  // One shared opener: images preview in-app, other files go to the phone, a missing
  // file says so — the same behaviour in every book.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();
  // Staff Book passes the whole record; Global Search knows only the id.
  const [loaded, setLoaded] = useState(route.params?.staff ?? null);
  const staffId = route.params?.staff?.id ?? route.params?.staffId;
  useEffect(() => {
    if (route.params?.staff || !staffId || !user?.id) return;
    getStaffRecordById(user.id, staffId).then(setLoaded).catch(e => { if (__DEV__) console.error('[StaffDetail] load failed:', e); });
  }, [staffId, user?.id, route.params?.staff]);
  const staff = loaded;
  // Only someone who can add staff can remove them; the data layer enforces the same
  // rule (and the own-team check) — this just avoids showing a button that would fail.
  const [canRemove, setCanRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { canCreateStaff().then(setCanRemove); }, []);

  // ── Edit profile (same team rule as Remove, enforced in managedAccountDb) ──────
  // The people THIS person added (their own sub-staff), shown inside their profile.
  const [subStaff, setSubStaff] = useState<StaffRecord[]>([]);
  useEffect(() => {
    const ownerId = route.params?.staff?.linked_user_id ?? loaded?.linked_user_id;
    if (!user?.id || !ownerId || ownerId === user.id) { setSubStaff([]); return; }
    let active = true;
    getStaffRecords(user.id, ownerId)
      .then(rows => { if (active) setSubStaff(rows); })
      .catch(err => { if (__DEV__) console.error('[StaffDetail] sub-staff failed:', err); });
    return () => { active = false; };
  }, [user?.id, route.params?.staff?.linked_user_id, loaded?.linked_user_id]);

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name_en: '', name_ur: '', role: '', area: '', business_type: '', email: '', address: '', joining_date: '' });
  // Held apart from `form`: it belongs to the linked LOGIN (users.default_currency), not
  // to the staff_record the other fields write, and a profile without a login has none.
  const [currency, setCurrency] = useState<CurrencyCode | null>(null);
  const setField = (key: keyof typeof form) => (value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const openEdit = async () => {
    setCurrency(staff.linked_user_id ? await getAccountCurrency(staff.linked_user_id) : null);
    setForm({
      name_en: staff.name_en || '', name_ur: staff.name_ur || '', role: staff.role || '',
      area: staff.area || '', business_type: staff.business_type || '', email: staff.email || '',
      address: staff.address || '', joining_date: toDateValue(staff.joining_date) || '',
    });
    setEditOpen(true);
  };
  const saveEdit = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await updateStaffProfile(staff.id, currency ? { ...form, default_currency: currency } : form);
      const fresh = await getStaffRecordById(user.id, staff.id);
      if (fresh) setLoaded(fresh);
      setEditOpen(false);
    } catch (e: any) {
      Alert.alert(t('commonError'), e?.message || t('staffSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = () => {
    Alert.alert(
      t('staffRemoveTitle', { name: staff.name_en }),
      t('staffRemoveBody', { name: staff.name_en }),
      [
        { text: t('commonCancel'), style: 'cancel' },
        {
          text: t('commonRemove'), style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removeStaffAccess(staff.id);
              Alert.alert(t('commonRemoved'), t('staffRemovedBody', { name: staff.name_en }), [
                { text: t('commonOk'), onPress: () => navigation.goBack() },
              ]);
            } catch (e: any) {
              if (__DEV__) console.error('[StaffDetail] remove failed:', e);
              Alert.alert(t('commonError'), e?.message || t('staffRemoveFailed'));
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  };

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
            <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('staffProfileTitle')}</Text>
          <View style={{ width: touchTarget }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.notFound}>{t('staffNotFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('staffProfileTitle')}</Text>
        {/* Only a manager of this person sees Edit; the data layer checks the team again. */}
        {canRemove ? (
          <TouchableOpacity style={styles.editBtn} onPress={openEdit} accessibilityRole="button">
            <Text style={styles.editText}>{t('commonEdit')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.editBtn} />
        )}
      </View>

      <ScreenContainer scrollable={true} hasTabBar={false} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        {/* Profile Card */}
        <Card tone="outlined">
          <View style={styles.cardTop}>
            <CustomerAvatar name={staff.name_en || '?'} uri={staffPhotoUri(staff)} style={styles.avatar} textStyle={styles.avatarInitial} />
            <View style={{ flex: 1 }}>
              <Text style={styles.nameEn}>{staff.name_en}</Text>
              {staff.name_ur ? <Text style={styles.nameUr}>{staff.name_ur}</Text> : null}
              <Text style={styles.role}>{staff.role}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Details — label and value side by side; the label is never a fixed
              width, so a longer Urdu label wraps instead of being cut. */}
          <View style={styles.detailsList}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('commonPhone')}</Text>
              {/* A sub-staff record has no login and may carry no number at all. */}
              <Text style={styles.detailValue}>{staff.phone || t('commonNotSet')}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('staffJoiningDateLabel')}</Text>
              <Text style={styles.detailValue}>{formatDisplayDate(toDateValue(staff.joining_date) || staff.joining_date)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('commonStatus')}</Text>
              <Text style={[styles.detailValue, { color: staff.status === 'active' ? color.moneyIn : color.attention }]}>
                {t(staff.status === 'active' ? 'commonActive' : 'commonInactive')}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('commonArea')}</Text>
              <Text style={styles.detailValue}>{staff.area}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('staffBusinessTypeShort')}</Text>
              <Text style={styles.detailValue}>{staff.business_type}</Text>
            </View>
            {staff.email ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('customerEmailShort')}</Text>
                <Text style={styles.detailValue}>{staff.email}</Text>
              </View>
            ) : null}
            {staff.address ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('customerAddressShort')}</Text>
                <Text style={styles.detailValue}>{staff.address}</Text>
              </View>
            ) : null}
          </View>
        </Card>

        {/* Salary ledger */}
        <Row
          title={t('staffSalaryLedger')}
          detail="Manage salary, cash out & cash in"
          icon="dollar-sign"
          iconTint={color.accent}
          onPress={() => navigation.navigate('StaffSalaryDetail', { staff })}
          style={{ marginTop: space.lg }}
        />

        {/* Entries — this person's books, read-only */}
        <Row
          title={t('staffEntriesRow')}
          detail="Cash, bills, expenses and more — read only"
          icon="book"
          iconTint={color.accent}
          onPress={() => navigation.navigate('StaffEntries', { staff })}
          style={{ marginTop: space.sm }}
        />

        {/* Sub-staff — the people this person added. Their books open from their own profile. */}
        {subStaff.length > 0 && (
          <Card tone="outlined" style={{ marginTop: space.lg }}>
            <Text style={styles.cardHeader}>{t('staffSubStaff')}</Text>
            <View style={styles.divider} />
            {subStaff.map((sub, idx) => (
              <TouchableOpacity
                key={sub.id}
                style={[styles.docRow, idx > 0 && styles.docRowBorder]}
                onPress={() => navigation.push('StaffDetailBook', { staff: sub })}
                accessibilityRole="button"
                accessibilityLabel={sub.name_en}
              >
                <CustomerAvatar name={sub.name_en} uri={staffPhotoUri(sub)} style={styles.subAvatar} textStyle={styles.subAvatarText} />
                <Text style={styles.docText} numberOfLines={1}>{sub.name_en}</Text>
                <Icon name="chevron-right" size={iconSize.sm} tint={color.textMuted} />
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {/* Documents */}
        {staff.document_urls && staff.document_urls.length > 0 && (
          <Card tone="outlined" style={{ marginTop: space.lg }}>
            <Text style={styles.cardHeader}>{t('commonAttachments')}</Text>
            <View style={styles.divider} />
            {staff.document_urls.map((doc: string, idx: number) => (
              <TouchableOpacity
                key={idx}
                style={[styles.docRow, idx > 0 && styles.docRowBorder]}
                onPress={() => openAttachment(doc)}
                accessibilityRole="button"
                accessibilityLabel={documentLabel(doc)}
              >
                <Icon name="paperclip" size={iconSize.sm} tint={color.textSecondary} />
                <Text style={styles.docText} numberOfLines={1}>{documentLabel(doc)}</Text>
                <Icon name="chevron-right" size={iconSize.sm} tint={color.textMuted} />
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {/* Remove — takes away the login, marks the profile inactive, deletes nothing. */}
        {canRemove && staff.status === 'active' && (
          <TouchableOpacity
            style={[styles.removeBtn, removing && { opacity: 0.5 }]}
            onPress={handleRemove}
            disabled={removing}
            accessibilityRole="button"
          >
            <Text style={styles.removeText}>{t('staffRemove')}</Text>
          </TouchableOpacity>
        )}

      </ScreenContainer>
      {attachmentViewer}

      {/* Edit profile sheet */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('staffEditProfile')}</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonClose')}>
                <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {([
                ['name_en', t('commonName') + ' *'], ['name_ur', t('commonNameUrdu')], ['role', t('commonRole')], ['area', t('commonArea')],
                ['business_type', t('staffBusinessTypeShort')], ['email', t('customerEmailShort')], ['address', t('customerAddressShort')],
              ] as [keyof typeof form, string][]).map(([key, label]) => (
                <View key={key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={form[key]}
                    onChangeText={setField(key)}
                    placeholderTextColor={color.textMuted}
                    keyboardType={key === 'email' ? 'email-address' : 'default'}
                    autoCapitalize={key === 'email' ? 'none' : 'sentences'}
                  />
                </View>
              ))}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('staffJoiningDateLabel')}</Text>
                <DateField style={styles.fieldInput} value={form.joining_date} onChange={setField('joining_date')} maximumDate={new Date()} />
              </View>
              {/* Only when this profile HAS a login: the currency is stored on that row. */}
              {currency && (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>{t('currencyLabel')}</Text>
                  <CurrencyPicker value={currency} onChange={setCurrency} />
                </View>
              )}
              {/* The phone is the login username, so it cannot be changed from here. */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('staffPhoneLogin')}</Text>
                <Text style={styles.fieldReadOnly}>{staff.phone || t('commonNotSet')}</Text>
              </View>
              <Button label={t('commonSaveChanges')} onPress={saveEdit} loading={saving} disabled={saving} fullWidth style={styles.sheetSave} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  subAvatar: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  subAvatarText: { ...typeScale.caption, color: color.textSecondary },
  safe: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notFound: { ...typeScale.body, color: color.textSecondary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: space.lg, height: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  editBtn: { minWidth: touchTarget, height: touchTarget, alignItems: 'flex-end', justifyContent: 'center' },
  editText: { ...typeScale.bodyMedium, color: color.accent },

  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingBottom: space.lg },
  avatar: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    justifyContent: 'center', alignItems: 'center', borderWidth: hairline, borderColor: color.border,
  },
  avatarInitial: { ...typeScale.title, fontSize: 28, color: color.textSecondary },
  nameEn: { ...typeScale.title, color: color.textPrimary },
  nameUr: { ...typeScale.label, color: color.textSecondary, marginTop: 2, textAlign: 'right' },
  role: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },

  divider: { height: hairline, backgroundColor: color.border, marginVertical: space.md },

  detailsList: { paddingTop: space.xs },
  detailRow: { flexDirection: 'row', paddingVertical: space.sm, gap: space.md },
  detailLabel: { ...typeScale.label, color: color.textSecondary, flexShrink: 0, maxWidth: '45%' },
  detailValue: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1, textAlign: 'right' },

  cardHeader: { ...typeScale.heading, color: color.textPrimary, paddingBottom: space.xs },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, minHeight: touchTarget },
  docRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  docText: { ...typeScale.body, color: color.textPrimary, flex: 1 },

  removeBtn: {
    marginTop: space.xxl, minHeight: touchTarget, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.moneyOut, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg,
  },
  removeText: { ...typeScale.bodyMedium, color: color.moneyOut },

  sheetOverlay: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%', backgroundColor: color.surface, padding: space.xl, paddingBottom: space.xxxl,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  sheetTitle: { ...typeScale.title, fontSize: 18, color: color.textPrimary, flex: 1 },
  field: { marginBottom: space.md },
  fieldLabel: { ...typeScale.label, color: color.textSecondary, marginBottom: space.xs },
  fieldInput: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.md, minHeight: touchTarget, paddingVertical: space.sm, ...typeScale.body, color: color.textPrimary,
    justifyContent: 'center',
  },
  fieldReadOnly: { ...typeScale.body, color: color.textSecondary, paddingVertical: space.sm },
  sheetSave: { minHeight: 50, marginTop: space.sm },
});
