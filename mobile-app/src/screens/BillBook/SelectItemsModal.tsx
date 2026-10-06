import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { categoryLabel } from '../../i18n/categoryLabel';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, Modal, SafeAreaView, ActivityIndicator, Alert
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StockItem } from '../../types/stock.types';
import { color, space, radius, hairline, touchTarget, type as typeScale } from '../../theme/tokens';
import { formatCurrency, rupeesToPaisa } from '../../utils/calculations';
import { todayDate } from '../../utils/dates';

interface CartItem extends StockItem {
  cartQty: number;
}

// A custom line's id always carries this prefix — the save/stock-adjustment code
// downstream uses it to tell "typed on the spot" items apart from real stock rows,
// since a custom item has no stock_items row to deduct from or to link a bill_item's
// item_id to.
const CUSTOM_ITEM_PREFIX = 'custom_';
export const isCustomCartItem = (id: string) => id.startsWith(CUSTOM_ITEM_PREFIX);

interface SelectItemsModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (cart: CartItem[]) => void;
  initialCart: CartItem[];
  stockItems: StockItem[];
  /** The bill being built. Its cart figures are the bill’s, so they read in its currency. */
  currency?: string;
}

export const SelectItemsModal: React.FC<SelectItemsModalProps> = ({
  visible, onClose, onSave, initialCart, stockItems, currency
}) => {
  const { t } = useLanguageStore();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<string[]>(['All']);
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Manual line — works with zero stock items saved, same as typing a description
  // straight into Cash In/Out instead of picking from Stock.
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState('1');
  const [customPrice, setCustomPrice] = useState('');

  useEffect(() => {
    if (visible) {
      setCart([...initialCart]);
      const cats = Array.from(new Set(stockItems.map(i => i.category).filter(Boolean)));
      setCategories(['All', ...cats]);
    }
  }, [visible, initialCart, stockItems]);

  const handleAddCustomItem = () => {
    if (!customName.trim()) {
      Alert.alert(t('commonRequired'), t('selectItemsNameRequired'));
      return;
    }
    const qty = parseFloat(customQty);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert(t('selectItemsQtyInvalidTitle'), t('selectItemsQtyInvalid'));
      return;
    }
    const price = rupeesToPaisa(customPrice);
    if (price === null) {
      Alert.alert(t('selectItemsPriceInvalidTitle'), t('selectItemsPriceInvalid'));
      return;
    }
    const customItem: CartItem = {
      id: `${CUSTOM_ITEM_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user_id: '',
      name_en: customName.trim(),
      category: '',
      unit: 'pcs',
      quantity: 0,
      purchase_price: 0,
      sale_price: price,
      low_stock_threshold: 0,
      created_at: todayDate(),
      synced: 0,
      is_deleted: 0,
      cartQty: qty,
    };
    setCart(prev => [...prev, customItem]);
    setCustomName(''); setCustomQty('1'); setCustomPrice('');
    setShowCustomInput(false);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    setShowScanner(false);
    const item = stockItems.find(i => i.barcode === data);
    if (item) {
      updateCartQty(item, 1);
    } else {
      Alert.alert(t('selectItemsNoBarcodeMatch'));
    }
  };

  const updateCartQty = (item: StockItem, delta: number) => {
    setCart(prev => {
      const exists = prev.find(i => i.id === item.id);
      if (exists) {
        const newQty = Math.max(0, exists.cartQty + delta);
        if (newQty === 0) return prev.filter(i => i.id !== item.id);
        return prev.map(i => i.id === item.id ? { ...i, cartQty: newQty } : i);
      }
      if (delta > 0) {
        return [...prev, { ...item, cartQty: delta }];
      }
      return prev;
    });
  };

  const filteredItems = stockItems.filter(i => {
    const matchesCat = selectedCategory === 'All' || i.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || i.name_en.toLowerCase().includes(q) || (i.barcode && i.barcode.includes(q));
    return matchesCat && matchesSearch;
  });

  const totalAmount = cart.reduce((sum, item) => sum + (item.sale_price * item.cartQty), 0);

  if (showScanner) {
    if (!permission?.granted) {
      return (
        <Modal visible={visible} animationType="slide">
          <SafeAreaView style={styles.safe}>
            <View style={styles.scannerFallback}>
              <Text style={styles.fallbackText}>{t('stockNoCameraAccess')}</Text>
              <TouchableOpacity style={styles.btnGreen} onPress={requestPermission}><Text style={styles.btnText}>{t('stockRequestPermission')}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.btnGray} onPress={() => setShowScanner(false)}><Text style={styles.btnTextBlack}>{t('commonGoBack')}</Text></TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      );
    }
    return (
      <Modal visible={visible} animationType="slide">
        <View style={{ flex: 1, backgroundColor: color.surface }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
          />
          <View style={styles.scannerOverlay}>
            <TouchableOpacity style={styles.btnGray} onPress={() => setShowScanner(false)}>
              <Text style={styles.btnTextBlack}>{t('stockCancelScan')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('selectItemsTitle')}</Text>
          <TouchableOpacity onPress={() => setCart([])} style={[styles.headerBtn, { alignItems: 'flex-end' }]}>
            <Text style={styles.clearText}>{t('commonClear')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('selectItemsSearch')}
            placeholderTextColor={color.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={styles.scanBtn} onPress={() => setShowScanner(true)}>
            <Text style={styles.scanBtnText}>{t('selectItemsScan')}</Text>
          </TouchableOpacity>
        </View>

        {/* Custom line — works with zero stock items saved, same idea as typing a
            description straight into Cash In/Out instead of picking from Stock. */}
        {!showCustomInput ? (
          <TouchableOpacity style={styles.customAddBtn} onPress={() => setShowCustomInput(true)}>
            <Text style={styles.customAddBtnText}>{t('selectItemsAddCustom')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.customForm}>
            <TextInput
              style={styles.customInput}
              placeholder={t('selectItemsNamePlaceholder')}
              placeholderTextColor={color.textMuted}
              value={customName}
              onChangeText={setCustomName}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <TextInput
                style={[styles.customInput, { flex: 1 }]}
                placeholder={t('commonQty')}
                placeholderTextColor={color.textMuted}
                keyboardType="decimal-pad"
                value={customQty}
                onChangeText={setCustomQty}
              />
              <TextInput
                style={[styles.customInput, { flex: 1 }]}
                placeholder={t('selectItemsPricePlaceholder')}
                placeholderTextColor={color.textMuted}
                keyboardType="decimal-pad"
                value={customPrice}
                onChangeText={setCustomPrice}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <TouchableOpacity
                style={styles.customCancelBtn}
                onPress={() => { setShowCustomInput(false); setCustomName(''); setCustomQty('1'); setCustomPrice(''); }}
              >
                <Text style={styles.secondaryBtnText}>{t('commonCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.customConfirmBtn} onPress={handleAddCustomItem}>
                <Text style={styles.primaryBtnText}>{t('selectItemsAddToBill')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Custom lines already added — they aren't stock, so they don't show in
            the browsable list below; this is the only place to see or remove one. */}
        {cart.filter(i => isCustomCartItem(i.id)).length > 0 && (
          <View style={styles.customList}>
            {cart.filter(i => isCustomCartItem(i.id)).map(i => (
              <View key={i.id} style={styles.customListRow}>
                <Text style={styles.customListName} numberOfLines={1}>{i.name_en} × {i.cartQty}</Text>
                <Text style={styles.customListAmount}>{formatCurrency(i.sale_price * i.cartQty, currency)}</Text>
                <TouchableOpacity style={styles.removeBtn} onPress={() => setCart(prev => prev.filter(c => c.id !== i.id))}>
                  <Text style={styles.customListRemove}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={categories}
            keyExtractor={c => c}
            contentContainerStyle={styles.catScroll}
            renderItem={({ item: c }) => (
              <TouchableOpacity 
                style={[styles.catChip, selectedCategory === c && styles.catChipActive]}
                onPress={() => setSelectedCategory(c)}
              >
                <Text style={[styles.catText, selectedCategory === c && styles.catTextActive]}>{c === 'All' ? t('catAll') : categoryLabel(t, c)}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        <FlatList
          data={filteredItems}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: space.md, paddingBottom: 100 }}
          renderItem={({ item }) => {
            const cartItem = cart.find(i => i.id === item.id);
            const qty = cartItem ? cartItem.cartQty : 0;
            return (
              <View style={styles.itemRow}>
                <View style={{ flex: 1, marginRight: space.sm }}>
                  <Text style={styles.itemName}>{item.name_en}</Text>
                  <Text style={styles.itemPrice}>{formatCurrency(item.sale_price)}</Text>
                  <Text style={styles.itemStock}>{t('selectItemsStockLabel')}: {item.quantity}</Text>
                </View>
                
                {qty === 0 ? (
                  <TouchableOpacity style={styles.addBtn} onPress={() => updateCartQty(item, 1)}>
                    <Text style={styles.addBtnText}>{t('selectItemsAdd')}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.qtyControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => updateCartQty(item, -1)}>
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{qty}</Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => updateCartQty(item, 1)}>
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />

        <View style={styles.bottomBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bottomTotalItems}>{t('selectItemsCount', { count: cart.reduce((s, i) => s + i.cartQty, 0) })}</Text>
            <Text style={styles.bottomTotalAmount}>{formatCurrency(totalAmount, currency)}</Text>
          </View>
          <TouchableOpacity style={styles.doneBtn} onPress={() => onSave(cart)}>
            <Text style={styles.doneBtnText}>{t('commonDone')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, height: 56, borderBottomWidth: hairline, borderBottomColor: color.border, backgroundColor: color.surface
  },
  headerBtn: { minWidth: touchTarget, height: touchTarget, justifyContent: 'center' },
  backIcon: { fontSize: 28, color: color.textPrimary },
  headerTitle: { ...typeScale.heading, color: color.textPrimary, flex: 1, textAlign: 'center' },
  clearText: { ...typeScale.bodyMedium, color: color.moneyOut },

  searchRow: { flexDirection: 'row', padding: space.md, gap: space.sm, alignItems: 'center', backgroundColor: color.surface },
  searchInput: {
    flex: 1, backgroundColor: color.surfaceRaised, minHeight: 48, borderRadius: radius.md,
    paddingHorizontal: space.lg, borderWidth: hairline, borderColor: color.border, fontSize: 15, color: color.textPrimary
  },
  scanBtn: {
    minWidth: 48, height: 48, paddingHorizontal: space.md, backgroundColor: color.surface, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.borderStrong, justifyContent: 'center', alignItems: 'center'
  },
  scanBtnText: { ...typeScale.label, fontWeight: '500', color: color.accent },

  customAddBtn: {
    marginHorizontal: space.md, marginBottom: space.sm, minHeight: touchTarget, justifyContent: 'center',
    paddingHorizontal: space.md, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.accent, borderStyle: 'dashed', alignItems: 'center',
  },
  customAddBtnText: { ...typeScale.label, fontWeight: '500', color: color.accent, textAlign: 'center' },
  customForm: {
    marginHorizontal: space.md, marginBottom: space.sm, padding: space.md, borderRadius: radius.md,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border, gap: space.sm,
  },
  customInput: {
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: touchTarget, fontSize: 14, color: color.textPrimary,
  },
  customCancelBtn: {
    flex: 1, backgroundColor: color.surface, minHeight: touchTarget, borderRadius: radius.sm,
    borderWidth: hairline, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center',
  },
  customConfirmBtn: {
    flex: 1, backgroundColor: color.accent, minHeight: touchTarget, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textInverse },
  secondaryBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  customList: { marginHorizontal: space.md, marginBottom: space.sm, gap: 6 },
  customListRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, paddingLeft: space.md,
  },
  customListName: { flex: 1, ...typeScale.label, fontWeight: '500', color: color.textPrimary },
  customListAmount: { ...typeScale.label, fontWeight: '500', color: color.textPrimary, flexShrink: 0 },
  removeBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  customListRemove: { fontSize: 20, color: color.moneyOut },

  catScroll: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm, backgroundColor: color.surface },
  catChip: {
    paddingHorizontal: space.lg, minHeight: 36, justifyContent: 'center', borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
  },
  catChipActive: { backgroundColor: color.accent, borderColor: color.accent },
  catText: { ...typeScale.label, color: color.textSecondary },
  catTextActive: { color: color.textInverse, fontWeight: '500' },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, padding: space.md, marginBottom: space.sm, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.border
  },
  itemName: { ...typeScale.bodyMedium, color: color.textPrimary },
  itemPrice: { ...typeScale.bodyMedium, color: color.textPrimary, marginTop: space.xs },
  itemStock: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },

  addBtn: {
    paddingHorizontal: space.lg, minHeight: touchTarget, justifyContent: 'center', borderRadius: radius.sm,
    borderWidth: hairline, borderColor: color.accent, backgroundColor: color.surface
  },
  addBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.accent },

  qtyControls: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceRaised, borderRadius: radius.sm,
    borderWidth: hairline, borderColor: color.border,
  },
  qtyBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { fontSize: 20, color: color.accent },
  qtyText: { minWidth: 32, textAlign: 'center', ...typeScale.bodyMedium, color: color.textPrimary },

  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md,
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: color.surface, padding: space.lg, borderTopWidth: hairline, borderTopColor: color.border,
    paddingBottom: 28,
  },
  bottomTotalItems: { ...typeScale.label, color: color.textSecondary },
  bottomTotalAmount: { ...typeScale.title, color: color.textPrimary, marginTop: 2 },
  doneBtn: {
    backgroundColor: color.accent, paddingHorizontal: space.xxl, minHeight: touchTarget,
    justifyContent: 'center', borderRadius: radius.md, flexShrink: 0,
  },
  doneBtnText: { ...typeScale.bodyMedium, color: color.textInverse },

  scannerOverlay: { position: 'absolute', bottom: 40, left: space.xl, right: space.xl },
  scannerFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.lg },
  fallbackText: { ...typeScale.body, fontSize: 16, color: color.textPrimary },
  btnGray: {
    backgroundColor: color.surface, minHeight: 50, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: space.xxl, borderWidth: hairline, borderColor: color.borderStrong,
  },
  btnGreen: { backgroundColor: color.accent, minHeight: 50, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.xxl },
  btnText: { ...typeScale.bodyMedium, fontSize: 16, color: color.textInverse },
  btnTextBlack: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
});
