import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StockItem, StockMovement } from '../../types/stock.types';
import { getItemMovements, getItemMovementMonths, addStockMovement, getItemSales, ItemSales } from '../../services/database/stockDb';
import { PAGE_SIZE, PageCursor } from '../../services/database/pagination';
import { formatCurrency, rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { getDisplayName } from '../../utils/displayName';
import { useAuthStore } from '../../store/authStore';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon, AmountText } from '../../components/ui/primitives';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';

const getCurrentMonthKey = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
};

export const StockItemDetailScreen = ({ route, navigation }: any) => {
  // readOnly: opened from someone else's (Staff Book drill-down) Stock — no stock in/out.
  const { item, readOnly } = route.params as { item: StockItem; readOnly?: boolean };
  // Sold all time and its selling value, net of customer returns (SQL aggregates).
  const [sales, setSales] = useState<ItemSales>({ soldQty: 0, returnedQty: 0, netSoldQty: 0, soldValue: 0, returnedValue: 0, netSoldValue: 0 });
  // The price for THIS entry. Prices change month to month, so every stock in / out /
  // return carries its own — the item's saved price is just the starting value.
  const [inputPrice, setInputPrice] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'in' | 'out' | 'return'>('in');
  const [inputQty, setInputQty] = useState('');
  const [inputNote, setInputNote] = useState('');
  const [inputDate, setInputDate] = useState(() => todayDate());
  const [saving, setSaving] = useState(false);

  // Default month filter state to Current Month ('YYYY-MM')
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey);
  const monthScrollRef = useRef<ScrollView>(null);

  // The selected month is filtered in SQL and its In/Out totals are a SQL aggregate;
  // only that month's rows are fetched, PAGE_SIZE at a time.
  const [monthsWithMovement, setMonthsWithMovement] = useState<string[]>([]);
  const [stats, setStats] = useState({ totalIn: 0, totalOut: 0, count: 0 });
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMovements = async () => {
    setLoading(true);
    try {
      const [{ rows, summary, nextCursor }, months] = await Promise.all([
        getItemMovements(item.id, selectedMonth, PAGE_SIZE),
        getItemMovementMonths(item.id),
      ]);
      setMovements(rows);
      setStats(summary);
      setCursor(nextCursor);
      setMonthsWithMovement(months);
    } catch (err) {
      if (__DEV__) console.error('Failed to load stock movements:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!cursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const { rows, nextCursor } = await getItemMovements(item.id, selectedMonth, PAGE_SIZE, cursor);
      setMovements(prev => [...prev, ...rows]);
      setCursor(nextCursor);
    } catch (err) {
      if (__DEV__) console.error('Failed to load more movements:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { loadMovements(); }, [item.id, selectedMonth]);
  // All-time figures: they do not depend on the month being viewed.
  useEffect(() => {
    let active = true;
    getItemSales(item.id)
      .then(s => { if (active) setSales(s); })
      .catch(err => { if (__DEV__) console.error('[Stock] sales failed:', err); });
    return () => { active = false; };
  }, [item.id]);

  // Generate available month options in chronological sequential order (Jan to Dec)
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    const currentYear = new Date().getFullYear();
    
    // Add all 12 months of the current year in sequence (Jan to Dec)
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      monthSet.add(`${currentYear}-${mm}`);
    }

    // Months in which this item actually moved — from SQL, not from loaded rows.
    monthsWithMovement.forEach(key => monthSet.add(key));

    const sorted = Array.from(monthSet).sort(); // Ascending chronological order: Jan -> Dec
    return ['ALL', ...sorted];
  }, [monthsWithMovement]);

  // Auto scroll to active month pill
  useEffect(() => {
    const index = availableMonths.indexOf(selectedMonth);
    if (index >= 0 && monthScrollRef.current) {
      setTimeout(() => {
        monthScrollRef.current?.scrollTo({ x: Math.max(0, index * 60 - 40), animated: true });
      }, 100);
    }
  }, [selectedMonth, availableMonths]);

  // Rows are already the selected month (SQL); stats are the month's SQL aggregate.
  const filteredMovements = movements;
  const monthlyStats = { totalIn: stats.totalIn, totalOut: stats.totalOut, netChange: stats.totalIn - stats.totalOut };

  const openModal = (mode: 'in' | 'out' | 'return') => {
    setModalMode(mode);
    setInputQty('');
    setInputNote('');
    // Starts from the item's saved price (blank when it was never set), and can be changed.
    const saved = mode === 'in' ? item.purchase_price : item.sale_price;
    setInputPrice(saved ? paisaToRupeesString(saved) : '');
    // Default entry date to current selected month date or today
    const todayStr = todayDate();
    if (selectedMonth !== 'ALL' && !todayStr.startsWith(selectedMonth)) {
      setInputDate(`${selectedMonth}-01`);
    } else {
      setInputDate(todayStr);
    }
    setModalVisible(true);
  };

  const handleSaveMovement = async () => {
    const qty = parseFloat(inputQty);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert(t('sidQtyInvalidTitle'), t('sidQtyInvalid'));
      return;
    }
    if (!user?.id) return;
    const pricePaisa = inputPrice.trim() ? rupeesToPaisa(inputPrice) : 0;
    if (pricePaisa === null) {
      Alert.alert(t('sidPriceInvalidTitle'), t('sidPriceInvalid'));
      return;
    }
    if (modalMode !== 'in' && !pricePaisa) {
      Alert.alert(t('sidPriceNeededTitle'), modalMode === 'out'
        ? t('sidPriceNeededOut')
        : t('sidPriceNeededReturn'));
      return;
    }
    if (modalMode === 'return' && qty > sales.netSoldQty) {
      Alert.alert(t('sidMoreThanSoldTitle'), t('sidMoreThanSold', { qty: sales.netSoldQty, unit: item.unit }));
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!inputDate || !dateRegex.test(inputDate)) {
      Alert.alert(t('salaryDateInvalidTitle'), t('salaryDateInvalid'));
      return;
    }

    setSaving(true);
    try {
      const isOut = modalMode === 'out';
      const isReturn = modalMode === 'return';

      const movement: Omit<StockMovement, 'id' | 'synced' | 'is_deleted'> = {
        item_id: item.id,
        change: isOut ? -qty : qty,
        reason: isOut ? 'sale' : isReturn ? 'customer_return' : 'purchase',
        // stock_movements.date is a plain YYYY-MM-DD calendar day, like every other
        // book. It previously stored a UTC timestamp anchored at local noon.
        date: inputDate,
        // The price typed for THIS entry, in paisa. A return carries the selling price
        // it is reversing, so that value leaves the total sold.
        cost_per_unit: modalMode === 'in' ? pricePaisa : undefined,
        sale_price_unit: modalMode === 'in' ? undefined : pricePaisa,
        user_id: user.id,
        note: inputNote.trim() || undefined,
      };

      await addStockMovement(movement);
      await loadMovements();
      setSales(await getItemSales(item.id));
      item.quantity += movement.change;
      setModalVisible(false);
    } catch (error) {
      if (__DEV__) console.error(error);
      Alert.alert(t('commonError'), t('sidMovementFailed'));
    } finally {
      setSaving(false);
    }
  };

  const formatMonthLabel = (monthKey: string) => {
    if (monthKey === 'ALL') return 'All';
    const [yyyy, mm] = monthKey.split('-');
    const date = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
    return date.toLocaleString('default', { month: 'short', year: '2-digit' });
  };

  const renderMovement = ({ item: mov }: { item: StockMovement }) => {
    const isOut = mov.change < 0;
    const date = new Date(mov.date).toLocaleDateString();
    return (
      <View style={styles.movRow}>
        <View style={styles.movLeft}>
          <Text style={styles.movReason}>{mov.reason.toUpperCase()}</Text>
          <Text style={styles.movDate}>{date}{mov.note ? ` • ${mov.note}` : ''}</Text>
        </View>
        <View style={styles.movRight}>
          <Text style={[styles.movChange, isOut ? { color: color.moneyOut } : { color: color.moneyIn }]}>
            {isOut ? '' : '+'}{mov.change} {item.unit}
          </Text>
          {(mov.cost_per_unit || mov.sale_price_unit) ? (
            <Text style={styles.movPrice}>
              @{formatCurrency((mov.cost_per_unit || mov.sale_price_unit || 0))}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Compact Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {getDisplayName(item)}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScreenContainer scrollable={false} hasTabBar={true} style={styles.container}>
        {/* Compact Item Summary Bar */}
        <View style={styles.compactInfoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.compactCategory}>{item.category} • {item.location || 'No Loc'}</Text>
            <Text style={styles.compactStock}>Stock: <Text style={styles.stockBold}>{item.quantity} {item.unit}</Text></Text>
          </View>
          {/* Sold all time and what it brought in — the selling price of each sale,
              less anything customers returned. */}
          <View style={styles.infoRow}>
            <Text style={styles.compactCategory}>Sold all time: {sales.netSoldQty} {item.unit}</Text>
            <View style={styles.soldValueLine}>
              <Text style={styles.compactCategory}>{t('sidTotalSelling')}</Text>
              <AmountText paisa={sales.netSoldValue} size="label" tone="in" />
            </View>
          </View>
          {sales.returnedQty > 0 && (
            <Text style={styles.returnNote}>Returned stock: {sales.returnedQty} {item.unit}</Text>
          )}
          <View style={styles.pricesRow}>
            <Text style={styles.priceLabel}>Buy: {formatCurrency(item.purchase_price)}</Text>
            <Text style={styles.priceLabel}>Sell: {formatCurrency(item.sale_price)}</Text>
            {item.barcode ? <Text style={styles.priceLabel}>BC: {item.barcode}</Text> : null}
          </View>
        </View>

        {/* Compact Action Buttons */}
        {!readOnly && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color.moneyIn }]} onPress={() => openModal('in')}>
            <Text style={styles.actionBtnText}>+ IN / BUY</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color.moneyOut }]} onPress={() => openModal('out')}>
            <Text style={styles.actionBtnText}>- OUT / SELL</Text>
          </TouchableOpacity>
        </View>
        )}
        {/* Stock coming back from a customer: units return to stock and their selling
            value leaves the total sold. */}
        {!readOnly && (
          <TouchableOpacity style={styles.returnBtn} onPress={() => openModal('return')} accessibilityRole="button">
            <Icon name="corner-up-left" size={iconSize.sm} tint={color.textInverse} />
            <Text style={styles.returnBtnText}>{t('sidCustomerReturn')}</Text>
          </TouchableOpacity>
        )}

        {/* Month Filter & Inline Stats Bar */}
        <View style={styles.monthSection}>
          <ScrollView 
            ref={monthScrollRef}
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.monthScroll}
          >
            {availableMonths.map(mKey => {
              const active = selectedMonth === mKey;
              return (
                <TouchableOpacity
                  key={mKey}
                  style={[styles.monthPill, active && styles.monthPillActive]}
                  onPress={() => setSelectedMonth(mKey)}
                >
                  <Text style={[styles.monthPillText, active && styles.monthPillTextActive]}>
                    {formatMonthLabel(mKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.inlineSummary}>
            <Text style={styles.summaryText}>
              In: <Text style={{ color: color.moneyIn, fontWeight: '500' }}>+{monthlyStats.totalIn}</Text> | Out: <Text style={{ color: color.moneyOut, fontWeight: '500' }}>-{monthlyStats.totalOut}</Text> | Net: <Text style={{ color: monthlyStats.netChange >= 0 ? color.moneyIn : color.moneyOut, fontWeight: '500' }}>{monthlyStats.netChange >= 0 ? '+' : ''}{monthlyStats.netChange}</Text>
            </Text>
          </View>
        </View>

        {/* Stock Entries List (Takes Max Height) */}
        <View style={styles.listContainer}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Stock Entries ({stats.count})</Text>
          </View>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color={color.accent} />
            </View>
          ) : filteredMovements.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No stock entries for {formatMonthLabel(selectedMonth)}.</Text>
            </View>
          ) : (
            <FlatList
              data={filteredMovements}
              keyExtractor={(mov) => mov.id}
              renderItem={renderMovement}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={color.accent} /> : null}
            />
          )}
        </View>
      </ScreenContainer>

      {/* Movement Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modalMode === 'in' ? 'Stock in (buy)' : modalMode === 'out' ? 'Stock out (sell)' : 'Customer return'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Scrollable so the keyboard (Note field) never hides SAVE ENTRY below it */}
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalLabel}>Quantity ({item.unit}) *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="0"
                placeholderTextColor={color.textSecondary}
                keyboardType="numeric"
                value={inputQty}
                onChangeText={setInputQty}
                autoFocus
              />

              <Text style={styles.modalLabel}>{t('commonDate')} *</Text>
              <DateField
                style={styles.modalInput}
                value={inputDate}
                onChange={setInputDate}
              />

              {/* Price for this entry — typed here, so an item saved without prices
                  still records what it was bought or sold for. */}
              <Text style={styles.modalLabel}>
                {modalMode === 'in' ? 'Buy price per ' : 'Sell price per '}{item.unit}
                {modalMode === 'in' ? ' (optional)' : ''}
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="0"
                placeholderTextColor={color.textSecondary}
                keyboardType="decimal-pad"
                value={inputPrice}
                onChangeText={setInputPrice}
              />

              <View style={styles.calcRow}>
                <Text style={styles.calcText}>
                  {(parseFloat(inputQty) || 0)} {item.unit} × {formatCurrency(rupeesToPaisa(inputPrice) ?? 0)}
                </Text>
                <Text style={styles.calcTotalText}>
                  Total: {formatCurrency(Math.round((rupeesToPaisa(inputPrice) ?? 0) * (parseFloat(inputQty) || 0)))}
                </Text>
              </View>

              <Text style={styles.modalLabel}>{t('cashNoteLabel')}</Text>
              <TextInput
                style={[styles.modalInput, { minHeight: 48, textAlignVertical: 'top' }]}
                placeholder={t('sidReasonPlaceholder')}
                placeholderTextColor={color.textSecondary}
                value={inputNote}
                onChangeText={setInputNote}
                multiline
              />

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: modalMode === 'in' ? color.moneyIn : color.moneyOut }]}
                onPress={handleSaveMovement}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={color.textInverse} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('sidSaveEntry')}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: 12, height: 48,
    borderBottomWidth: 1, borderBottomColor: color.border,
  },
  backBtn: { width: 36, justifyContent: 'center' },
  backArrow: { fontSize: 22, color: color.textPrimary },
  headerTitle: { fontSize: 16, fontWeight: '500', color: color.textPrimary, flex: 1, textAlign: 'center' },

  compactInfoCard: {
    backgroundColor: color.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  compactCategory: { fontSize: 12, color: color.textSecondary },
  compactStock: { fontSize: 12, color: color.textSecondary },
  stockBold: { fontSize: 13, fontWeight: '500', color: color.textPrimary },
  pricesRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  priceLabel: { fontSize: 11, color: color.textMuted },

  soldValueLine: { flexDirection: 'row', alignItems: 'center' },
  returnNote: { ...typeScale.caption, color: color.textSecondary, marginTop: space.xs },
  returnBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: color.accent, minHeight: touchTarget, borderRadius: radius.md,
    marginHorizontal: space.md, marginTop: space.sm,
  },
  returnBtnText: { ...typeScale.bodyMedium, color: color.textInverse },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    color: color.textInverse,
    fontWeight: '500',
    fontSize: 13,
  },

  monthSection: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: color.surfaceRaised,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  monthScroll: {
    gap: 6,
    paddingRight: 12,
    paddingVertical: 2,
  },
  monthPill: {
    backgroundColor: color.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border,
  },
  monthPillActive: {
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  monthPillText: {
    color: color.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  monthPillTextActive: {
    color: color.textInverse,
    fontWeight: '500',
  },

  inlineSummary: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: color.border,
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 11,
    color: color.textSecondary,
  },

  listContainer: { flex: 1 },
  listHeader: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  listTitle: { fontSize: 13, fontWeight: '500', color: color.textPrimary },
  
  movRow: {
    backgroundColor: color.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
  },
  movLeft: { flex: 1 },
  movReason: { fontSize: 12, fontWeight: '500', color: color.textPrimary },
  movDate: { fontSize: 11, color: color.textSecondary, marginTop: 1 },
  movRight: { alignItems: 'flex-end' },
  movChange: { fontSize: 14, fontWeight: '500' },
  movPrice: { fontSize: 10, color: color.textSecondary },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 100 },
  emptyState: { padding: 20, alignItems: 'center' },
  emptyText: { color: color.textSecondary, fontSize: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: color.scrim,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: color.border,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: color.textPrimary,
  },
  closeBtn: {
    fontSize: 18,
    fontWeight: '500',
    color: color.textSecondary,
    padding: 4,
  },
  modalBody: {},
  modalLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: color.textPrimary,
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: color.textPrimary,
    marginBottom: 12,
  },
  calcRow: {
    backgroundColor: color.surfaceRaised,
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: color.border,
  },
  calcText: {
    fontSize: 12,
    color: color.textSecondary,
  },
  calcTotalText: {
    fontSize: 13,
    fontWeight: '500',
    color: color.textPrimary,
    marginTop: 2,
  },
  saveBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '500',
    color: color.textInverse,
    letterSpacing: 0.5,
  },
});
