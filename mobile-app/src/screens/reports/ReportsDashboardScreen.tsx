import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import type { TKey } from '../../i18n/en';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { Icon, IconName } from '../../components/ui/primitives';
import { color, space, radius, hairline, iconSize, type as typeScale } from '../../theme/tokens';

type Props = StackScreenProps<any, any>;

// Each tile says in plain words what question the report answers.
const reportTiles: { id: string; titleKey: TKey; descKey: TKey; icon: IconName; screen: string }[] = [
  { id: 'sales', titleKey: 'repSales', descKey: 'repSalesDesc', icon: 'trending-up', screen: 'SalesReport' },
  { id: 'pnl', titleKey: 'repPnl', descKey: 'repPnlDesc', icon: 'pie-chart', screen: 'ProfitLossReport' },
  { id: 'expense', titleKey: 'repExpenses', descKey: 'repExpensesDesc', icon: 'credit-card', screen: 'ExpenseReport' },
  { id: 'cash', titleKey: 'repCashFlow', descKey: 'repCashFlowDesc', icon: 'repeat', screen: 'CashFlowReport' },
  { id: 'inventory', titleKey: 'repInventory', descKey: 'repInventoryDesc', icon: 'package', screen: 'InventoryReport' },
  { id: 'parties', titleKey: 'repCustomers', descKey: 'repCustomersDesc', icon: 'users', screen: 'PartyReport' },
  { id: 'staff', titleKey: 'repStaff', descKey: 'repStaffDesc', icon: 'user-check', screen: 'StaffReport' },
];

export const ReportsDashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useLanguageStore();
  return (
  <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}>
      <Text style={styles.title}>{t('repTitle')}</Text>
      <Text style={styles.subtitle}>{t('repPick')}</Text>
    </View>

    <ScrollView contentContainerStyle={styles.content}>
      {reportTiles.map(tile => (
        <Pressable
          key={tile.id}
          onPress={() => navigation.navigate(tile.screen)}
          accessibilityRole="button"
          accessibilityLabel={t(tile.titleKey)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.iconBox}>
            <Icon name={tile.icon} size={iconSize.md} tint={color.accent} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t(tile.titleKey)}</Text>
            <Text style={styles.rowDesc}>{t(tile.descKey)}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  title: { ...typeScale.title, color: color.textPrimary },
  subtitle: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },

  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxxl },
  // One full-width row per report: Urdu titles and descriptions get the whole line.
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: color.surface, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.border,
    paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 64,
  },
  rowPressed: { backgroundColor: color.surfacePressed },
  iconBox: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  rowDesc: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: color.textMuted },
});
