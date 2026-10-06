import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, FlatList
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import { useBillStore } from '../../store/useBillStore';
import { getStockItemsByUserId, addStockMovement } from '../../services/database/stockDb';
import { searchCustomers, addCustomer, matchCustomerByName, CustomerCursor } from '../../services/database/customerDb';
import { StockItem } from '../../types/stock.types';
import { Customer } from '../../services/database/customerDb';
import { SelectItemsModal, isCustomCartItem } from './SelectItemsModal';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { AmountText } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, type as typeScale } from '../../theme/tokens';
import { formatCurrency, rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { getBillForEdit, BillEditLine, WALK_IN_CUSTOMER_ID } from '../../services/database/billDb';
import { persistAttachment } from '../../utils/durableFile';
import { DateField } from '../../components/ui/DateField';
import { todayDate, formatDisplayDate } from '../../utils/dates';
import { CurrencyPicker } from '../../components/ui/CurrencyPicker';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';

interface CartItem extends StockItem {
  cartQty: number;
  /** Editing: the existing bill_items row this cart line came from (absent = a new line). */
  billItemId?: string;
  /** Editing: the stock item behind a line whose cart id is not the stock id. */
  stockItemId?: string | null;
}

export const CreateNewBillModal = ({ navigation, route }: any) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { addBill, editBill } = useBillStore();
  // Opens on the account default EVERY time — never the last currency used. A rupee
  // bill accidentally saved in another currency is a costly mistake.
  const accountCurrency = resolveCurrency(user?.defaultCurrency).code;
  const [currency, setCurrency] = useState<CurrencyCode>(accountCurrency);
  // Opened from Bill Details → Edit: this exact bill is loaded and saved IN PLACE.
  const editBillId: string | undefined = route?.params?.billId;
  const isEdit = !!editBillId;

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerCursor, setCustomerCursor] = useState<CustomerCursor | null>(null);
  const [customerLoadingMore, setCustomerLoadingMore] = useState(false);
  
  // Form State
  const { t } = useLanguageStore();
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayDate());
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // Typed directly, like the description field on Cash In/Out — works with zero
  // saved customers. Picking a saved one from the list below just fills this in.
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [manualAmount, setManualAmount] = useState('');

  const [partialPaid, setPartialPaid] = useState(0);
  // What the customer paid now, in rupees as typed. Empty = nothing paid, which is
  // how every bill behaved before this field existed.
  const [paidAmount, setPaidAmount] = useState('');
  const [loadingBill, setLoadingBill] = useState(isEdit);
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  
  // Modals & UI State
  const [loading, setLoading] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);

  // Quick Party Creation State
  const [showAddPartyInput, setShowAddPartyInput] = useState(false);
  const [newPartyName, setNewPartyName] = useState('');
  const [newPartyPhone, setNewPartyPhone] = useState('');
  const [creatingParty, setCreatingParty] = useState(false);

  // Picker search: SQL, bounded — typing narrows by query, not by filtering an array.
  useEffect(() => {
    let active = true;
    if (!user?.id || !showCustomerModal) return;
    searchCustomers(user.id, customerQuery, 50)
      .then(page => { if (active) { setCustomers(page.rows); setCustomerCursor(page.nextCursor); } })
      .catch(e => { if (__DEV__) console.error('[CreateBill] customer search failed:', e); });
    return () => { active = false; };
  }, [user?.id, customerQuery, showCustomerModal]);

  const loadMoreCustomers = async () => {
    if (!user?.id || !customerCursor || customerLoadingMore) return;
    setCustomerLoadingMore(true);
    try {
      const page = await searchCustomers(user.id, customerQuery, 50, customerCursor);
      setCustomers(prev => [...prev, ...page.rows]);
      setCustomerCursor(page.nextCursor);
    } catch (e) {
      if (__DEV__) console.error('[CreateBill] customer page failed:', e);
    } finally {
      setCustomerLoadingMore(false);
    }
  };

  const handleCreateNewParty = async () => {
    if (!newPartyName.trim() || !user?.id) {
      Alert.alert(t('commonRequired'), t('billPartyRequired'));
      return;
    }
    setCreatingParty(true);
    try {
      // Mid-bill quick add stays lean (name + phone); the rest can be filled in later
      // from the Customer Book. customers has no current_balance column — passing it
      // made this INSERT fail, so the button never actually created anyone.
      const created = await addCustomer({
        user_id: user.id,
        name: newPartyName,
        phone: newPartyPhone,
      });
      setCustomers(prev => [created, ...prev]);
      setSelectedCustomer(created);
      setCustomerName(created.name);
      setNewPartyName('');
      setNewPartyPhone('');
      setShowAddPartyInput(false);
      setShowCustomerModal(false);
    } catch (err: any) {
      Alert.alert(t('commonError'), err?.message || t('billPartyFailed'));
    } finally {
      setCreatingParty(false);
    }
  };
  
  useEffect(() => {
    if (user?.id) {
      loadData(user.id).then(items => { if (isEdit) loadBillForEdit(items); });
    }
  }, [user?.id]);

  /** Fills the form from the bill being edited — fresh from the database, not the list. */
  const loadBillForEdit = async (items: StockItem[]) => {
    try {
      const bill = editBillId ? await getBillForEdit(editBillId) : null;
      if (!bill) {
        Alert.alert(t('billNotFound'), t('billNoLongerExists'));
        navigation.goBack();
        return;
      }
      if (bill.user_id !== user?.id) {
        Alert.alert(t('billNotYours'), t('billOnlyOwn'));
        navigation.goBack();
        return;
      }
      setBillNumber(String(bill.bill_no));
      setBillDate(bill.bill_date);
      const walkIn = !bill.customer_id || bill.customer_id === WALK_IN_CUSTOMER_ID;
      setCustomerName(walkIn && bill.party_name === 'Walk-in Customer' ? '' : bill.party_name);
      if (!walkIn) setSelectedCustomer({ id: bill.customer_id, name: bill.party_name, phone: bill.party_phone } as Customer);
      setNotes(bill.notes || '');
      setAttachments(Array.isArray(bill.attachment_urls) ? bill.attachment_urls : []);
      const lines = bill.items || [];
      if (lines.length === 0) setManualAmount(paisaToRupeesString(bill.total));
      // A stock line keeps its stock item's id as its cart id (so the picker's +/− edit it);
      // a custom line, a repeat of the same item, or an item no longer in stock gets a
      // custom id and shows in the picker's own-lines list, where it can be removed.
      const used = new Set<string>();
      setCart(lines.map(l => {
        const stock = l.item_id ? items.find(i => i.id === l.item_id) : undefined;
        const ownId = !!stock && !used.has(stock.id);
        if (ownId) used.add(stock!.id);
        return {
          ...(stock || {
            user_id: '', category: '', unit: 'pcs', quantity: 0, purchase_price: 0,
            low_stock_threshold: 0, created_at: todayDate(), synced: 0, is_deleted: 0,
          }),
          id: ownId ? stock!.id : `custom_edit_${l.id}`,
          name_en: l.item_name,
          sale_price: l.unit_price,   // the bill's own price, not today's stock price
          cartQty: l.quantity,
          billItemId: l.id,
          stockItemId: l.item_id ?? null,
        } as CartItem;
      }));
      setPartialPaid(bill.paid || 0);
      setPaidAmount(bill.paid ? paisaToRupeesString(bill.paid) : '');
    } catch (e: any) {
      Alert.alert(t('commonError'), e?.message || t('billLoadFailed'));
      navigation.goBack();
    } finally {
      setLoadingBill(false);
    }
  };

  const loadData = async (userId: string): Promise<StockItem[]> => {
    let items: StockItem[] = [];
    try {
      items = await getStockItemsByUserId(userId);
      setStockItems(items);
      // Customers: first page only; the picker's search box narrows via SQL.
      const page = await searchCustomers(userId, '', 50);
      setCustomers(page.rows);
      setCustomerCursor(page.nextCursor);
    } catch (e) {
      if (__DEV__) console.error(e);
    }
    return items;
  };

  // Calculations
  const subtotal = cart.reduce((sum, i) => sum + (i.sale_price * i.cartQty), 0);
  
  // Paid: blank means nothing paid. It can never be more than the bill itself.
  const paidPaisa = paidAmount.trim() ? (rupeesToPaisa(paidAmount) ?? 0) : 0;
  const calculatedTotal = subtotal > 0 
    ? subtotal
    : (rupeesToPaisa(manualAmount) ?? 0);

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.[0]) {
      const uri = result.assets[0].uri;
      setAttachments(prev => [...prev, uri]);
    }
  };

  /**
   * True to go ahead with the save.
   *
   * Only asks when a name was TYPED (nothing picked from the saved list) and no live
   * customer carries it. Until now such a bill was filed under the walk-in sentinel
   * without a word, so it never appeared in anyone's khata and the shopkeeper had no
   * way to notice. A picked customer, an empty name (a deliberate walk-in) and a name
   * that already matches one customer all save without a question.
   */
  const confirmIfBrandNewCustomer = async (): Promise<boolean> => {
    const typed = customerName.trim();
    if (selectedCustomer || !typed || !user) return true;

    let matches: number;
    try {
      ({ matches } = await matchCustomerByName(user.id, typed));
    } catch (e) {
      // A lookup failure must never block a sale: fall through and save it exactly as
      // this form would have saved it before the check existed.
      if (__DEV__) console.error('[CreateBill] customer name lookup failed:', e);
      return true;
    }
    if (matches > 0) return true;

    return new Promise<boolean>(resolve => {
      Alert.alert(
        t('billNewCustomerTitle'),
        t('billNewCustomerBody', { name: typed }),
        [
          { text: t('commonCancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('billNewCustomerSave'), onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
  };

  const handleSave = async () => {
    if (!user) return;

    // Before the spinner, and before any durable copies are written: cancelling here
    // must leave nothing behind.
    if (!(await confirmIfBrandNewCustomer())) return;

    setLoading(true);

    try {
      // Durable copies first — the picker's cache paths can vanish (see durableFile.ts).
      const durableAttachments: string[] = [];
      for (const a of attachments) durableAttachments.push(await persistAttachment('bill', a));

      if (isEdit && editBillId) {
        const lines: BillEditLine[] = cart.map(i => ({
          billItemId: i.billItemId,
          item_id: i.stockItemId !== undefined ? i.stockItemId : (isCustomCartItem(i.id) ? null : i.id),
          item_name: i.name_en,
          quantity: i.cartQty,
          unit_price: i.sale_price,
        }));
        const { inActiveFilter } = await editBill(editBillId, user.id, {
          bill_no: parseInt(billNumber) || undefined,
          customer_id: selectedCustomer?.id || WALK_IN_CUSTOMER_ID,
          party_name: selectedCustomer?.name || customerName.trim() || 'Walk-in Customer',
          party_phone: selectedCustomer?.phone || null,
          bill_date: billDate,
          notes: notes.trim() || null,
          attachment_urls: durableAttachments,
          manualTotal: cart.length === 0 ? calculatedTotal : undefined,
          paid: paidPaisa,
          lines,
        });
        Alert.alert(
          t('commonSaved'),
          inActiveFilter
            ? t('billUpdated')
            : t('billOutsideFilter', { message: t('billUpdated'), date: formatDisplayDate(billDate) })
        );
        navigation.goBack();
        return;
      }

      const newBill = {
        user_id: user.id,
        bill_no: parseInt(billNumber) || undefined,
        customer_id: selectedCustomer?.id || WALK_IN_CUSTOMER_ID,
        party_name: selectedCustomer?.name || customerName.trim() || 'Walk-in Customer',
        party_phone: selectedCustomer?.phone || undefined,
        bill_date: billDate,
        subtotal: subtotal > 0 ? subtotal : calculatedTotal,
        discount_pct: 0,
        discount_amount: 0,
        tax_amount: 0,
        total: calculatedTotal,
        currency,
        // The data layer derives due and the status from this.
        paid: paidPaisa,
        payment_method: 'cash',
        is_draft: 0 as const,
        is_hold: 0 as const,
        notes: notes.trim() || undefined,
        attachment_urls: durableAttachments.length > 0 ? durableAttachments : undefined,
      };

      // A custom line (typed on the spot, no matching stock_items row) has no real
      // item_id to reference and nothing to deduct from stock. null, not undefined —
      // the write path binds values straight into the SQL params with no undefined→null
      // normalization, and expo-sqlite rejects an undefined bound parameter outright.
      const billItems = cart.map(i => ({
        item_id: isCustomCartItem(i.id) ? null : i.id,
        item_name: i.name_en,
        quantity: i.cartQty,
        unit_price: i.sale_price,
        line_total: i.cartQty * i.sale_price
      }));

      const { inActiveFilter } = await addBill(newBill as any, billItems as any);

      // Adjust Stock — only for real stock items in the cart.
      for (const i of cart) {
        if (isCustomCartItem(i.id)) continue;
        await addStockMovement({
          item_id: i.id,
          change: -i.cartQty,
          reason: 'sale',
          date: todayDate(),
          cost_per_unit: i.purchase_price,
          sale_price_unit: i.sale_price,
          user_id: user.id,
          note: 'POS Sale'
        });
      }

      // The bill is saved either way. If it falls outside the range the Bill Book is
      // currently showing, say so rather than letting it look like it vanished.
      Alert.alert(
        t('commonSuccess'),
        inActiveFilter
          ? t('billCreated')
          : t('billOutsideFilter', { message: t('billCreated'), date: formatDisplayDate(billDate) })
      );
      navigation.goBack();
    } catch (e: any) {
      if (__DEV__) console.error(e);
      // An edit can be refused for a reason the author must see (e.g. returned items).
      Alert.alert(t('commonError'), isEdit && e?.message ? e.message : t('commonSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t(isEdit ? 'billEditTitle' : 'billCreateTitle')}</Text>
        <View style={{ width: touchTarget }} />
      </View>

      {/* Main Card Content */}
      <ScreenContainer scrollable={true} hasTabBar={true} style={styles.cardContainer} contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
        {/* Row 1: Bill Number & Date */}
        <View style={styles.row}>
          <View style={styles.inputWrap}>
            <View style={styles.floatingLabel}><Text style={styles.labelText}>{t('billNumberLabel')}</Text></View>
            <TextInput
              style={styles.input}
              value={billNumber}
              onChangeText={setBillNumber}
              placeholder={t('billNumberAuto')}
              placeholderTextColor={color.textMuted}
              keyboardType="numeric"
            />
          </View>
          <View style={{ width: space.lg }} />
          <View style={styles.inputWrap}>
            <View style={styles.floatingLabel}><Text style={styles.labelText}>{t('commonDate')}</Text></View>
            <DateField style={styles.input} value={billDate} onChange={setBillDate} />
          </View>
        </View>

        {/* Customer — type a name directly, same as the description field on
            Cash In/Out; the picker button only shows up once there's something
            saved to pick from. */}
        <View style={styles.fieldRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={t('billCustomerPlaceholder')}
            placeholderTextColor={color.textMuted}
            value={customerName}
            onChangeText={t => {
              setCustomerName(t);
              if (selectedCustomer && t !== selectedCustomer.name) setSelectedCustomer(null);
            }}
          />
          {customers.length > 0 && (
            <TouchableOpacity style={styles.pickBtn} onPress={() => setShowCustomerModal(true)}>
              <Text style={styles.pickBtnText}>{t('billPickSaved')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Add Items */}
        <TouchableOpacity style={styles.actionRow} onPress={() => setShowItemsModal(true)}>
          <Text style={styles.actionText} numberOfLines={1}>{cart.length > 0 ? `${cart.reduce((s,i)=>s+i.cartQty,0)} items added (${formatCurrency(subtotal, currency)})` : '+ Add items'}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Invoice Amount */}
        {/* The currency sits WITH the amount, the same place the expense box puts it. */}
        <View style={styles.invoiceRow}>
          <Text style={styles.invoiceLabel}>{t('billInvoiceAmount')}</Text>
          <CurrencyPicker value={currency} onChange={setCurrency} />
          <TextInput
            style={[styles.input, styles.invoiceInput]}
            placeholder="0.00"
            placeholderTextColor={color.textMuted}
            keyboardType="numeric"
            value={cart.length > 0 ? paisaToRupeesString(calculatedTotal) : manualAmount}
            onChangeText={setManualAmount}
            editable={cart.length === 0}
          />
        </View>
        <Text style={styles.currencyHint}>{t('currencyEntryHint')}</Text>

        {/* Amount paid — optional. Leave it empty and the bill is simply unpaid. */}
        <View style={styles.invoiceRow}>
          <Text style={styles.invoiceLabel}>{t('billAmountPaid')}</Text>
          <TextInput
            style={[styles.input, styles.invoiceInput]}
            placeholder="0.00"
            placeholderTextColor={color.textMuted}
            keyboardType="decimal-pad"
            value={paidAmount}
            onChangeText={setPaidAmount}
          />
        </View>

        {/* Due follows the figures: total − paid. Red, because it is owed to the shop. */}
        {calculatedTotal > 0 && (
          <View style={styles.dueRow}>
            <Text style={styles.invoiceLabel}>{t('billBalanceDue')}</Text>
            <AmountText paisa={Math.max(0, calculatedTotal - paidPaisa)} tone={calculatedTotal - paidPaisa > 0 ? 'out' : 'neutral'} size="label" currency={currency} />
          </View>
        )}

        {/* Details / Notes */}
        <TextInput
          style={styles.textArea}
          placeholder={t('billNotesPlaceholder')}
          placeholderTextColor={color.textMuted}
          multiline
          numberOfLines={4}
          value={notes}
          onChangeText={setNotes}
        />

        {/* Attach Photos & PDF */}
        <TouchableOpacity style={styles.actionRow} onPress={pickImage}>
          <Text style={attachments.length > 0 ? styles.actionText : styles.actionTextGray} numberOfLines={1}>
            {attachments.length > 0 ? t('billPhotosAttached', { count: attachments.length }) : t('billAttachPhotos')}
          </Text>
        </TouchableOpacity>

        {attachments.length > 0 && (
          <TouchableOpacity onPress={() => setAttachments([])} style={styles.clearPhotosBtn}>
            <Text style={styles.clearPhotosText}>{t('billClearPhotos')}</Text>
          </TouchableOpacity>
        )}

        {/* Save button inside ScreenContainer */}
        <TouchableOpacity
          style={[
            styles.saveBtn,
            (!calculatedTotal || calculatedTotal <= 0 || loading || loadingBill) ? styles.saveBtnDisabled : null,
            { marginTop: space.md }
          ]}
          onPress={handleSave}
          disabled={!calculatedTotal || calculatedTotal <= 0 || loading || loadingBill}
        >
          {loading ? <ActivityIndicator color={color.textInverse} /> : <Text style={styles.saveBtnText}>{t(isEdit ? 'commonSaveChanges' : 'billSave')}</Text>}
        </TouchableOpacity>
      </ScreenContainer>

      {/* Select Items Modal */}
      <SelectItemsModal
        visible={showItemsModal}
        onClose={() => setShowItemsModal(false)}
        stockItems={stockItems}
        currency={currency}
        initialCart={cart}
        onSave={(newCart) => {
          setCart(newCart);
          setShowItemsModal(false);
        }}
      />

      {/* Customer Modal */}
      <Modal visible={showCustomerModal} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { height: '80%' }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{t('billSelectCustomer')}</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => { setShowCustomerModal(false); setShowAddPartyInput(false); }}
              >
                <Text style={styles.closeText}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Quick Add Customer Button / Form */}
            {!showAddPartyInput ? (
              <TouchableOpacity
                style={styles.addCustomerBtn}
                onPress={() => setShowAddPartyInput(true)}
              >
                <Text style={styles.primaryBtnText}>+ Add customer</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.newCustomerBox}>
                <Text style={styles.newCustomerTitle}>{t('billNewCustomerDetails')}</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder={t('customerNameLabel') + ' *'}
                  placeholderTextColor={color.textMuted}
                  value={newPartyName}
                  onChangeText={setNewPartyName}
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder={t('customerPhoneLabel')}
                  placeholderTextColor={color.textMuted}
                  keyboardType="phone-pad"
                  value={newPartyPhone}
                  onChangeText={setNewPartyPhone}
                />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnSecondary]}
                    onPress={() => setShowAddPartyInput(false)}
                  >
                    <Text style={styles.secondaryBtnText}>{t('commonCancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnPrimary]}
                    onPress={handleCreateNewParty}
                    disabled={creatingParty}
                  >
                    {creatingParty ? <ActivityIndicator color={color.textInverse} size="small" /> : <Text style={styles.primaryBtnText}>{t('customerSave')}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TextInput
              style={styles.modalInput}
              placeholder={t('customerSearchPlaceholder')}
              placeholderTextColor={color.textMuted}
              value={customerQuery}
              onChangeText={setCustomerQuery}
            />
            <TouchableOpacity
              style={[styles.customerItem, !selectedCustomer && styles.customerItemActive]}
              onPress={() => { setSelectedCustomer(null); setCustomerName(''); setShowCustomerModal(false); }}
            >
              <Text style={styles.customerName}>{t('billWalkInCustomer')}</Text>
            </TouchableOpacity>
            <FlatList
              data={customers}
              keyExtractor={i => i.id}
              onEndReached={loadMoreCustomers}
              onEndReachedThreshold={0.5}
              ListFooterComponent={customerLoadingMore ? <ActivityIndicator style={{ margin: space.md }} color={color.accent} /> : null}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.customerItem, selectedCustomer?.id === item.id && styles.customerItemActive]}
                  onPress={() => { setSelectedCustomer(item); setCustomerName(item.name); setShowCustomerModal(false); }}
                >
                  <Text style={styles.customerName}>{item.name}</Text>
                  {!!item.phone && <Text style={styles.customerPhone}>{item.phone}</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  partialHint: { ...typeScale.caption, color: color.attention, marginTop: space.sm },
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, height: 56, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center' },
  backIcon: { fontSize: 28, color: color.textPrimary },
  headerTitle: { ...typeScale.heading, color: color.textPrimary, flex: 1, textAlign: 'center' },

  cardContainer: {
    flex: 1, backgroundColor: color.surface,
  },

  row: { flexDirection: 'row', marginBottom: space.lg },
  inputWrap: { flex: 1, position: 'relative', marginTop: space.sm },
  floatingLabel: {
    position: 'absolute', top: -10, left: space.lg, zIndex: 1,
    backgroundColor: color.surface, paddingHorizontal: 6, borderRadius: radius.sm,
  },
  labelText: { ...typeScale.caption, color: color.textSecondary },
  input: {
    minHeight: 50, borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.lg, color: color.textPrimary, fontSize: 16,
    backgroundColor: color.surfaceRaised,
  },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 54, borderWidth: hairline, borderColor: color.borderStrong, borderRadius: radius.md,
    paddingHorizontal: space.lg, marginBottom: space.lg, backgroundColor: color.surface, gap: space.sm,
  },
  actionText: { ...typeScale.bodyMedium, fontSize: 16, color: color.accent, flex: 1 },
  actionTextGray: { ...typeScale.body, fontSize: 16, color: color.textSecondary, flex: 1 },
  chevron: { fontSize: 22, color: color.accent },

  fieldRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg, alignItems: 'center' },
  pickBtn: {
    minHeight: 50, paddingHorizontal: space.md, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.accent, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  pickBtnText: { ...typeScale.label, fontWeight: '500', color: color.accent },

  invoiceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: space.lg, marginTop: space.xs, gap: space.md,
  },
  invoiceLabel: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  invoiceInput: { flex: 1, textAlign: 'right', fontWeight: '500' },
  currencyHint: { ...typeScale.caption, color: color.textMuted, marginTop: space.xs },
  dueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginBottom: space.lg },


  textArea: {
    borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    padding: space.lg, color: color.textPrimary, fontSize: 16, minHeight: 90,
    textAlignVertical: 'top', marginBottom: space.lg, backgroundColor: color.surfaceRaised,
  },

  clearPhotosBtn: { alignSelf: 'flex-start', marginLeft: space.xs, marginBottom: space.lg, minHeight: touchTarget, justifyContent: 'center' },
  clearPhotosText: { ...typeScale.bodyMedium, color: color.moneyOut },

  saveBtn: {
    backgroundColor: color.accent, minHeight: 50, borderRadius: radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { ...typeScale.bodyMedium, fontSize: 16, color: color.textInverse },

  modalBg: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.xxl, paddingBottom: 40, borderWidth: hairline, borderColor: color.border,
  },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  modalTitle: { ...typeScale.title, color: color.textPrimary, flex: 1 },
  closeBtn: { width: touchTarget, height: touchTarget, alignItems: 'flex-end', justifyContent: 'center' },
  closeText: { fontSize: 26, color: color.textSecondary },

  addCustomerBtn: {
    backgroundColor: color.accent, minHeight: touchTarget, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.md,
  },
  primaryBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textInverse },
  secondaryBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  newCustomerBox: {
    backgroundColor: color.surfaceRaised, padding: space.md, borderRadius: radius.md,
    marginBottom: space.md, borderWidth: hairline, borderColor: color.border,
  },
  newCustomerTitle: { ...typeScale.label, fontWeight: '500', color: color.textPrimary, marginBottom: space.sm },
  modalInput: {
    backgroundColor: color.surface, color: color.textPrimary, paddingHorizontal: space.md,
    minHeight: touchTarget, borderRadius: radius.sm, marginBottom: space.sm,
    borderWidth: hairline, borderColor: color.border,
  },
  modalBtn: { flex: 1, minHeight: touchTarget, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  modalBtnSecondary: { backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong },
  modalBtnPrimary: { backgroundColor: color.accent },

  customerItem: {
    paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: touchTarget,
    borderBottomWidth: hairline, borderBottomColor: color.border, borderRadius: radius.sm, marginBottom: space.xs,
  },
  customerItemActive: { backgroundColor: color.surfaceRaised },
  customerName: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  customerPhone: { ...typeScale.label, color: color.textSecondary, marginTop: 2 },
});
