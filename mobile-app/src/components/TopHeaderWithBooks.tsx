import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguageStore } from '../store/useLanguageStore';
import { color, space, radius, type as typeScale, hairline, iconSize } from '../theme/tokens';
import { Icon, IconName } from './ui/primitives';

interface Props {
  navigation: any;
  activeBook?: string;
}

/**
 * The books bar, and nothing else. The profile block and notification bell that used
 * to sit above it are gone: both already live on the dashboard, and repeating them on
 * every book screen cost a whole row of vertical space on a phone.
 */
export const TopHeaderWithBooks: React.FC<Props> = ({ navigation, activeBook }) => {
  const { t } = useLanguageStore();
  const insets = useSafeAreaInsets();

  // No per-book colour any more: seven decorative hues said nothing, and colour here
  // is reserved for meaning. The active chip is marked by tone and the one accent.
  const books: { name: string; label: string; icon: IconName }[] = [
    { name: 'CashBook', label: t('cashBook'), icon: 'dollar-sign' },
    { name: 'StockBook', label: t('stockBook'), icon: 'package' },
    { name: 'BillBook', label: t('billBook'), icon: 'file-text' },
    { name: 'StaffBook', label: t('staffBook'), icon: 'users' },
    { name: 'ExpensesTab', label: t('expenseBook'), icon: 'credit-card' },
    { name: 'PurchaseBook', label: t('purchaseBook'), icon: 'shopping-cart' },
    { name: 'CustomerBook', label: t('customerBook'), icon: 'user' },
  ];

  return (
    // The status bar height is measured, not guessed — this used to be a hardcoded
    // paddingTop: 44, which is wrong on any notch or punch-hole device.
    <View style={[styles.headerContainer, { paddingTop: insets.top + space.sm }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.booksScroll}>
        {books.map(b => {
          const isActive = activeBook === b.name;
          return (
            <TouchableOpacity
              key={b.name}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => navigation.navigate(b.name)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={b.label}
            >
              <Icon
                name={b.icon}
                size={iconSize.sm}
                tint={isActive ? color.textInverse : color.textSecondary}
              />
              <Text style={[styles.chipText, isActive && styles.chipTextActive]} numberOfLines={1}>
                {b.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: color.surface,
    paddingBottom: space.sm,
    borderBottomWidth: hairline,
    borderBottomColor: color.border,
  },
  booksScroll: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
  // No fixed width: the chip hugs its label, so Urdu simply makes it wider rather
  // than truncating inside a 74px box.
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    minHeight: 36,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised,
    borderWidth: hairline, borderColor: color.border,
  },
  chipActive: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { ...typeScale.label, color: color.textSecondary },
  chipTextActive: { color: color.textInverse },
});
