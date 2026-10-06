import React, { useEffect, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, Alert, ScrollView, Keyboard, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { searchCustomers, addCustomer, updateCustomer, customerPhotoUri, canViewCnic, Customer, CustomerCursor } from '../../services/database/customerDb';
import { PAGE_SIZE } from '../../services/database/pagination';
import { Icon, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale, chrome } from '../../theme/tokens';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';
import { pickCustomerPhoto, persistCustomerPhoto } from '../../utils/customerPhoto';

export const CustomerBookScreen = ({ navigation, route }: any) => {
  // Staff Book → staff → Entries → Customer: that person's customers, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<CustomerCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Customer Modal (same sheet; editingId decides which)
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [cnic, setCnic] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCnic, setShowCnic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setName(''); setPhone(''); setNotes(''); setEmail(''); setCnic(''); setAddress(''); setCity('');
    setPhotoUri(null);
    setModalVisible(true);
  };

  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setName(c.name); setPhone(c.phone || ''); setNotes(c.notes || '');
    setEmail(c.email || ''); setCnic(c.cnic || ''); setAddress(c.address || ''); setCity(c.city || '');
    setPhotoUri(customerPhotoUri(c));
    setModalVisible(true);
  };

  // Search runs in SQL and the list is paged, so a shop with thousands of customers
  // never loads them all; the count is the SQL count of the whole match.
  const fetchCustomers = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const page = await searchCustomers(user.id, searchQuery, PAGE_SIZE, null, viewAs?.userId);
      setCustomers(page.rows);
      setTotal(page.total);
      setCursor(page.nextCursor);
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!user?.id || !cursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const page = await searchCustomers(user.id, searchQuery, PAGE_SIZE, cursor, viewAs?.userId);
      setCustomers(prev => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [user?.id, searchQuery]);

  useEffect(() => {
    if (user?.id) canViewCnic(user.id).then(setShowCnic).catch(() => setShowCnic(false));
  }, [user?.id]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchCustomers();
    });
    return unsubscribe;
  }, [navigation, user?.id]);

  const handleAddCustomer = async () => {
    if (!name.trim()) {
      Alert.alert(t('commonRequired'), t('customerNameRequired'));
      return;
    }
    if (!user?.id) return;

    setSaving(true);
    try {
      // Format rules (phone/email/CNIC) are enforced inside customerDb so this
      // sheet, AddCustomerModal and the bill quick-add all behave the same.
      // A sub-staff never sees the CNIC, so their save never carries the key — the
      // data layer would refuse a value and must not be handed a blank to wipe with.
      const fields = { name, phone, notes, email, address, city, ...(showCnic ? { cnic } : {}) };
      if (editingId) {
        const durable = photoUri ? await persistCustomerPhoto(photoUri, editingId) : null;
        await updateCustomer(editingId, user.id, { ...fields, photo_local_path: durable });
        await fetchCustomers();
        Alert.alert(t('commonSaved'), t('customerUpdated'));
      } else {
        const newCust = await addCustomer({ user_id: user.id, ...fields });
        if (photoUri) {
          // Copy out of the picker cache into app storage, then point the row at the copy.
          const durable = await persistCustomerPhoto(photoUri, newCust.id);
          await updateCustomer(newCust.id, user.id, { photo_local_path: durable });
          newCust.photo_local_path = durable;
        }
        await fetchCustomers();
        Alert.alert(t('commonSuccess'), t('customerAdded'));
      }
      setModalVisible(false);
    } catch (err: any) {
      // err.message is a validation message (never field contents) or a generic failure.
      Alert.alert(t('commonError'), err?.message || t('customerSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const filteredCustomers = customers;

  const renderCustomerItem = ({ item }: { item: Customer }) => {
    const place = [item.address, item.city].filter(Boolean).join(', ');
    return (
      <TouchableOpacity style={styles.customerCard} onPress={() => { if (!viewAs) openEdit(item); }} activeOpacity={viewAs ? 1 : 0.7} disabled={!!viewAs}>
        <CustomerAvatar name={item.name} uri={customerPhotoUri(item)} style={styles.avatar} textStyle={styles.avatarText} />
        <View style={styles.customerInfo}>
          <Text style={styles.customerName}>{item.name}</Text>
          {item.phone ? (
            <View style={styles.subLine}>
              <Icon name="phone" size={iconSize.sm} tint={color.textSecondary} />
              <Text style={styles.customerSub}>{item.phone}</Text>
            </View>
          ) : null}
          {place ? (
            <View style={styles.subLine}>
              <Icon name="map-pin" size={iconSize.sm} tint={color.textSecondary} />
              <Text style={styles.customerSub}>{place}</Text>
            </View>
          ) : null}
          {item.notes ? (
            <View style={styles.subLine}>
              <Icon name="file-text" size={iconSize.sm} tint={color.textMuted} />
              <Text style={styles.customerNotes}>{item.notes}</Text>
            </View>
          ) : null}
        </View>
        <Icon name="chevron-right" size={iconSize.md} tint={color.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Books Navigation Bar */}
      {viewAs
        ? <ReadOnlyBanner name={viewAs.name} book="Customer" onBack={() => navigation.goBack()} />
        : <TopHeaderWithBooks navigation={navigation} activeBook="CustomerBook" />}

      {/* Sub Header — no header Add button; a single persistent bottom button
          below replaces it (there used to be two Add Customer buttons). */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderTitle}>{t('customerTitle')} ({total})</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('customerSearchPlaceholder')}
          placeholderTextColor={color.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Customers List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : filteredCustomers.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="user" size={48} tint={color.textMuted} />
          <Text style={styles.emptyTitle}>{t('customerNoneFound')}</Text>
          <Text style={styles.emptyText}>{t('customerTapToAdd')}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCustomers}
          keyExtractor={(item) => item.id}
          renderItem={renderCustomerItem}
          contentContainerStyle={styles.listContent}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
        />
      )}

      {/* Add Customer Button */}
      {!isKeyboardVisible && !viewAs && (
        <View style={[styles.addBtnContainer, { bottom: space.lg }]}>
          <Button label={t('customerAdd')} icon="user-plus" onPress={openAdd} style={styles.addBtn} />
        </View>
      )}

      {/* Add Customer Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t(editingId ? 'customerEdit' : 'customerAddNew')}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={t('commonClose')}>
                <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalLabel}>{t('customerPhoto')}</Text>
              <TouchableOpacity style={styles.photoRow} onPress={async () => { const uri = await pickCustomerPhoto(); if (uri) setPhotoUri(uri); }}>
                <CustomerAvatar name={name || '?'} uri={photoUri} style={styles.avatar} textStyle={styles.avatarText} />
                <Text style={styles.photoHint}>{t(photoUri ? 'customerChangePhoto' : 'customerAddPhoto')}</Text>
              </TouchableOpacity>

              <Text style={styles.modalLabel}>{t('customerNameLabel')} *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('customerNamePlaceholder')}
                placeholderTextColor={color.textMuted}
                value={name}
                onChangeText={setName}
                autoFocus
              />

              <Text style={styles.modalLabel}>{t('customerPhoneLabel')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('customerPhonePlaceholder')}
                placeholderTextColor={color.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />

              <Text style={styles.modalLabel}>{t('customerEmailLabel')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('customerEmailPlaceholder')}
                placeholderTextColor={color.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />

              {showCnic && <><Text style={styles.modalLabel}>{t('customerCnicLabel')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="12345-1234567-1"
                placeholderTextColor={color.textMuted}
                keyboardType="numbers-and-punctuation"
                maxLength={15}
                value={cnic}
                onChangeText={setCnic}
              /></>}

              <Text style={styles.modalLabel}>{t('customerAddressLabel')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('customerAddressPlaceholder')}
                placeholderTextColor={color.textMuted}
                value={address}
                onChangeText={setAddress}
              />

              <Text style={styles.modalLabel}>{t('customerCityLabel')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('customerCityPlaceholder')}
                placeholderTextColor={color.textMuted}
                value={city}
                onChangeText={setCity}
              />

              <Text style={styles.modalLabel}>{t('customerNotesLabel')}</Text>
              <TextInput
                style={[styles.modalInput, styles.notesInput]}
                placeholder={t('customerNotesPlaceholder')}
                placeholderTextColor={color.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />

              <Button
                label={t(editingId ? 'commonSaveChanges' : 'customerSave')}
                onPress={handleAddCustomer}
                loading={saving}
                disabled={saving}
                fullWidth
                style={styles.saveBtn}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  subHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.lg, minHeight: touchTarget, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  subHeaderTitle: { ...typeScale.heading, color: color.textPrimary },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginVertical: space.md, paddingHorizontal: space.md, minHeight: touchTarget,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
  },
  searchInput: { ...typeScale.body, flex: 1, color: color.textPrimary, paddingVertical: space.sm },
  listContent: { paddingHorizontal: space.lg, paddingBottom: chrome.listBottom },
  footerSpinner: { margin: space.lg },
  addBtnContainer: { position: 'absolute', right: space.lg, alignItems: 'flex-end' },
  addBtn: { minHeight: chrome.fab, paddingHorizontal: space.lg, borderRadius: radius.pill },
  customerCard: {
    backgroundColor: color.surface, padding: space.md, borderRadius: radius.md, marginBottom: chrome.rowGap,
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget + space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  // The initial-letter circle: a neutral raised tone, not a colour — it means nothing.
  avatar: {
    width: 42, height: 42, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  customerInfo: { flex: 1 },
  customerName: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  customerSub: { ...typeScale.label, color: color.textSecondary, flexShrink: 1 },
  customerNotes: { ...typeScale.caption, color: color.textMuted, flexShrink: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xxxl, gap: space.sm },
  emptyTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  emptyText: { ...typeScale.body, color: color.textSecondary, textAlign: 'center', marginBottom: space.xl },
  modalOverlay: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  modalContent: {
    maxHeight: '90%', backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.xl, paddingBottom: space.xxxl,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  modalTitle: { ...typeScale.title, fontSize: 18, color: color.textPrimary, flex: 1 },
  closeBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },
  modalBody: {},
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md, minHeight: touchTarget },
  photoHint: { ...typeScale.bodyMedium, color: color.accent },
  modalLabel: { ...typeScale.label, color: color.textSecondary, marginBottom: space.xs },
  modalInput: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, paddingVertical: space.sm,
    ...typeScale.body, color: color.textPrimary, marginBottom: space.md,
  },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  saveBtn: { minHeight: 50, marginTop: space.sm },
});
