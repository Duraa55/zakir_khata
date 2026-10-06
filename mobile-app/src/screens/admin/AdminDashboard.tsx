import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import type { TKey } from '../../i18n/en';
import { useDashboardStore } from '../../store/useDashboardStore';
import { getDayBook } from '../../services/database/cashbookDb';
import { getVisibleEntryAudit } from '../../services/database/entryAuditDb';
import { getOwnStaffProfile, accountPhotoUri } from '../../services/database/staffDb';
import type { StaffRecord } from '../../types/staff.types';
import { todayDate, localDate } from '../../utils/dates';
import { color, brandGradient, space, radius, type as typeScale, hairline, iconSize, touchTarget } from '../../theme/tokens';
import { Screen, Card, Row, SectionHeader, Button, AmountText, Icon, IconName } from '../../components/ui/primitives';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';

/**
 * Every book reachable without scrolling — this replaces the horizontally-scrolling
 * chip bar, where anything past the screen edge was permanently hidden.
 *
 * Khata is deliberately absent: it has its own tab in the bottom bar, and listing it
 * twice would make the grid look like the complete set when it isn't.
 *
 * Order follows how often a shopkeeper reaches for each one, so the two heaviest
 * (cash, then stock) sit first.
 */
const BOOKS: { key: string; label: TKey; icon: IconName; route: string }[] = [
  { key: 'cash',     label: 'cashBook',     icon: 'dollar-sign',   route: 'CashBook' },
  { key: 'stock',    label: 'stockBook',    icon: 'package',       route: 'StockBook' },
  { key: 'bill',     label: 'billBook',     icon: 'file-text',     route: 'BillBook' },
  { key: 'expense',  label: 'expenseBook',  icon: 'credit-card',   route: 'ExpensesTab' },
  { key: 'purchase', label: 'purchaseBook', icon: 'shopping-cart', route: 'PurchaseBook' },
  { key: 'staff',    label: 'staffBook',    icon: 'users',         route: 'StaffBook' },
  { key: 'customer', label: 'customerBook', icon: 'user',          route: 'CustomerBook' },
];

const initialsOf = (name?: string | null) =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export const AdminDashboard = ({ navigation }: any) => {
  const { t } = useLanguageStore();
  const user = useAuthStore(state => state.user);
  const metrics = useDashboardStore(state => state.metrics);
  const refreshDashboard = useDashboardStore(state => state.refreshDashboard);

  const [today, setToday] = useState({ cashIn: 0, cashOut: 0 });
  const [edits, setEdits] = useState<{ count: number; actor: string } | null>(null);
  // The profile an admin filled in for this account. Settings reads the same pair so the
  // header photo and the Settings photo can never disagree.
  const [ownProfile, setOwnProfile] = useState<StaffRecord | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    refreshDashboard(user.id);
    // Deliberately not awaited inside the try below: a missing staff profile is normal
    // for an owner, and it must never stop the day totals from loading.
    getOwnStaffProfile(user.id)
      .then(setOwnProfile)
      .catch(e => { if (__DEV__) console.error('[Home] own staff profile failed:', e); });
    try {
      const day = todayDate();
      const { dayTotals } = await getDayBook(user.id, day);
      setToday({ cashIn: dayTotals.cashIn, cashOut: dayTotals.cashOut });

      // entry_audit is field-level and grouped by change_group_id, so one edited
      // entry can be several rows — count the groups, not the rows.
      const audit = await getVisibleEntryAudit();
      const groupsToday = new Set<string>();
      let latestActor = '';
      let latestAt = '';
      for (const row of audit) {
        if (localDate(new Date(row.changed_at)) !== day) continue;
        groupsToday.add(row.change_group_id);
        if (!latestAt || row.changed_at > latestAt) {
          latestAt = row.changed_at;
          latestActor = row.actor_name;
        }
      }
      setEdits(groupsToday.size ? { count: groupsToday.size, actor: latestActor } : null);
    } catch (err) {
      if (__DEV__) console.error('[Home] load failed:', err);
    }
  }, [user, refreshDashboard]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const receivable = metrics.totalLena;
  // Grouped per currency now, so "is anything owed" is a question about every line.
  const unpaidBills = metrics.pendingPayments.some(t => t.amount > 0);
  const nothingToAct = receivable <= 0 && !edits;

  return (
    <Screen padded={false}>
      {/* Header */}
      <View style={styles.header}>
        <CustomerAvatar
          name={user?.businessName || user?.name || '?'}
          initials={initialsOf(user?.businessName || user?.name)}
          uri={accountPhotoUri(user?.pictureUrl, ownProfile)}
          style={styles.avatar}
          textStyle={styles.avatarText}
        />
        <Text style={styles.businessName} numberOfLines={1}>
          {user?.businessName || user?.name || 'My business'}
        </Text>
        <Pressable
          onPress={() => navigation.navigate('GlobalSearch')}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel={t('dashSearch')}
        >
          <Icon name="search" size={iconSize.md} tint={color.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('SyncCenter')}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel={t('dashSync')}
        >
          <Icon name="refresh-cw" size={iconSize.md} tint={color.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('RemindersCenter')}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel={t('dashReminders')}
        >
          <Icon name="bell" size={iconSize.md} tint={color.textSecondary} />
        </Pressable>
      </View>

      {/* Hero — the one gradient surface in the app */}
      <LinearGradient
        colors={brandGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <Text style={styles.heroLabel}>{t('dashCashInHand')}</Text>
        <AmountText paisa={metrics.cashInDrawer} size="hero" style={styles.heroFigure} />

        <View style={styles.heroTodayRow}>
          <View style={styles.heroTodayItem}>
            <Icon name="arrow-down-left" size={iconSize.sm} tint={color.onBrand} />
            <Text style={styles.heroTodayLabel}>{t('dashIn')}</Text>
            <AmountText paisa={today.cashIn} size="label" style={styles.heroTodayFigure} />
          </View>
          <View style={styles.heroTodayItem}>
            <Icon name="arrow-up-right" size={iconSize.sm} tint={color.onBrand} />
            <Text style={styles.heroTodayLabel}>{t('dashOut')}</Text>
            <AmountText paisa={today.cashOut} size="label" style={styles.heroTodayFigure} />
          </View>
          <Text style={styles.heroTodayWhen}>{t('dashToday')}</Text>
        </View>

        <View style={styles.heroActions}>
          <Button
            label={t('dashCashIn')}
            variant="onBrand"
            style={styles.heroButton}
            onPress={() => navigation.navigate('CashInModal', { mode: 'in', date: todayDate() })}
          />
          <Button
            label={t('dashCashOut')}
            variant="onBrandQuiet"
            style={styles.heroButton}
            onPress={() => navigation.navigate('CashOutModal', { mode: 'out', date: todayDate() })}
          />
        </View>
      </LinearGradient>

      {/* Books — 4 × 2, nothing hidden off-screen */}
      <View style={styles.section}>
        <SectionHeader title={t('dashBooks')} />
        <View style={styles.grid}>
          {BOOKS.map(book => (
            <Pressable
              key={book.key}
              onPress={() => navigation.navigate(book.route)}
              style={styles.gridCell}
              accessibilityRole="button"
              accessibilityLabel={t(book.label)}
            >
              {({ pressed }) => (
                <>
                  <View style={[styles.tile, pressed && styles.tilePressed]}>
                    <Icon name={book.icon} size={iconSize.lg} tint={color.textSecondary} />
                  </View>
                  <Text style={styles.tileLabel} numberOfLines={2}>{t(book.label)}</Text>
                </>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {/* Needs attention — things to act on, not a chronological log */}
      <View style={styles.section}>
        <SectionHeader title={t('dashNeedsAttention')} />

        {receivable > 0 && (
          <Row
            title={t('dashReceivable')}
            detail={unpaidBills ? t('dashOwedWithBills') : t('dashOwedToYou')}
            icon="clock"
            attention
            // Neutral, not red: red means money out / owed by us. What customers
            // owe is not a loss — the amber outline is what says "act on this".
            trailing={<AmountText paisa={receivable} />}
            onPress={() => navigation.navigate('Khata')}
            style={styles.attentionRow}
          />
        )}

        {!!edits && (
          <Row
            title={t(edits.count === 1 ? 'dashEntryEdited' : 'dashEntriesEdited', { count: edits.count })}
            detail={t('dashEditedBy', { name: edits.actor })}
            icon="edit-2"
            onPress={() => navigation.navigate('ActivityLog')}
            style={styles.attentionRow}
          />
        )}

        {nothingToAct && (
          <Card tone="outlined">
            <Text style={styles.emptyText}>{t('dashNothingToAct')}</Text>
          </Card>
        )}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised,
    borderWidth: hairline,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typeScale.label, color: color.textSecondary },
  // flex: 1 so a long Urdu business name takes the room rather than shoving the bell off.
  businessName: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  headerAction: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  hero: {
    marginHorizontal: space.lg,
    borderRadius: radius.lg,
    padding: space.xl,
  },
  heroLabel: { ...typeScale.label, color: color.onBrandMuted },
  heroFigure: { color: color.onBrand, marginTop: space.xs },
  heroTodayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.sm,
  },
  heroTodayItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  heroTodayLabel: { ...typeScale.caption, color: color.onBrandMuted },
  heroTodayFigure: { color: color.onBrand },
  heroTodayWhen: { ...typeScale.caption, color: color.onBrandMuted },
  heroActions: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  heroButton: { flex: 1 },

  section: { paddingHorizontal: space.lg, paddingTop: space.xxl },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // A quarter each, with breathing room applied inside — avoids gap rounding
  // leaving a fifth tile half-wrapped onto the next line.
  gridCell: { width: '25%', paddingHorizontal: space.xs, paddingBottom: space.lg, alignItems: 'center' },
  tile: {
    alignSelf: 'stretch',
    height: 56,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    borderWidth: hairline,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePressed: { backgroundColor: color.surfacePressed },
  // No fixed width and two lines allowed: Urdu book names run far longer.
  tileLabel: { ...typeScale.caption, color: color.textSecondary, marginTop: space.sm, textAlign: 'center' },

  attentionRow: { marginBottom: space.sm },
  emptyText: { ...typeScale.body, color: color.textMuted },
});
