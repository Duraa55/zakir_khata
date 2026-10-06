import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useSyncStore } from '../../store/useSyncStore';
import { getDatabase } from '../../services/database/db';
import { format } from 'date-fns';
import { Icon, Button, Card } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { IS_FIREBASE_CONFIGURED } from '../../services/firebase/firebaseConfig';

type Props = StackScreenProps<any, any>;

interface SyncQueueItem {
  id: string;
  table_name: string;
  operation: string;
  status: string;
  error_message: string;
  created_at: string;
  retry_count: number;
}

interface SyncMetadata {
  table_name: string;
  last_synced_at: string;
  pending_count: number;
}

const tableLabel = (t: string) => {
  const s = (t || '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};
const opLabel = (op: string) => (op ? op.charAt(0).toUpperCase() + op.slice(1).toLowerCase() : op);
const when = (iso: string, pattern: string) => { try { return format(new Date(iso), pattern); } catch { return ''; } };

export const SyncCenterScreen: React.FC<Props> = ({ navigation }) => {
  const { isOnline, isSyncing, processSyncQueue } = useSyncStore();
  const { t } = useLanguageStore();
  const [queueItems, setQueueItems] = useState<SyncQueueItem[]>([]);
  const [metadata, setMetadata] = useState<SyncMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSyncData = async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      // Pending and failed only — dismissed rows are kept on the phone but not shown.
      const queue = await db.getAllAsync<SyncQueueItem>(
        `SELECT id, table_name, operation, status, error_message, created_at, retry_count
         FROM sync_queue
         WHERE status IN ('pending', 'failed')
         ORDER BY created_at DESC
         LIMIT 50`
      );
      setQueueItems(queue);
      const meta = await db.getAllAsync<SyncMetadata>(
        `SELECT table_name, last_synced_at, pending_count FROM sync_metadata`
      );
      setMetadata(meta);
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadSyncData);
    return unsubscribe;
  }, [navigation]);

  const handleManualSync = async () => {
    await processSyncQueue();
    await loadSyncData();
  };

  /**
   * Stop retrying the failed uploads. They are marked 'dismissed', NOT deleted: the
   * entries themselves are untouched on this phone — only their upload is given up.
   * (This used to hard-delete the queue rows with no warning.)
   */
  const handleDismissAllFailed = () => {
    Alert.alert(
      t('syncStopTitle'),
      t('syncStopBody'),
      [
        { text: t('commonCancel'), style: 'cancel' },
        {
          text: t('syncStopRetrying'), style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDatabase();
              await db.runAsync(`UPDATE sync_queue SET status = 'dismissed' WHERE status = 'failed'`);
              await loadSyncData();
            } catch (err) {
              if (__DEV__) console.error('Failed to dismiss items:', err);
            }
          },
        },
      ]
    );
  };

  const failedItems = queueItems.filter(q => q.status === 'failed');
  const pendingItems = queueItems.filter(q => q.status === 'pending');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('syncTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadSyncData} tintColor={color.accent} />}
      >
        {/* Connection — offline is something to be aware of (amber), not money (red). */}
        <Card tone="outlined" style={styles.statusCard}>
          <View style={styles.statusIcon}>
            <Icon name={isOnline ? 'wifi' : 'wifi-off'} size={iconSize.lg} tint={isOnline ? color.textSecondary : color.attention} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.statusLabel}>{t('syncNetwork')}</Text>
            <Text style={[styles.statusValue, !isOnline && styles.attentionText]}>
              {/* Being online says nothing about whether sync EXISTS. */}
              {!IS_FIREBASE_CONFIGURED ? t('syncNotSetUp') : isOnline ? t('syncOnline') : t('syncOffline')}
            </Text>
          </View>
        </Card>

        <View style={styles.tiles}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>{t('syncWaiting')}</Text>
            <Text style={styles.tileValue}>{pendingItems.length}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>{t('syncFailed')}</Text>
            <Text style={[styles.tileValue, failedItems.length > 0 && styles.attentionText]}>{failedItems.length}</Text>
          </View>
        </View>

        {isSyncing ? (
          <View style={styles.syncing}><ActivityIndicator color={color.accent} /><Text style={styles.statusLabel}>{t('syncSyncing')}</Text></View>
        ) : (
          <Button label={t('syncNow')} icon="refresh-cw" onPress={handleManualSync} disabled={!isOnline} fullWidth />
        )}

        {failedItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Icon name="alert-triangle" size={iconSize.sm} tint={color.attention} />
              <Text style={styles.sectionTitle}>{t('syncFailedUploads')}</Text>
              <TouchableOpacity onPress={handleManualSync} style={styles.linkBtn}><Text style={styles.linkText}>{t('syncRetryAll')}</Text></TouchableOpacity>
              <TouchableOpacity onPress={handleDismissAllFailed} style={styles.linkBtn}><Text style={styles.linkMuted}>{t('syncStopRetrying')}</Text></TouchableOpacity>
            </View>
            {failedItems.map(item => (
              <View key={item.id} style={[styles.item, styles.itemAttention]}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemTitle}>{opLabel(item.operation)} · {tableLabel(item.table_name)}</Text>
                  <Text style={styles.itemMeta}>Tried {item.retry_count}×</Text>
                </View>
                {!!item.error_message && <Text style={styles.itemBody}>{item.error_message}</Text>}
                <Text style={styles.itemMeta}>{when(item.created_at, 'dd MMM, HH:mm')}</Text>
              </View>
            ))}
          </View>
        )}

        {pendingItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Icon name="clock" size={iconSize.sm} tint={color.textSecondary} />
              <Text style={styles.sectionTitle}>{t('syncWaitingToUpload')}</Text>
            </View>
            {pendingItems.map(item => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemTitle}>{opLabel(item.operation)} · {tableLabel(item.table_name)}</Text>
                  <Text style={styles.itemMeta}>{when(item.created_at, 'HH:mm')}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('syncTables')}</Text>
          <Card tone="outlined" padded={false}>
            {metadata.length === 0 ? (
              <Text style={styles.empty}>{t('syncNoHistory')}</Text>
            ) : (
              metadata.map((meta, index) => (
                <View key={meta.table_name} style={[styles.metaRow, index > 0 && styles.metaRowBorder]}>
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle}>{tableLabel(meta.table_name)}</Text>
                    <Text style={styles.itemMeta}>Last synced: {meta.last_synced_at ? when(meta.last_synced_at, 'dd MMM, HH:mm') : 'never'}</Text>
                  </View>
                  {meta.pending_count > 0 && (
                    <Text style={styles.pendingPill}>{meta.pending_count} waiting</Text>
                  )}
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxxl },

  statusCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  statusIcon: {
    width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  statusLabel: { ...typeScale.label, color: color.textSecondary },
  statusValue: { ...typeScale.bodyMedium, color: color.textPrimary, marginTop: 2 },
  attentionText: { color: color.attention },

  tiles: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  tile: {
    flex: 1, backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md,
    borderWidth: hairline, borderColor: color.border, alignItems: 'center', gap: space.xs,
  },
  tileLabel: { ...typeScale.label, color: color.textSecondary },
  tileValue: { ...typeScale.title, fontSize: 28, color: color.textPrimary },
  syncing: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', minHeight: touchTarget },

  section: { marginTop: space.xl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm, flexWrap: 'wrap' },
  sectionTitle: { ...typeScale.heading, color: color.textPrimary, flex: 1 },
  linkBtn: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: space.xs },
  linkText: { ...typeScale.bodyMedium, color: color.accent },
  linkMuted: { ...typeScale.bodyMedium, color: color.textSecondary },

  item: {
    backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    borderWidth: hairline, borderColor: color.border, gap: space.xs,
  },
  itemAttention: { borderColor: color.borderAttention },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  itemTitle: { ...typeScale.bodyMedium, color: color.textPrimary, flexShrink: 1 },
  itemBody: { ...typeScale.label, color: color.textSecondary },
  itemMeta: { ...typeScale.caption, color: color.textMuted },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  metaRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  pendingPill: {
    ...typeScale.caption, color: color.attention, borderWidth: hairline, borderColor: color.borderAttention,
    borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, overflow: 'hidden',
  },
  empty: { ...typeScale.body, color: color.textMuted, padding: space.lg },
});
