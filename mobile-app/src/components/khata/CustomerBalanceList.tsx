import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useLanguageStore } from '../../store/useLanguageStore';
import { getPartyBalances, PartyBalance, PartyCursor } from '../../services/database/transactionDb';
import { PAGE_SIZE } from '../../services/database/pagination';
import { AmountText, Icon } from '../ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * The customer list with balances — the main Khata view.
 *
 * DENSE on purpose: a shopkeeper should see six or more people without scrolling, so a
 * row is one line of name over one line of figure, not a card. The row still clears the
 * 44dp touch minimum.
 *
 * Colour carries meaning only: a debit balance is red (they owe the shop), a credit
 * balance green (the shop owes them), and ZERO is neutral ink — a settled customer is
 * not a state worth colouring. The word beside the figure says the same thing, so colour
 * is never the only signal.
 *
 * Paging and search are both SQL (see getPartyBalances); nothing is filtered in memory.
 */
export const CustomerBalanceList = ({ userId, search, viewAs, onOpen, onCountChange }: {
  userId: string;
  search: string;
  viewAs?: { userId: string; name: string };
  onOpen: (party: PartyBalance) => void;
  /** Lets the host show an empty state without duplicating the query. */
  onCountChange?: (n: number) => void;
}) => {
  const t = useLanguageStore(s => s.t);
  const [rows, setRows] = useState<PartyBalance[]>([]);
  const [cursor, setCursor] = useState<PartyCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await getPartyBalances(userId, { search, limit: PAGE_SIZE }, viewAs?.userId);
      setRows(page.rows);
      setCursor(page.nextCursor);
      onCountChange?.(page.rows.length);
    } finally {
      setLoading(false);
    }
  }, [userId, search, viewAs?.userId]);

  // Search is a SQL query, so a keystroke re-runs it. Debounced, so a fast typist
  // fires one query rather than one per character.
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  // AND whenever the screen comes back into focus.
  //
  // Without this the list kept the balances from its last mount, so adding a khata
  // entry and returning showed money that had already been paid — the customer list
  // and that customer's own ledger disagreed about the same person. The screen this
  // component replaced had navigation.addListener('focus', …); extracting it dropped
  // that, and nothing failed, because balances are only wrong AFTER a write.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getPartyBalances(userId, { search, limit: PAGE_SIZE, after: cursor }, viewAs?.userId);
      setRows(prev => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const renderRow = ({ item }: { item: PartyBalance }) => {
    const owed = item.netBalance;
    const tone = owed > 0 ? 'out' : owed < 0 ? 'in' : 'neutral';
    return (
      <Pressable
        onPress={() => onOpen(item)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.nameWrap}>
          <Text style={styles.name} numberOfLines={1}>{item.partyName}</Text>
          {!!item.phone && <Text style={styles.phone} numberOfLines={1}>{item.phone}</Text>}
        </View>
        <View style={styles.amountWrap}>
          <AmountText paisa={Math.abs(owed)} tone={tone} size="body" />
          {/* The word, so colour is never the only thing carrying the meaning. */}
          <Text style={[styles.tag, owed > 0 ? styles.tagOut : owed < 0 ? styles.tagIn : styles.tagFlat]}>
            {owed > 0 ? t('khataLena') : owed < 0 ? t('khataDena') : t('khataSettled')}
          </Text>
        </View>
      </Pressable>
    );
  };

  if (loading && rows.length === 0) {
    return <View style={styles.center}><ActivityIndicator color={color.accent} /></View>;
  }

  if (rows.length === 0) {
    // Never a blank screen: say what is missing and where to fix it.
    return (
      <View style={styles.center}>
        <Icon name="users" size={40} tint={color.textMuted} />
        <Text style={styles.emptyTitle}>
          {search ? t('khataNoCustomerMatch') : viewAs ? t('khataNoCustomersOther', { name: viewAs.name }) : t('khataNoCustomers')}
        </Text>
        {!search && !viewAs && <Text style={styles.emptyHint}>{t('khataAddInCustomerBook')}</Text>}
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      renderItem={renderRow}
      // A legacy row has no id, so the name completes the key; the two cannot collide
      // because a legacy row only exists when no customer carries that name.
      keyExtractor={item => (item.customerId ?? 'legacy') + ':' + item.partyName}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      contentContainerStyle={styles.listContent}
      refreshing={loading}
      onRefresh={load}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={color.accent} /> : null}
      keyboardShouldPersistTaps="handled"
    />
  );
};

const styles = StyleSheet.create({
  // Dense: name over phone on the left, figure over its word on the right. minHeight
  // keeps it tappable while six rows still fit above the fold on a small phone.
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    minHeight: touchTarget, paddingVertical: space.sm, paddingHorizontal: space.lg,
    backgroundColor: color.surface,
  },
  rowPressed: { backgroundColor: color.surfacePressed },
  // flex so a long Urdu name takes the room and pushes nothing off the edge.
  nameWrap: { flex: 1, minWidth: 0 },
  name: { ...typeScale.bodyMedium, color: color.textPrimary },
  phone: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  // flexShrink: 0 so the figure never clips, whatever the name does.
  amountWrap: { alignItems: 'flex-end', flexShrink: 0 },
  tag: { ...typeScale.caption, marginTop: 2 },
  tagOut: { color: color.moneyOut },
  tagIn: { color: color.moneyIn },
  tagFlat: { color: color.textMuted },
  sep: { height: hairline, backgroundColor: color.border, marginLeft: space.lg },
  listContent: { paddingBottom: space.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.sm },
  emptyTitle: { ...typeScale.bodyMedium, color: color.textPrimary, textAlign: 'center' },
  emptyHint: { ...typeScale.body, color: color.textSecondary, textAlign: 'center' },
  footer: { paddingVertical: space.lg },
});
