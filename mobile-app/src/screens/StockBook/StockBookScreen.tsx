import React, { useEffect, useRef, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  Animated, ActivityIndicator, Dimensions, Alert, Keyboard, Platform, Modal, TextInput
} from 'react-native';

import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useStockStore } from '../../store/useStockStore';
import { getSalesByItem, ItemSales } from '../../services/database/stockDb';
import { StockItem } from '../../types/stock.types';
import { formatCurrency } from '../../utils/calculations';
import { getDisplayName } from '../../utils/displayName';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget, chrome } from '../../theme/tokens';
import { Icon, AmountText } from '../../components/ui/primitives';
import { PdfReportButton } from '../../components/ui/PdfReportButton';


const StockItemView = React.memo(({ item, onPress, sold }: { item: StockItem, onPress: () => void, sold?: ItemSales }) => {
  const { t } = useLanguageStore();
  const isLow = item.quantity < item.low_stock_threshold;

  return (
    <TouchableOpacity 
      style={[styles.itemRow, isLow && styles.itemRowLowStock]}
      onPress={onPress}
    >
      <View style={styles.itemHeader}>
        <View style={styles.itemIconBox}>
          <Icon name="package" size={iconSize.md} tint={color.textSecondary} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName}>{getDisplayName(item)}</Text>
          <Text style={styles.itemCat}>{item.category}</Text>
        </View>
        <View style={styles.itemQtyWrap}>
          <Text style={[styles.itemQtyNum, isLow ? { color: color.attention } : { color: color.textPrimary }]}>
            {item.quantity}
          </Text>
          <Text style={styles.itemQtyUnit}>{item.unit}</Text>
        </View>
      </View>

      <View style={styles.itemFooter}>
        <Text style={styles.itemFooterText}>{item.unit}</Text>
        <Text style={styles.itemFooterText}> | {item.location || 'Not Set'}</Text>
        <Text style={styles.itemFooterText}> | {formatCurrency(item.purchase_price)}</Text>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Icon name="chevron-right" size={iconSize.md} tint={color.textMuted} />
        </View>
      </View>

      {/* What this item has sold, all time — at the price each sale was made at,
          less anything customers returned. */}
      {!!sold && sold.netSoldQty > 0 && (
        <View style={styles.soldRow}>
          <Text style={styles.itemFooterText}>{t('stockSold')} {sold.netSoldQty} {item.unit}</Text>
          <AmountText paisa={sold.netSoldValue} size="label" tone="in" />
        </View>
      )}
    </TouchableOpacity>
  );
});

export const StockBookScreen = ({ navigation, route }: any) => {
  // Staff Book → staff → Entries → Stock: that person's inventory, read-only.
  const viewAs: { userId: string; name: string } | undefined = route?.params?.viewAs;
  // All-time selling per item, for the list cards (one SQL aggregate for every item).
  const [sales, setSales] = React.useState<Record<string, ItemSales>>({});
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { 
    items, loading, selectedTab, totalStockValue, 
    fetchItems, fetchLowStockItems, setSelectedTab, loadStockValue 
  } = useStockStore();

  const pulseAnim = useRef(new Animated.Value(0)).current;

  const [rateListVisible, setRateListVisible] = useState(false);
  const [rateListSearch, setRateListSearch] = useState('');

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);

  const loadData = () => {
    if (!user) return;
    if (selectedTab === 'low') {
      fetchLowStockItems(user.id, viewAs?.userId);
    } else {
      fetchItems(user.id, viewAs?.userId);
    }
    loadStockValue(user.id, viewAs?.userId);
    getSalesByItem(user.id, viewAs?.userId)
      .then(setSales)
      .catch(err => { if (__DEV__) console.error('[Stock] sales failed:', err); });
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation, user, selectedTab]);

  const [isKeyboardVisible, setIsKeyboardVisible] = React.useState(false);

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

  useEffect(() => {
    loadData();
  }, [user, selectedTab]);

  const renderItem = React.useCallback(({ item }: { item: StockItem }) => {
    return <StockItemView item={item} onPress={() => navigation.navigate('StockItemDetail', { item, readOnly: !!viewAs })} sold={sales[item.id]} />;
  }, [navigation, viewAs, sales]);

  return (
    <View style={styles.container}>
      
      {/* Top Header with Profile & Books Bar */}
      {viewAs
        ? <ReadOnlyBanner name={viewAs.name} book="Stock" onBack={() => navigation.goBack()} />
        : <TopHeaderWithBooks navigation={navigation} activeBook="StockBook" />}

      {/* Sub Header — the download sheet exports the VIEWER's own stock, so not on a read-only book. */}
      {!viewAs && (
        <View style={styles.subHeader}>
          <PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'stock' })} />
        </View>
      )}

      {/* Tabs */}
      <View style={styles.topTabs}>
        <TouchableOpacity 
          style={[styles.topTabItem, selectedTab === 'all' && styles.topTabItemActive]}
          onPress={() => setSelectedTab('all')}
        >
          <Text style={[styles.topTabText, selectedTab === 'all' && styles.topTabTextActive]}>
            {t('stockAllItems')} ({items.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.topTabItem, selectedTab === 'low' && styles.topTabItemActive]}
          onPress={() => setSelectedTab('low')}
        >
          <Text style={[styles.topTabText, selectedTab === 'low' && styles.topTabTextActive]}>
            {t('stockLowStock')} ({items.filter(i => i.quantity < i.low_stock_threshold).length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Action Buttons Row 1: Rate List & Suppliers */}
      <View style={[styles.reportRow, { marginTop: 4 }]}>
        <TouchableOpacity style={styles.reportBtn} onPress={() => setRateListVisible(true)}>
          <Icon name="list" size={iconSize.sm} tint={color.textSecondary} />
          <Text style={styles.reportBtnText}>{t('stockRateList')}</Text>
        </TouchableOpacity>
        {!viewAs && (
          <TouchableOpacity style={styles.reportBtn} onPress={() => navigation.navigate('SuppliersScreen')}>
            <Icon name="truck" size={iconSize.sm} tint={color.textSecondary} />
            <Text style={styles.reportBtnText}>{t('stockSuppliers')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Action Buttons Row 2: Stock IN & Stock OUT (the viewer's own reports — not on a read-only book) */}
      {!viewAs && (
      <View style={[styles.reportRow, { paddingTop: 0, paddingBottom: 6 }]}>
        <TouchableOpacity style={styles.reportBtn} onPress={() => navigation.navigate('StockInReportScreen')}>
          <Icon name="arrow-down-left" size={iconSize.sm} tint={color.moneyIn} />
          <Text style={styles.reportBtnText}>{t('stockIn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reportBtn} onPress={() => navigation.navigate('StockOutReportScreen')}>
          <Icon name="arrow-up-right" size={iconSize.sm} tint={color.moneyOut} />
          <Text style={styles.reportBtnText}>{t('stockOut')}</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.brand} />
        </View>
      ) : items.length === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: chrome.listBottom, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }}>
          <View style={styles.emptyState}>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.instructionText}>{t('stockStep1')}</Text>
              <Text style={styles.instructionText}>{t('stockStep2')}</Text>
              <Text style={styles.instructionText}>{t('stockStep3')}</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: chrome.listBottom }}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}

      {/* Add Item Button */}
      {!isKeyboardVisible && !viewAs && (
        <View style={[styles.addBtnContainer, { bottom: 16 }]}>
          <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AddItemModal')}>
            <Icon name="plus" size={iconSize.sm} tint={color.textInverse} />
            <Text style={styles.addBtnText}>{t('stockAddItem')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Rate List — item name, then the sale rate entered when the item was added */}
      <Modal visible={rateListVisible} animationType="slide" transparent onRequestClose={() => setRateListVisible(false)}>
        <View style={styles.rateModalBg}>
          <View style={styles.rateModalCard}>
            <View style={styles.rateModalHeader}>
              <Text style={styles.rateModalTitle}>{t('stockRateList')}</Text>
              <TouchableOpacity onPress={() => setRateListVisible(false)}>
                <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.rateSearchInput}
              placeholder={t('commonSearchItems')}
              placeholderTextColor={color.textMuted}
              value={rateListSearch}
              onChangeText={setRateListSearch}
            />

            <View style={styles.rateListHeaderRow}>
              <Text style={styles.rateListHeaderText}>{t('stockItemColumn')}</Text>
              <Text style={[styles.rateListHeaderText, { textAlign: 'right' }]}>{t('stockRateColumn')}</Text>
            </View>

            <FlatList
              data={items
                .filter(i => getDisplayName(i).toLowerCase().includes(rateListSearch.trim().toLowerCase()))
                .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)))}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={<Text style={styles.rateListEmpty}>{t('stockNoItems')}</Text>}
              renderItem={({ item }) => (
                <View style={styles.rateListRow}>
                  <Text style={styles.rateListName} numberOfLines={1}>{getDisplayName(item)}</Text>
                  <Text style={styles.rateListRate}>{formatCurrency(item.sale_price)}</Text>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },

  subHeader: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: space.lg, paddingTop: chrome.barPadY,
  },

  stockValueBtn: {
    backgroundColor: color.surfaceRaised, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill,
    borderWidth: hairline, borderColor: color.border,
  },
  stockValueText: { ...typeScale.label, color: color.textPrimary },

  // Underline marks the active tab; colour alone would be one more thing to decode.
  topTabs: {
    flexDirection: 'row', backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
    marginTop: space.sm,
  },
  topTabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    minHeight: touchTarget,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  topTabItemActive: { borderBottomColor: color.accent },
  topTabText: { ...typeScale.label, color: color.textSecondary },
  topTabTextActive: { ...typeScale.bodyMedium, color: color.accent },

  reportRow: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.xs, gap: space.sm },
  // Buttons hug their content and wrap text rather than clipping it, so a longer
  // Urdu label widens the button instead of truncating.
  reportBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.xs, minHeight: touchTarget,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    backgroundColor: color.surfaceRaised, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.border,
  },
  reportBtnText: { ...typeScale.label, color: color.textPrimary, flexShrink: 1 },

  itemRow: {
    backgroundColor: color.surface, borderRadius: radius.md,
    padding: space.lg, marginBottom: chrome.rowGap,
    borderWidth: hairline, borderColor: color.border,
  },
  itemRowLowStock: { borderColor: color.attention },
  itemHeader: { flexDirection: 'row', alignItems: 'center' },
  itemIconBox: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: hairline, borderColor: color.border,
  },
  // flex: 1 so a long item name takes the slack instead of squeezing the quantity.
  itemInfo: { flex: 1, marginLeft: space.md, marginRight: space.sm },
  itemName: { ...typeScale.bodyMedium, color: color.textPrimary },
  itemCat: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  itemQtyWrap: { alignItems: 'flex-end', flexShrink: 0 },
  itemQtyNum: { ...typeScale.title, color: color.textPrimary },
  itemQtyUnit: { ...typeScale.caption, color: color.textSecondary },

  soldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: space.xs },
  itemFooter: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  itemFooterText: { ...typeScale.caption, color: color.textSecondary },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  instructionText: { ...typeScale.body, color: color.textSecondary, marginBottom: space.sm },

  addBtnContainer: { position: 'absolute', bottom: 16, right: space.lg, alignItems: 'flex-end' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: color.accent, paddingHorizontal: space.lg, minHeight: chrome.fab,
    borderRadius: radius.pill,
  },
  addBtnText: { ...typeScale.bodyMedium, color: color.textInverse },

  rateModalBg: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  rateModalCard: {
    backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.lg, maxHeight: '80%', borderWidth: hairline, borderColor: color.border,
  },
  rateModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  rateModalTitle: { ...typeScale.title, color: color.textPrimary },
  rateModalClose: { ...typeScale.body, color: color.textSecondary, padding: space.xs },
  rateSearchInput: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: chrome.rowPadY,
    ...typeScale.body, color: color.textPrimary, marginBottom: space.md, minHeight: touchTarget,
  },
  rateListHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs,
    paddingBottom: space.sm, borderBottomWidth: hairline, borderBottomColor: color.border,
    marginBottom: space.xs,
  },
  rateListHeaderText: { ...typeScale.caption, color: color.textSecondary },
  rateListRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: space.md, paddingHorizontal: space.xs,
    borderBottomWidth: hairline, borderBottomColor: color.border,
    minHeight: touchTarget,
  },
  rateListName: { flex: 1, ...typeScale.body, color: color.textPrimary, marginRight: space.md },
  rateListRate: { ...typeScale.bodyMedium, color: color.textPrimary, flexShrink: 0 },
  rateListEmpty: { ...typeScale.body, color: color.textMuted, textAlign: 'center', marginTop: space.xxxl },
});
