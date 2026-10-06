import React, { useState, useCallback } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/usePurchaseStore';
import { useSupplierStore } from '../../store/useSupplierStore';
import { getStockItemsByUserId } from '../../services/database/stockDb';
import { PurchaseOrderItem } from '../../types/purchase.types';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Icon, AmountText, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { formatCurrency, rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';
import { CurrencyPicker } from '../../components/ui/CurrencyPicker';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';

interface CartItem extends Omit<PurchaseOrderItem, 'id' | 'po_id' | 'received_qty' | 'is_deleted'> {
  tempId: string;
}

export const CreatePurchaseOrderModal = ({ navigation, route }: any) => {
  const initSupplierId = route?.params?.supplierId;
  const initSupplierName = route?.params?.supplierName;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { createOrder } = usePurchaseStore();
  // Opens on the account default EVERY time — never the last currency used.
  const accountCurrency = resolveCurrency(user?.defaultCurrency).code;
  const [currency, setCurrency] = useState<CurrencyCode>(accountCurrency);
  const { suppliers, loadSuppliers } = useSupplierStore();

  const [supplierId, setSupplierId] = useState(initSupplierId ?? '');
  const [supplierName, setSupplierName] = useState(initSupplierName ?? '');
  const [orderDate, setOrderDate] = useState(todayDate());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Stock search
  const [stockSearch, setStockSearch] = useState('');
  const [stockResults, setStockResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState(!initSupplierId);

  // Load suppliers if not initialized
  React.useEffect(() => {
    if (user?.id && suppliers.length === 0) loadSuppliers(user.id);
  }, [user?.id]);

  const searchStock = useCallback(async (q: string) => {
    setStockSearch(q);
    if (!q.trim() || !user?.id) { setStockResults([]); return; }
    setSearchLoading(true);
    try {
      const items = await getStockItemsByUserId(user.id);
      setStockResults(items.filter(i => i.name_en?.toLowerCase().includes(q.toLowerCase())).slice(0, 8));
    } catch { setStockResults([]); }
    finally { setSearchLoading(false); }
  }, [user?.id]);

  const addToCart = (item: any) => {
    const existing = cart.find(c => c.stock_item_id === item.id);
    if (existing) {
      setCart(prev => prev.map(c => c.tempId === existing.tempId
        ? { ...c, quantity: c.quantity + 1, line_total: (c.quantity + 1) * c.unit_cost }
        : c));
    } else {
      const cost = item.purchase_price ?? item.selling_price ?? 0;
      setCart(prev => [...prev, {
        tempId: `tmp_${Date.now()}`,
        stock_item_id: item.id,
        item_name: item.name_en,
        quantity: 1,
        unit_cost: cost,
        line_total: cost,
      }]);
    }
    setStockSearch('');
    setStockResults([]);
  };

  const updateQty = (tempId: string, qty: number) => {
    if (qty <= 0) { removeItem(tempId); return; }
    setCart(prev => prev.map(c => c.tempId === tempId
      ? { ...c, quantity: qty, line_total: qty * c.unit_cost }
      : c));
  };

  const updateCost = (tempId: string, cost: number) => {
    setCart(prev => prev.map(c => c.tempId === tempId
      ? { ...c, unit_cost: cost, line_total: c.quantity * cost }
      : c));
  };

  const removeItem = (tempId: string) => setCart(prev => prev.filter(c => c.tempId !== tempId));

  const total = cart.reduce((s, i) => s + i.line_total, 0);

  const handleSubmit = async () => {
    if (!supplierId) { Alert.alert(t('commonError'), t('poSelectSupplier')); return; }
    if (cart.length === 0) { Alert.alert(t('commonError'), t('poAddOneItem')); return; }
    if (!user) return;
    setLoading(true);
    try {
      const items = cart.map(({ tempId, ...item }) => item);
      const po = await createOrder(user.id, supplierId, items, orderDate, expectedDate || undefined, notes || undefined, currency);
      Alert.alert(t('poCreatedTitle'), t('poCreatedBody', { no: String(po.po_number).padStart(4, '0') }), [
        { text: 'View', onPress: () => { navigation.goBack(); navigation.navigate('PurchaseOrderDetail', { orderId: po.id }); } },
        { text: 'Done', onPress: () => navigation.goBack() }
      ]);
    } catch (e) {
      Alert.alert(t('commonError'), t('poCreateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('poCreateTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.form}>

          {/* Supplier */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('poSupplier')} *</Text>
            {supplierId && !showSupplierPicker ? (
              <TouchableOpacity style={styles.selectedSupplier} onPress={() => setShowSupplierPicker(true)}>
                <Text style={styles.selectedSupplierName} numberOfLines={1}>{supplierName}</Text>
                <Text style={styles.changeText}>{t('poChange')}</Text>
              </TouchableOpacity>
            ) : (
              <View>
                {suppliers.map(s => (
                  <TouchableOpacity key={s.id} style={styles.supplierOption}
                    onPress={() => { setSupplierId(s.id); setSupplierName(s.name); setShowSupplierPicker(false); }}
                  >
                    <Text style={styles.supplierOptName}>{s.name}</Text>
                    {s.business_name && <Text style={styles.supplierOptBiz}>{s.business_name}</Text>}
                  </TouchableOpacity>
                ))}
                {suppliers.length === 0 && (
                  <TouchableOpacity style={styles.addSupplierHint} onPress={() => navigation.navigate('AddSupplierModal')}>
                    <Icon name="plus" size={iconSize.sm} tint={color.accent} />
                    <Text style={styles.addSupplierHintText}>{t('poAddSupplierFirst')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Dates */}
          <View style={styles.row2col}>
            <View style={[styles.section, styles.col]}>
              <Text style={styles.label}>{t('poOrderDate')}</Text>
              <DateField style={styles.input} value={orderDate} onChange={setOrderDate} />
            </View>
            <View style={[styles.section, styles.col]}>
              <Text style={styles.label}>{t('poExpectedDate')}</Text>
              <DateField style={styles.input} value={expectedDate} onChange={setExpectedDate} placeholder={t('poOptional')} />
            </View>
          </View>

          {/* Item Search */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('poAddItems')}</Text>
            <View style={styles.searchBox}>
              <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('poSearchStock')}
                value={stockSearch}
                onChangeText={searchStock}
                placeholderTextColor={color.textMuted}
              />
            </View>
            {searchLoading && <ActivityIndicator size="small" color={color.accent} style={styles.spinner} />}
            {stockResults.map(item => (
              <TouchableOpacity key={item.id} style={styles.stockResult} onPress={() => addToCart(item)}>
                <Text style={styles.stockResultName}>{item.name_en}</Text>
                <Text style={styles.stockResultDetail}>Stock: {item.quantity} · Cost: {item.purchase_price != null ? formatCurrency(item.purchase_price) : '—'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Cart */}
          {cart.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.label}>Order items ({cart.length})</Text>
              {cart.map(item => (
                <View key={item.tempId} style={styles.cartItem}>
                  <Text style={styles.cartItemName} numberOfLines={1}>{item.item_name}</Text>
                  <View style={styles.cartItemControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.tempId, item.quantity - 1)} accessibilityLabel={t('poLess')}>
                      <Icon name="minus" size={iconSize.sm} tint={color.accent} />
                    </TouchableOpacity>
                    <Text style={styles.qtyVal}>{item.quantity}</Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.tempId, item.quantity + 1)} accessibilityLabel={t('poMore')}>
                      <Icon name="plus" size={iconSize.sm} tint={color.accent} />
                    </TouchableOpacity>
                    <Text style={styles.cartX}>×</Text>
                    <TextInput
                      style={styles.costInput}
                      value={paisaToRupeesString(item.unit_cost)}
                      onChangeText={v => updateCost(item.tempId, rupeesToPaisa(v) ?? 0)}
                      keyboardType="decimal-pad"
                      placeholderTextColor={color.textMuted}
                    />
                    <TouchableOpacity onPress={() => removeItem(item.tempId)} style={styles.removeBtn} accessibilityLabel={t('poRemoveItem')}>
                      <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  {/* line_total is paisa: formatted once, never printed raw. */}
                  <View style={styles.lineTotalRow}>
                    <AmountText currency={currency} paisa={item.line_total} size="label" />
                  </View>
                </View>
              ))}
              {/* The currency sits WITH the figure it applies to, the same place the
                  expense amount box puts it — pick it before the amount reads right. */}
              <View style={[styles.totalRow, styles.totalRowGrand]}>
                <Text style={styles.totalLabelGrand}>{t('poOrderTotal')}</Text>
                <CurrencyPicker value={currency} onChange={setCurrency} />
                <AmountText paisa={total} currency={currency} />
              </View>
              <Text style={styles.currencyHint}>{t('currencyEntryHint')}</Text>
            </View>
          )}


          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('poNotesLabel')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes} onChangeText={setNotes}
              placeholder={t('poNotesPlaceholder')}
              placeholderTextColor={color.textMuted}
              multiline numberOfLines={3}
            />
          </View>

          <Button label={t('poCreate')} icon="package" onPress={handleSubmit} loading={loading} disabled={loading} fullWidth style={styles.submitBtn} />
        </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  form: { padding: space.lg, paddingBottom: 40 },
  section: {
    backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  currencyHint: { ...typeScale.caption, color: color.textMuted, marginTop: space.xs },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, paddingVertical: space.sm,
    ...typeScale.body, color: color.textPrimary,
  },
  notesInput: { minHeight: 70, textAlignVertical: 'top' },
  row2col: { flexDirection: 'row', gap: space.md },
  col: { flex: 1 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget,
  },
  searchInput: { ...typeScale.body, flex: 1, color: color.textPrimary, paddingVertical: space.sm },
  spinner: { marginTop: space.sm },
  selectedSupplier: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    minHeight: touchTarget, paddingHorizontal: space.md, paddingVertical: space.sm,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md, borderWidth: hairline, borderColor: color.border,
  },
  selectedSupplierName: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  changeText: { ...typeScale.label, color: color.accent },
  supplierOption: {
    minHeight: touchTarget, padding: space.md, borderRadius: radius.md, borderWidth: hairline,
    borderColor: color.borderStrong, marginBottom: space.sm, backgroundColor: color.surface,
  },
  supplierOptName: { ...typeScale.bodyMedium, color: color.textPrimary },
  supplierOptBiz: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  addSupplierHint: { minHeight: touchTarget, flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center' },
  addSupplierHintText: { ...typeScale.bodyMedium, color: color.accent },
  stockResult: { minHeight: touchTarget, paddingVertical: space.sm, borderBottomWidth: hairline, borderBottomColor: color.border, justifyContent: 'center' },
  stockResultName: { ...typeScale.bodyMedium, color: color.textPrimary },
  stockResultDetail: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  cartItem: { paddingVertical: space.md, borderBottomWidth: hairline, borderBottomColor: color.border },
  cartItemName: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.sm },
  cartItemControls: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  qtyBtn: {
    width: touchTarget, height: touchTarget, backgroundColor: color.surface, borderWidth: hairline,
    borderColor: color.borderStrong, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center',
  },
  qtyVal: { ...typeScale.bodyMedium, minWidth: 36, textAlign: 'center', color: color.textPrimary },
  cartX: { ...typeScale.label, color: color.textSecondary, marginHorizontal: space.xs },
  costInput: {
    minWidth: 80, backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, paddingHorizontal: space.sm, minHeight: touchTarget, ...typeScale.body, textAlign: 'center', color: color.textPrimary,
  },
  removeBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  lineTotalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: space.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  totalRowGrand: { paddingTop: space.md, marginTop: space.xs, borderTopWidth: hairline, borderTopColor: color.border },
  totalLabel: { ...typeScale.body, color: color.textSecondary, flex: 1 },
  totalLabelGrand: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  inlineInput: {
    minWidth: 90, backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.sm, paddingHorizontal: space.sm, minHeight: touchTarget, ...typeScale.body, textAlign: 'right', color: color.textPrimary,
  },
  submitBtn: { minHeight: 52, marginTop: space.sm },
});
