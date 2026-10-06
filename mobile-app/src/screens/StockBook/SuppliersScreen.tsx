import React, { useEffect, useState, useCallback } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useSupplierStore } from '../../store/useSupplierStore';
import { Supplier } from '../../types/supplier.types';
import { internationalPhone } from '../../utils/phone';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { color, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Icon, AmountText } from '../../components/ui/primitives';

const SupplierCard = React.memo(({ item, onPress, onCall, onWhatsApp }: {
  item: Supplier;
  onPress: () => void;
  onCall: () => void;
  onWhatsApp: () => void;
}) => {
  const { t } = useLanguageStore();
  return (
  <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
    <View style={styles.cardLeft}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.supplierName} numberOfLines={1}>{item.name}</Text>
        {!!item.business_name && <Text style={styles.meta} numberOfLines={1}>{item.business_name}</Text>}
        {!!item.phone && <Text style={styles.meta}>{item.phone}</Text>}
        {(item.outstanding_balance ?? 0) > 0 && (
          <View style={styles.outstandingLine}>
            <Text style={styles.outstandingLabel}>{t('supPayable')}</Text>
            <AmountText paisa={item.outstanding_balance ?? 0} size="label" tone="out" />
          </View>
        )}
      </View>
    </View>
    {!!item.phone && (
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onCall} accessibilityRole="button" accessibilityLabel={t('supCall')}>
          <Icon name="phone" size={iconSize.sm} tint={color.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={onWhatsApp} accessibilityRole="button" accessibilityLabel={t('supWhatsApp')}>
          <Icon name="message-circle" size={iconSize.sm} tint={color.accent} />
        </TouchableOpacity>
      </View>
    )}
  </TouchableOpacity>
  );
});

export const SuppliersScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { suppliers, loading, loadSuppliers } = useSupplierStore();
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    if (user?.id) loadSuppliers(user.id);
  }, [user?.id]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const filtered = search.trim()
    ? suppliers.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.business_name?.toLowerCase().includes(search.toLowerCase()))
      )
    : suppliers;

  const handleCall = (phone: string) => Linking.openURL(`tel:${phone}`);
  // Country-aware: a Dubai supplier's number is not rewritten as a Pakistani one.
  const handleWhatsApp = (phone: string) => {
    const intl = internationalPhone(phone);
    if (intl) Linking.openURL(`whatsapp://send?phone=${intl}`);
  };

  // The supplier list is not paged, and each row's balance is an SQL aggregate.
  const totalOutstanding = suppliers.reduce((s, sup) => s + (sup.outstanding_balance ?? 0), 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('stockSuppliers')}</Text>
          <Text style={styles.headerSub}>{suppliers.length} suppliers</Text>
        </View>
        <TouchableOpacity style={styles.addHeaderBtn} onPress={() => navigation.navigate('AddSupplierModal')} accessibilityRole="button">
          <Icon name="plus" size={iconSize.sm} tint={color.textInverse} />
          <Text style={styles.addHeaderText}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScreenContainer scrollable={false} hasTabBar={true} style={styles.container}>
        {totalOutstanding > 0 && (
          <TouchableOpacity style={styles.summaryBanner} onPress={() => navigation.navigate('OutstandingPayables')} accessibilityRole="button">
            <Text style={styles.summaryLabel}>{t('supTotalPayables')}</Text>
            <AmountText paisa={totalOutstanding} tone="out" />
            <Icon name="chevron-right" size={iconSize.sm} tint={color.textMuted} />
          </TouchableOpacity>
        )}

        <View style={styles.searchWrap}>
          <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('supSearch')}
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={color.textMuted}
          />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={color.accent} style={styles.spinner} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="truck" size={40} tint={color.textMuted} />
            <Text style={styles.emptyTitle}>{search ? 'No results found' : 'No suppliers yet'}</Text>
            <Text style={styles.emptySub}>{search ? 'Try a different search' : 'Add your first supplier to get started'}</Text>
            {!search && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('AddSupplierModal')} accessibilityRole="button">
                <Icon name="plus" size={iconSize.sm} tint={color.textInverse} />
                <Text style={styles.emptyBtnText}>{t('supAdd')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={i => i.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <SupplierCard
                item={item}
                onPress={() => navigation.navigate('SupplierProfile', { supplierId: item.id })}
                onCall={() => item.phone && handleCall(item.phone)}
                onWhatsApp={() => item.phone && handleWhatsApp(item.phone)}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  headerSub: { ...typeScale.caption, color: color.textSecondary },
  addHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.accent,
    paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.pill, marginRight: space.sm,
  },
  addHeaderText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textInverse },
  summaryBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touchTarget + space.sm,
    borderBottomWidth: hairline, borderBottomColor: color.border, paddingHorizontal: space.lg,
  },
  summaryLabel: { ...typeScale.label, color: color.textSecondary, flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.surfaceRaised,
    margin: space.lg, borderRadius: radius.md, paddingHorizontal: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  searchInput: { flex: 1, minHeight: touchTarget, ...typeScale.body, color: color.textPrimary },
  spinner: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  separator: { height: space.sm },
  card: {
    backgroundColor: color.surface, borderRadius: radius.md, padding: space.md,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    borderWidth: hairline, borderColor: color.border,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { ...typeScale.bodyMedium, fontSize: 18, color: color.textPrimary },
  cardInfo: { flex: 1, gap: 2 },
  supplierName: { ...typeScale.bodyMedium, color: color.textPrimary },
  meta: { ...typeScale.caption, color: color.textSecondary },
  outstandingLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  outstandingLabel: { ...typeScale.caption, color: color.textSecondary },
  cardActions: { flexDirection: 'row' },
  actionBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, gap: space.xs },
  emptyTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, marginTop: space.sm },
  emptySub: { ...typeScale.body, color: color.textSecondary, textAlign: 'center' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.accent,
    paddingHorizontal: space.xl, minHeight: touchTarget, borderRadius: radius.md, marginTop: space.lg,
  },
  emptyBtnText: { ...typeScale.bodyMedium, color: color.textInverse },
});
