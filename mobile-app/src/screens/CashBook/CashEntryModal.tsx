import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { categoryLabel } from '../../i18n/categoryLabel';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, Modal, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { accountCurrencyLabel } from '../../utils/currency';
import { useTransactionStore } from '../../store/transactionStore';
import { useActivityStore } from '../../store/useActivityStore';
import { createCashEntry, updateCashEntry } from '../../services/database/cashbookDb';
import { persistAttachment } from '../../utils/durableFile';
import { CashEntry } from '../../types';
import { rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { getStockItemsByUserId } from '../../services/database/stockDb';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon } from '../../components/ui/primitives';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { DateField } from '../../components/ui/DateField';
import { todayDate, isValidDateValue } from '../../utils/dates';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';

// The accent is the MEANING of the entry: money in or money out. Same pair as the
// Cash Book's two buttons, so the form reads as a continuation of the tap that opened it.

const IN_CATEGORIES = ['Sales', 'Commission', 'Loan Received', 'Recovery', 'Investment', 'Other'];
const OUT_CATEGORIES = ['Purchase', 'Rent', 'Salary', 'Utilities', 'Transport', 'Food', 'Other'];

interface Props {
  navigation: any;
  // `entry` is passed by the EditCashEntryModal route (from CashEntryDetail).
  // `date` is the day the Cash Book was showing when Cash In/Out was tapped, so a
  // forgotten entry lands on that day; the field stays editable for corrections.
  route?: { params?: { mode?: 'in' | 'out'; entry?: CashEntry; date?: string } };
}

/**
 * Unified Cash In / Cash Out entry modal.
 */
export const CashEntryModal = ({ navigation, route }: Props) => {
  const existingEntry = route?.params?.entry;
  // One shared opener: images preview in-app, other files go to the phone, a missing
  // file says so — the same behaviour in every book.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();
  const mode: 'in' | 'out' = existingEntry ? existingEntry.direction : (route?.params?.mode ?? 'in');
  const isIn = mode === 'in';
  const ACCENT = isIn ? color.moneyIn : color.moneyOut;
  const CATEGORIES = isIn ? IN_CATEGORIES : OUT_CATEGORIES;

  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { loadCashBook } = useTransactionStore();
  const { logActivity } = useActivityStore();

  const [amount, setAmount] = useState(
    existingEntry ? paisaToRupeesString(existingEntry.amount_paisa) : ''
  );
  // description / category / note are real columns now — no " — " packing.
  const [description, setDescription] = useState(
    existingEntry ? existingEntry.description : ''
  );
  const [category, setCategory] = useState(
    existingEntry?.category || CATEGORIES[0]
  );
  // New entries use whatever day Cash Book was showing when this was opened — no
  // date field needed there. Editing an existing entry still shows it, since that's
  // the one place correcting a wrong date makes sense.
  const viewedDay = route?.params?.date;
  const [date, setDate] = useState(
    existingEntry ? existingEntry.date : (viewedDay && isValidDateValue(viewedDay) ? viewedDay : todayDate())
  );
  const [note, setNote] = useState(
    existingEntry?.note ?? ''
  );
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showItemModal, setShowItemModal] = useState(false);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(
    existingEntry?.attachment_url || null
  );

  const handleTakePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(t('commonPermissionDenied'), t('commonCameraPermission'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.5,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setAttachmentUrl(result.assets[0].uri);
    }
  };

  const handlePickFromGallery = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(t('commonPermissionDenied'), t('commonGalleryPermission'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setAttachmentUrl(result.assets[0].uri);
    }
  };

  const handleSelectPhoto = () => {
    Alert.alert(
      t('cashAddPhoto'),
      'Choose an option to add a photo attachment',
      [
        {
          text: 'Camera',
          onPress: handleTakePhoto,
        },
        {
          text: 'Gallery',
          onPress: handlePickFromGallery,
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  useEffect(() => {
    if (user?.id) {
      const fetchStock = async () => {
        try {
          const items = await getStockItemsByUserId(user.id);
          setStockItems(items || []);
        } catch (err) {
          if (__DEV__) console.error('Failed to load stock items:', err);
        }
      };
      fetchStock();
    }
  }, [user?.id]);

  const filteredStockItems = stockItems.filter(item => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    const nameEn = (item.name_en || '').toLowerCase();
    const nameUr = (item.name_ur || '').toLowerCase();
    const categoryName = (item.category || '').toLowerCase();
    return nameEn.includes(query) || nameUr.includes(query) || categoryName.includes(query);
  });

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const paisa = rupeesToPaisa(amount);
    if (!amount.trim()) e.amount = t('commonAmountRequired');
    else if (paisa === null) e.amount = t('commonAmountInvalid');
    if (!description.trim()) e.description = t('cashDescriptionRequired');
    if (!category) e.category = t('commonCategoryRequired');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = t('commonDateInvalid');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate() || !user) return;
    const paisa = rupeesToPaisa(amount)!;
    setLoading(true);
    try {
      const cleanDescription = description.trim();
      const cleanNote = note.trim() || null;
      // The picker hands back a CACHE path Android may clear at any time; file a durable
      // copy first and save only that. An already-durable path (editing) is kept as-is.
      const durableAttachment = attachmentUrl ? await persistAttachment('cash', attachmentUrl) : null;

      if (existingEntry) {
        await updateCashEntry(existingEntry.id, user.id, {
          description: cleanDescription,
          amount_paisa: paisa,
          direction: mode,
          date: date,
          category: category,
          note: cleanNote,
          attachment_url: durableAttachment,
        });

        await logActivity({
          user_id: user.id,
          user_name: user.name || 'User',
          action: 'update',
          entity_type: 'cash',
          entity_id: existingEntry.id,
          description: `Updated ${isIn ? 'Cash In' : 'Cash Out'}: ${cleanDescription}`,
          amount: paisa,
        });
      } else {
        const entry = await createCashEntry(
          user.id, cleanDescription, paisa, mode, date,
          durableAttachment, category, cleanNote
        );

        await logActivity({
          user_id: user.id,
          user_name: user.name || 'User',
          action: 'create',
          entity_type: 'cash',
          entity_id: entry.id,
          description: `${isIn ? 'Cash In' : 'Cash Out'}: ${cleanDescription}`,
          amount: paisa,
        });
      }

      await loadCashBook(user.id);
      navigation.goBack();
    } catch (err: any) {
      if (__DEV__) console.error('[CashEntry] Failed to save:', err);
      Alert.alert(t('commonError'), err?.message || t('commonSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{existingEntry ? t('cashEditEntry') : t(isIn ? 'cashIn' : 'cashOut')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.form}>

        {/* Amount Stepper & Presets */}
        <View style={styles.fieldWrap}>
          {/* No picker here by decision: a cashbook entry is denominated in the ACCOUNT
              default (CLAUDE.md). The label therefore has to NAME that currency — it read
              "(Rs.)" in every account, telling a Dubai shop to type rupees into a dirham field. */}
          <Text style={styles.label}>{t('cashAmountLabel', { currency: accountCurrencyLabel(user?.defaultCurrency) })} *</Text>
          <View style={[styles.stepperBox, errors.amount ? styles.inputError : null]}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => {
                const num = parseFloat(amount) || 0;
                if (num >= 50) setAmount((num - 50).toString());
              }}
            >
              <Text style={styles.stepperIcon}>-</Text>
            </TouchableOpacity>

            <View style={styles.stepperCenter}>
              <Text style={[styles.rsPrefix, { color: ACCENT }]}>Rs.</Text>
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

            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => {
                const num = parseFloat(amount) || 0;
                setAmount((num + 50).toString());
              }}
            >
              <Text style={styles.stepperIcon}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Amount Preset Pills */}
          <View style={styles.presetPillRow}>
            {['50', '100', '200', '500', '1000'].map(val => (
              <TouchableOpacity
                key={val}
                style={[styles.presetPill, amount === val && styles.presetPillActive]}
                onPress={() => { setAmount(val); setErrors(p => ({ ...p, amount: '' })); }}
              >
                <Text style={[styles.presetPillText, amount === val && styles.presetPillTextActive]}>
                  Rs {val}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {!!errors.amount && <Text style={styles.errText}>{errors.amount}</Text>}
        </View>

        {/* Description / Item */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('cashDescriptionLabel')} *</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }, errors.description ? styles.inputError : null]}
              placeholder={t('cashDescriptionPlaceholder')}
              placeholderTextColor={color.textMuted}
              value={description}
              onChangeText={t => { setDescription(t); setErrors(p => ({ ...p, description: '' })); }}
            />
            {stockItems.length > 0 && (
              <TouchableOpacity
                style={styles.selectStockBtn}
                onPress={() => setShowItemModal(true)}
              >
                <Icon name="package" size={iconSize.sm} tint={color.brand} />
                <Text style={styles.selectStockBtnText}>{t('cashStockButton')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {!!errors.description && <Text style={styles.errText}>{errors.description}</Text>}
        </View>

        {/* Category */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('commonCategory')} *</Text>
          <View style={styles.chips}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, category === cat && { backgroundColor: ACCENT, borderColor: ACCENT }]}
                onPress={() => { setCategory(cat); setErrors(p => ({ ...p, category: '' })); }}
              >
                <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{categoryLabel(t, cat)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!!errors.category && <Text style={styles.errText}>{errors.category}</Text>}
        </View>

        {/* Date — only shown when editing; a new entry uses the day Cash Book
            was already showing, so asking again would just repeat it. */}
        {!!existingEntry && (
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>{t('commonDate')} *</Text>
            <DateField
              style={[styles.input, errors.date ? styles.inputError : null]}
              value={date}
              onChange={(txt) => {
                setDate(txt);
                if (errors.date) setErrors((p) => ({ ...p, date: '' }));
              }}
            />
            {!!errors.date && <Text style={styles.errText}>{errors.date}</Text>}
          </View>
        )}

        {/* Note / Details */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('cashNoteLabel')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={t('cashNotePlaceholder')}
            placeholderTextColor={color.textMuted}
            multiline
            numberOfLines={3}
            value={note}
            onChangeText={setNote}
          />
        </View>

        {/* Photo / Bill Attachment */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('cashPhotoLabel')}</Text>
          {attachmentUrl ? (
            <View style={styles.attachmentContainer}>
              <TouchableOpacity onPress={() => openAttachment(attachmentUrl)} activeOpacity={0.85} accessibilityRole="imagebutton">
                <Image source={{ uri: attachmentUrl }} style={styles.attachmentPreview} />
              </TouchableOpacity>
              <View style={styles.attachmentInfo}>
                <Text style={styles.attachmentTitle}>{t('cashPhotoAttached')}</Text>
                <TouchableOpacity onPress={handleSelectPhoto}>
                  <Text style={styles.attachmentChangeText}>{t('cashChangePhoto')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.attachmentRemoveBtn} onPress={() => setAttachmentUrl(null)}>
                <Icon name="x" size={iconSize.sm} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.attachmentButton} onPress={handleSelectPhoto}>
              <Icon name="camera" size={iconSize.md} tint={color.textSecondary} />
              <Text style={styles.attachmentButtonText}>{t('cashAddPhoto')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} disabled={loading}>
            <Text style={styles.cancelText}>{t('commonCancel')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: ACCENT }, loading && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={color.textInverse} />
            ) : (
              <Text style={styles.submitText}>{t(isIn ? 'cashIn' : 'cashOut')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScreenContainer>

      {/* Stock Item Picker Modal */}
      <Modal
        visible={showItemModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowItemModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('cashSelectStockItem')}</Text>
              <TouchableOpacity onPress={() => { setShowItemModal(false); setSearchQuery(''); }}>
                <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search Box */}
            <TextInput
              style={styles.modalSearchInput}
              placeholder={t('cashSearchStockPlaceholder')}
              placeholderTextColor={color.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            {/* Item List */}
            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {filteredStockItems.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {t(stockItems.length === 0 ? 'cashNoStockItems' : 'cashNoMatchingItems')}
                  </Text>
                </View>
              ) : (
                filteredStockItems.map((item) => {
                  const isLowStock = item.quantity <= item.low_stock_threshold;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.itemRow}
                      onPress={() => {
                        setDescription(item.name_en + (item.name_ur ? ` (${item.name_ur})` : ''));
                        const price = isIn ? item.sale_price : item.purchase_price;
                        setAmount(price.toString());
                        const targetCategories = isIn ? IN_CATEGORIES : OUT_CATEGORIES;
                        const defaultCategory = isIn ? 'Sales' : 'Purchase';
                        const matchedCat = targetCategories.find(c => c.toLowerCase() === item.category.toLowerCase());
                        setCategory(matchedCat || defaultCategory);
                        setErrors(p => ({ ...p, description: '', amount: '', category: '' }));
                        setShowItemModal(false);
                        setSearchQuery('');
                      }}
                    >
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemNameEn}>{item.name_en}</Text>
                        {!!item.name_ur && <Text style={styles.itemNameUr}>{item.name_ur}</Text>}
                        <Text style={styles.itemCategory}>{item.category}</Text>
                      </View>
                      <View style={styles.itemMeta}>
                        <Text style={styles.itemPrice}>Rs. {isIn ? item.sale_price : item.purchase_price}</Text>
                        <Text style={[styles.itemQty, isLowStock ? styles.lowStock : styles.normalStock]}>
                          Qty: {item.quantity} {item.unit}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {attachmentViewer}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, height: 56, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  closeBtnText: { ...typeScale.body, color: color.textSecondary },
  backBtn: { width: touchTarget, justifyContent: 'center' },
  backArrow: { fontSize: 24, color: color.textPrimary },
  headerTitle: { ...typeScale.title, color: color.textPrimary },

  form: { padding: space.xl, paddingBottom: space.xxxl },
  fieldWrap: { marginBottom: space.xl },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },

  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    ...typeScale.body, color: color.textPrimary, minHeight: touchTarget,
  },
  textArea: { minHeight: 85, textAlignVertical: 'top' },
  inputError: { borderColor: color.moneyOut },
  errText: { ...typeScale.caption, color: color.moneyOut, marginTop: space.xs },

  selectStockBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.md, paddingHorizontal: space.md,
    justifyContent: 'center', minHeight: touchTarget,
  },
  selectStockBtnText: { ...typeScale.label, color: color.brand },

  // The amount is the one figure that matters on this screen, so it gets the space.
  stepperBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceRaised,
    borderRadius: radius.lg, paddingHorizontal: space.md, minHeight: 56,
    borderWidth: hairline, borderColor: color.border,
  },
  stepperBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radius.pill,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: hairline, borderColor: color.border,
  },
  stepperIcon: { fontSize: 22, color: color.textPrimary },
  stepperCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  rsPrefix: { ...typeScale.title, marginRight: space.xs },
  amountInput: {
    fontSize: 28, fontWeight: '500', color: color.textPrimary,
    minWidth: 100, textAlign: 'center',
  },

  presetPillRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md, justifyContent: 'space-between' },
  presetPill: {
    flex: 1, backgroundColor: color.surface,
    borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.pill, paddingVertical: space.sm, alignItems: 'center',
  },
  presetPillActive: { backgroundColor: color.accent, borderColor: color.accent },
  presetPillText: { ...typeScale.caption, color: color.textSecondary },
  presetPillTextActive: { ...typeScale.caption, color: color.textInverse },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // No fixed width: a longer Urdu category simply makes its own chip wider.
  chip: {
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm,
    minHeight: 36, justifyContent: 'center',
  },
  chipText: { ...typeScale.label, color: color.textSecondary },
  chipTextActive: { color: color.textInverse },

  attachmentButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.borderStrong,
    borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: space.md,
    gap: space.sm, minHeight: touchTarget,
  },
  attachmentButtonIcon: { fontSize: 18 },
  attachmentButtonText: { ...typeScale.body, color: color.textSecondary },

  attachmentContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, padding: space.md,
  },
  attachmentPreview: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: color.surface },
  attachmentInfo: { flex: 1, marginLeft: space.md },
  attachmentTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  attachmentChangeText: { ...typeScale.label, color: color.brand, marginTop: 2 },
  attachmentRemoveBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  attachmentRemoveText: { ...typeScale.body, color: color.textSecondary },

  btnRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  cancelBtn: {
    flex: 1, backgroundColor: color.surface, borderRadius: radius.md,
    paddingVertical: space.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: hairline, borderColor: color.borderStrong, minHeight: touchTarget,
  },
  cancelText: { ...typeScale.bodyMedium, color: color.textPrimary },

  submitBtn: {
    flex: 2, borderRadius: radius.md, paddingVertical: space.md,
    alignItems: 'center', justifyContent: 'center', minHeight: touchTarget,
  },
  submitText: { ...typeScale.bodyMedium, color: color.textInverse },

  modalOverlay: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.xl, maxHeight: '80%', borderWidth: hairline, borderColor: color.border,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  modalTitle: { ...typeScale.title, color: color.textPrimary },
  modalSearchInput: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    ...typeScale.body, color: color.textPrimary, marginBottom: space.md,
  },
  modalList: { maxHeight: 350 },
  emptyContainer: { paddingVertical: space.xxxl, alignItems: 'center' },
  emptyText: { ...typeScale.body, color: color.textMuted, textAlign: 'center', lineHeight: 20 },

  itemRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: space.md, borderBottomWidth: hairline, borderBottomColor: color.border,
    minHeight: touchTarget,
  },
  itemInfo: { flex: 1, paddingRight: space.sm },
  itemNameEn: { ...typeScale.bodyMedium, color: color.textPrimary },
  itemNameUr: { ...typeScale.label, color: color.textSecondary, marginTop: 2 },
  itemCategory: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  itemMeta: { alignItems: 'flex-end', flexShrink: 0 },
  itemPrice: { ...typeScale.bodyMedium, color: color.textPrimary },
  itemQty: { ...typeScale.caption, marginTop: 2 },
  normalStock: { color: color.textSecondary },
  lowStock: { color: color.moneyOut },
});
