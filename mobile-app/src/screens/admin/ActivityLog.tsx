import React, { useCallback, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useFocusEffect } from '@react-navigation/native';
import { EntryAuditRow, getVisibleEntryAudit } from '../../services/database/entryAuditDb';
import { EntryHistoryModal, AuditFields, groupAuditRows } from '../../components/ui/EntryHistory';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useActivityStore } from '../../store/useActivityStore';
import { ActivityLog } from '../../types/activity.types';
import { Icon, AmountText, IconName } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

export const ActivityLogScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { activities, loading, loadingMore, cursor, fetchActivities, loadMoreActivities } = useActivityStore();

  const [auditRows, setAuditRows] = useState<EntryAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [selected, setSelected] = useState<EntryAuditRow | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    setAuditRows([]);
    setSelected(null);
    setAuditError('');
    if (user) {
      fetchActivities(user.id);
      setAuditLoading(true);
      getVisibleEntryAudit().then(rows => { if (active) setAuditRows(rows); })
        .catch(e => { if (active) setAuditError(e?.message || 'Could not load entry history.'); })
        .finally(() => { if (active) setAuditLoading(false); });
    }
    return () => { active = false; };
  }, [user?.id, fetchActivities]));
  type FeedItem = { id: string; timestamp: string; activity?: ActivityLog; audit?: EntryAuditRow[] };
  // Activities are paged (oldest loaded = the page boundary); audit groups are merged in
  // only down to that boundary so the feed stays in one chronological sequence while
  // older activity is still being loaded. Once the last page is in, everything shows.
  const oldestLoaded = cursor ? activities[activities.length - 1]?.timestamp ?? '' : '';
  const feed: FeedItem[] = [
    ...activities.map(activity => ({ id: activity.id, timestamp: activity.timestamp, activity })),
    ...groupAuditRows(auditRows).map(audit => ({ id: audit[0].change_group_id, timestamp: audit[0].changed_at, audit }))
      .filter(item => !oldestLoaded || item.timestamp >= oldestLoaded),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const ENTITY_ICON: Record<string, IconName> = {
    cash: 'dollar-sign', stock: 'package', bill: 'file-text', staff: 'users', expense: 'credit-card', auth: 'key', supplier: 'truck',
  };

  const renderItem = ({ item }: { item: ActivityLog }) => (
    <View style={styles.logCard}>
      <View style={styles.iconWrap}>
        <Icon name={ENTITY_ICON[item.entity_type] || 'activity'} size={iconSize.md} tint={color.textSecondary} />
      </View>
      <View style={styles.logContent}>
        <Text style={styles.logText}>
          <Text style={styles.actor}>{item.user_name}</Text> {item.description}
        </Text>
        <View style={styles.logBottomRow}>
          {item.amount ? <AmountText paisa={item.amount} size="label" tone={item.entity_type === 'expense' ? 'out' : 'neutral'} /> : <View />}
          <Text style={styles.timestamp}>
            {new Date(item.timestamp).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('alTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.filterBar}>
        <Text style={styles.filterText}>{t('alSubtitle')}</Text>
      </View>

      {!!auditError && <Text style={styles.error}>{auditError}</Text>}
      {loading || auditLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : feed.length === 0 ? (
        <View style={styles.center}>
          <Icon name="activity" size={40} tint={color.textMuted} />
          <Text style={styles.emptyText}>{t('alEmpty')}</Text>
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={item => item.id}
          renderItem={({ item }) => item.audit ? (
            <TouchableOpacity style={styles.logCard} onPress={() => setSelected(item.audit![0])}>
              <View style={styles.iconWrap}>
                <Icon name="edit-3" size={iconSize.md} tint={color.attention} />
              </View>
              <View style={styles.logContent}>
                <Text style={styles.logText}><Text style={styles.actor}>{item.audit[0].actor_name}</Text> {item.audit[0].action} a Khata entry</Text>
                <AuditFields rows={item.audit} />
                <Text style={styles.timestamp}>{new Date(item.timestamp).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                <View style={styles.linkRow}>
                  <Text style={styles.link}>{t('alViewEntry')}</Text>
                  <Icon name="chevron-right" size={iconSize.sm} tint={color.accent} />
                </View>
              </View>
            </TouchableOpacity>
          ) : renderItem({ item: item.activity! })}
          contentContainerStyle={styles.listContent}
          onEndReached={() => { if (user) loadMoreActivities(user.id); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={color.accent} /> : null}
        />
      )}
      {selected && <EntryHistoryModal table={selected.book_table} entryId={selected.entry_id} visible={true} onClose={() => setSelected(null)} />}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  filterBar: { backgroundColor: color.surfaceRaised, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: hairline, borderBottomColor: color.border },
  filterText: { ...typeScale.label, color: color.textSecondary },
  error: { ...typeScale.body, padding: space.md, color: color.attention },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  emptyText: { ...typeScale.body, color: color.textSecondary },
  listContent: { padding: space.md },
  footerSpinner: { margin: space.lg },
  logCard: {
    flexDirection: 'row', gap: space.md, backgroundColor: color.surface, padding: space.md, borderRadius: radius.md,
    marginBottom: space.sm, borderWidth: hairline, borderColor: color.border,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center',
    backgroundColor: color.surfaceRaised,
  },
  logContent: { flex: 1, gap: space.xs },
  logText: { ...typeScale.body, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  actor: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },
  logBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  timestamp: { ...typeScale.caption, color: color.textMuted },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: touchTarget },
  link: { ...typeScale.bodyMedium, fontSize: 14, color: color.accent },
});
