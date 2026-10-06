import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, IconName, Card } from '../../components/ui/primitives';
import { ReadOnlyBanner } from '../../components/ui/ReadOnlyBanner';
import { color, space, radius, hairline, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * One staff member's books — the same grid as the dashboard, but every book opens
 * scoped to entries THIS person created, read-only. Their sub-staff are not merged
 * in; each sub-staff has their own profile and Entries.
 *
 * `route` is the existing book route opened with `viewAs`; every book screen reads
 * that person's rows (permission-checked in the data layer) and hides every create,
 * edit and delete control.
 */
const BOOKS: { key: string; label: string; icon: IconName; route?: string }[] = [
  { key: 'cash', label: 'Cash', icon: 'dollar-sign', route: 'CashBook' },
  { key: 'khata', label: 'Khata', icon: 'book-open', route: 'StaffKhata' },
  { key: 'bill', label: 'Bill', icon: 'file-text', route: 'BillBook' },
  { key: 'expense', label: 'Expense', icon: 'credit-card', route: 'ExpensesTab' },
  { key: 'stock', label: 'Stock', icon: 'package', route: 'StockBook' },
  { key: 'purchase', label: 'Purchase', icon: 'shopping-cart', route: 'PurchaseBook' },
  { key: 'customer', label: 'Customer', icon: 'user', route: 'CustomerBook' },
];

export const StaffEntriesScreen = ({ route, navigation }: any) => {
  const { t } = useLanguageStore();
  const staff = route.params?.staff;
  const name: string = staff?.name_en || 'Staff';
  const linkedUserId: string | null = staff?.linked_user_id ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReadOnlyBanner name={name} book="Entries" onBack={() => navigation.goBack()} />

      {!linkedUserId ? (
        // Entries belong to a login. A profile with none can have no entries of its own.
        <View style={styles.content}>
          <Card tone="outlined">
            <View style={styles.emptyRow}>
              <Icon name="info" size={iconSize.md} tint={color.textSecondary} />
              <Text style={styles.emptyText}>
                No login is linked to this staff member, so there are no entries to show.
              </Text>
            </View>
          </Card>
        </View>
      ) : (
        <View style={styles.content}>
          <Text style={styles.intro}>
            Entries created by {name}. Nothing here can be changed.
          </Text>
          <View style={styles.grid}>
            {BOOKS.map(book => {
              const ready = !!book.route;
              return (
                <Pressable
                  key={book.key}
                  disabled={!ready}
                  onPress={() => navigation.navigate(book.route as string, { viewAs: { userId: linkedUserId, name } })}
                  style={styles.cell}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !ready }}
                  accessibilityLabel={book.label}
                >
                  {({ pressed }) => (
                    <>
                      <View style={[styles.tile, pressed && ready && styles.tilePressed, !ready && styles.tileSoon]}>
                        <Icon name={book.icon} size={iconSize.lg} tint={ready ? color.textSecondary : color.textMuted} />
                      </View>
                      <Text style={[styles.tileLabel, !ready && styles.tileLabelSoon]} numberOfLines={2}>{book.label}</Text>
                      {!ready && <Text style={styles.soon}>{t('seComingNext')}</Text>}
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  content: { padding: space.lg },
  intro: { ...typeScale.label, color: color.textSecondary, marginBottom: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // A quarter each, spacing inside — the same grid as the dashboard's Books.
  cell: { width: '25%', paddingHorizontal: space.xs, paddingBottom: space.lg, alignItems: 'center' },
  tile: {
    alignSelf: 'stretch', height: 56, borderRadius: radius.md,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center',
  },
  tilePressed: { backgroundColor: color.surfacePressed },
  tileSoon: { backgroundColor: color.surface, borderStyle: 'dashed' },
  // No fixed width and two lines allowed: Urdu book names run far longer.
  tileLabel: { ...typeScale.caption, color: color.textSecondary, marginTop: space.sm, textAlign: 'center' },
  tileLabelSoon: { color: color.textMuted },
  soon: { ...typeScale.caption, fontSize: 10, color: color.textMuted, textAlign: 'center' },
  emptyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  emptyText: { ...typeScale.body, color: color.textSecondary, flex: 1 },
});
