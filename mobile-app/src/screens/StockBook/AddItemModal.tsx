import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { categoryLabel, unitLabel } from '../../i18n/categoryLabel';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { accountCurrencyLabel } from '../../utils/currency';
import { useActivityStore } from '../../store/useActivityStore';
import { useStockStore } from '../../store/useStockStore';
import { TranslateToUrdu } from '../../components/TranslateToUrdu';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon } from '../../components/ui/primitives';
import { rupeesToPaisa } from '../../utils/calculations';
import { persistAttachment } from '../../utils/durableFile';

const PREDEFINED_CATEGORIES = ['Electronics', 'Clothing', 'Groceries', 'Books', 'Hardware', 'Other'];
const PREDEFINED_UNITS = ['kg', 'liter', 'piece', 'dozen', 'meter', 'box', 'carton', 'pack'];

export const AddItemModal = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { addItem } = useStockStore();
  const { logActivity } = useActivityStore();

  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameUr, setNameUr] = useState('');
  
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [lowStockLimit, setLowStockLimit] = useState('5');

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameEn.trim()) e.nameEn = t('stockNameRequired');
    else if (nameEn.length > 100) e.nameEn = t('stockTooLong');

    if (!category.trim()) e.category = t('stockCategoryRequired');
    if (!unit.trim()) e.unit = t('stockUnitRequired');
    else if (unit.length > 20) e.unit = t('stockTooLong');

    if (salePrice.trim()) {
      const sp = parseFloat(salePrice);
      if (isNaN(sp) || sp < 0) e.salePrice = t('stockPriceInvalid');
    }

    if (purchasePrice.trim()) {
      const pp = parseFloat(purchasePrice);
      if (isNaN(pp) || pp < 0) e.purchasePrice = t('stockPriceInvalid');
    }

    if (salePrice.trim() && purchasePrice.trim()) {
      const sp = parseFloat(salePrice);
      const pp = parseFloat(purchasePrice);
      if (!isNaN(sp) && !isNaN(pp) && sp < pp) {
        e.salePrice = t('stockSaleBelowPurchase');
      }
    }

    if (barcode && barcode.length > 50) e.barcode = t('stockTooLong');

    const lsl = parseInt(lowStockLimit, 10);
    if (!lowStockLimit.trim() || isNaN(lsl) || lsl < 0) e.lowStockLimit = t('stockLowStockInvalid');

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0].uri) {
      setPictureUrl(result.assets[0].uri);
    }
  };

  const handleScanBarcode = () => {
    if (!permission?.granted) {
      requestPermission();
    }
    setShowScanner(true);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    setBarcode(data);
    setShowScanner(false);
  };

  const handleSubmit = async () => {
    if (!validate() || !user) {
      return;
    }

    setLoading(true);
    try {
      // Durable copy first — the picker's cache path can vanish (see durableFile.ts).
      const durablePicture = pictureUrl ? await persistAttachment('item', pictureUrl) : undefined;
      await addItem({
        user_id: user.id,
        name_en: nameEn.trim(),
        name_ur: nameUr.trim() || undefined,
        category: category.trim(),
        unit: unit.trim(),
        sale_price: salePrice.trim() ? (rupeesToPaisa(salePrice) ?? 0) : 0,
        purchase_price: purchasePrice.trim() ? (rupeesToPaisa(purchasePrice) ?? 0) : 0,
        barcode: barcode.trim() || undefined,
        picture_url: durablePicture,
        location: 'Not Set',
        low_stock_threshold: parseInt(lowStockLimit, 10),
      });

      // Log Activity
      await logActivity({
        user_id: user.id,
        user_name: user.name || 'User',
        action: 'create',
        entity_type: 'stock',
        description: `added new stock item ${nameEn.trim()}`,
      });
      
      Alert.alert(t('commonSuccess'), t('stockItemSaved'), [
        { text: t('commonOk'), onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      if (__DEV__) console.error(err);
      Alert.alert(t('commonError'), t('commonSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (showScanner) {
    if (!permission?.granted) {
      return (
        <SafeAreaView style={styles.safe}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <Text style={{ fontSize: 16, marginBottom: 20, color: color.textPrimary }}>{t('stockNoCameraAccess')}</Text>
            <TouchableOpacity style={[styles.submitBtn, { width: '100%', marginBottom: 16 }]} onPress={requestPermission}>
              <Text style={styles.submitText}>{t('stockRequestPermission')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.submitBtn, { width: '100%', backgroundColor: color.textSecondary }]} onPress={() => setShowScanner(false)}>
              <Text style={styles.submitText}>{t('commonCancel')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: color.surface }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
        />
        <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20 }}>
          <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color.moneyOut }]} onPress={() => setShowScanner(false)}>
            <Text style={styles.submitText}>{t('stockCancelScan')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('stockAddItemTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.form}>
        {/* Picture Section */}
        <View style={styles.pictureContainer}>
          <TouchableOpacity style={styles.pictureBox} onPress={handlePickImage}>
            {pictureUrl ? (
              <Image source={{ uri: pictureUrl }} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
            ) : (
              <Icon name="package" size={32} tint={color.textMuted} />
            )}
            <View style={styles.cameraIconBtn}>
              <Icon name="camera" size={iconSize.md} tint={color.textInverse} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Item Name EN */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('stockNameEnLabel')} *</Text>
          <TextInput
            style={[styles.input, errors.nameEn ? styles.inputError : null]}
            placeholder={t('stockNameEnPlaceholder')}
            placeholderTextColor={color.textSecondary}
            value={nameEn}
            onChangeText={t => { setNameEn(t); setErrors(p => ({ ...p, nameEn: '' })); }}
            autoFocus
          />
          {!!errors.nameEn && <Text style={styles.errText}>{errors.nameEn}</Text>}
        </View>

        {/* Item Name UR */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('stockNameUrLabel')}</Text>
          <TranslateToUrdu
            value={nameUr}
            onSave={setNameUr}
            placeholder="مثلاً چاول 5 کلو"
          />
        </View>

        {/* Category */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('commonCategory')} *</Text>
          <TextInput
            style={[styles.input, errors.category ? styles.inputError : null, { marginBottom: 8 }]}
            placeholder={t('stockCategoryPlaceholder')}
            placeholderTextColor={color.textSecondary}
            value={category}
            onChangeText={t => { setCategory(t); setErrors(p => ({ ...p, category: '' })); }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {PREDEFINED_CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, category === cat && styles.chipActive]}
                onPress={() => { setCategory(cat); setErrors(p => ({ ...p, category: '' })); }}
              >
                <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{categoryLabel(t, cat)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {!!errors.category && <Text style={styles.errText}>{errors.category}</Text>}
        </View>

        {/* Unit */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('stockUnitLabel')} *</Text>
          <TextInput
            style={[styles.input, errors.unit ? styles.inputError : null, { marginBottom: 8 }]}
            placeholder={t('stockUnitPlaceholder')}
            placeholderTextColor={color.textSecondary}
            value={unit}
            onChangeText={t => { setUnit(t); setErrors(p => ({ ...p, unit: '' })); }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {PREDEFINED_UNITS.map(u => (
              <TouchableOpacity
                key={u}
                style={[styles.chip, unit === u && styles.chipActive]}
                onPress={() => { setUnit(u); setErrors(p => ({ ...p, unit: '' })); }}
              >
                <Text style={[styles.chipText, unit === u && styles.chipTextActive]}>{unitLabel(t, u)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {!!errors.unit && <Text style={styles.errText}>{errors.unit}</Text>}
        </View>

        {/* Purchase Price */}
        <View style={styles.fieldWrap}>
          {/* stock_items carries no currency column, so these prices are the account's own. */}
          <Text style={styles.label}>{t('stockPurchasePriceLabel', { currency: accountCurrencyLabel(user?.defaultCurrency) })}</Text>
          <TextInput
            style={[styles.input, errors.purchasePrice ? styles.inputError : null]}
            placeholder="0.00"
            placeholderTextColor={color.textSecondary}
            value={purchasePrice}
            onChangeText={t => { setPurchasePrice(t); setErrors(p => ({ ...p, purchasePrice: '' })); }}
            keyboardType="decimal-pad"
          />
          {!!errors.purchasePrice && <Text style={styles.errText}>{errors.purchasePrice}</Text>}
        </View>

        {/* Sale Price */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('stockSalePriceLabel', { currency: accountCurrencyLabel(user?.defaultCurrency) })}</Text>
          <TextInput
            style={[styles.input, errors.salePrice ? styles.inputError : null]}
            placeholder="0.00"
            placeholderTextColor={color.textSecondary}
            value={salePrice}
            onChangeText={t => { setSalePrice(t); setErrors(p => ({ ...p, salePrice: '' })); }}
            keyboardType="decimal-pad"
          />
          {!!errors.salePrice && <Text style={styles.errText}>{errors.salePrice}</Text>}
        </View>

        {/* Barcode */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('stockBarcodeLabel')}</Text>
          <View style={styles.barcodeRow}>
            <TextInput
              style={[styles.input, { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }]}
              placeholder={t('stockBarcodePlaceholder')}
              placeholderTextColor={color.textSecondary}
              value={barcode}
              onChangeText={setBarcode}
            />
            <TouchableOpacity style={styles.scannerBtn} onPress={handleScanBarcode}>
              <Icon name="camera" size={iconSize.md} tint={color.textInverse} />
            </TouchableOpacity>
          </View>
          {!!errors.barcode && <Text style={styles.errText}>{errors.barcode}</Text>}
        </View>

        {/* Low Stock Limit */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>{t('stockLowStockLabel')} *</Text>
          <TextInput
            style={[styles.input, errors.lowStockLimit ? styles.inputError : null]}
            placeholder="5"
            placeholderTextColor={color.textSecondary}
            value={lowStockLimit}
            onChangeText={t => { setLowStockLimit(t); setErrors(p => ({ ...p, lowStockLimit: '' })); }}
            keyboardType="number-pad"
          />
          {!!errors.lowStockLimit && <Text style={styles.errText}>{errors.lowStockLimit}</Text>}
        </View>

        {/* Submit Button inside ScreenContainer */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.65 }, { marginTop: 12, marginBottom: 24 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={color.textInverse} />
            : <Text style={styles.submitText}>{t('stockSaveItem')}</Text>
          }
        </TouchableOpacity>
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: 16, height: 56,
    borderBottomWidth: 1, borderBottomColor: color.border,
  },
  backBtn: { width: 40, justifyContent: 'center' },
  backArrow: { fontSize: 24, color: color.textPrimary, fontWeight: '400' },
  headerTitle: { fontSize: 18, fontWeight: '500', color: color.textPrimary },

  form: { padding: 16, paddingBottom: 40 },
  fieldWrap: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', color: color.textPrimary, marginBottom: 6 },

  input: {
    backgroundColor: color.surfaceRaised, borderWidth: 1, borderColor: color.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: color.textPrimary,
  },
  inputError: { borderColor: color.moneyOut },
  errText: { fontSize: 12, color: color.moneyOut, marginTop: 4 },

  chip: {
    backgroundColor: color.surfaceRaised, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 18, marginRight: 8, borderWidth: 1, borderColor: color.border,
  },
  chipActive: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { fontSize: 12, color: color.textSecondary, fontWeight: '500' },
  chipTextActive: { color: color.textPrimary, fontWeight: '500' },

  pictureContainer: { alignSelf: 'center', marginVertical: 16, position: 'relative' },
  pictureBox: {
    width: 120, height: 120, backgroundColor: color.surfaceRaised,
    borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: color.border,
  },
  cameraIconBtn: {
    position: 'absolute', bottom: -6, right: -6,
    backgroundColor: color.accent, width: 40, height: 40,
    borderRadius: 20, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: color.surface
  },

  barcodeRow: { flexDirection: 'row', alignItems: 'center' },
  scannerBtn: {
    backgroundColor: color.accent, paddingHorizontal: 14,
    borderTopRightRadius: 10, borderBottomRightRadius: 10,
    height: 45, justifyContent: 'center'
  },

  submitBtn: {
    backgroundColor: color.accent, borderRadius: 14, height: 50,
    justifyContent: 'center', alignItems: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '500', color: color.textPrimary },
});
