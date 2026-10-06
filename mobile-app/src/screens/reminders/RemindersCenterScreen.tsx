import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, Alert, Linking, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { Reminder, getReminders, updateReminderStatus, deleteReminder } from '../../services/database/reminderDb';
import { getUnpaidBills } from '../../services/database/billDb';
import { formatCurrency } from '../../utils/calculations';
import { internationalPhone } from '../../utils/phone';
import { format, isPast, isToday } from 'date-fns';
import { Icon, IconName } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

type Props = StackScreenProps<any, any>;

const TYPE_ICON: Record<string, IconName> = {
  payment: 'dollar-sign', rent: 'home', utility: 'zap', low_stock: 'package', invoice: 'file-text', backup: 'hard-drive',
};

/** A reminder shown for an unpaid bill — read-only, derived from the bill itself. */
type BillReminder = Reminder & { phone?: string | null };

export const RemindersCenterScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [reminders, setReminders] = useState<BillReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');

  const loadReminders = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getReminders(user.id, activeTab);
      // Unpaid posted bills appear as invoice reminders under Pending only — a paid bill
      // is not a reminder. (This used to load EVERY bill with all its lines and filter in
      // JavaScript, drafts and holds included.)
      const bills = activeTab === 'pending' ? await getUnpaidBills(user.id) : [];
      const mappedBills: BillReminder[] = bills.map(b => ({
        id: `bill_ref_${b.id}`,
        user_id: b.user_id,
        title: b.party_name || 'Customer',
        description: `Bill #${b.bill_no} · total ${formatCurrency(b.total)} · due ${formatCurrency(b.due)}`,
        type: 'invoice',
        due_date: b.bill_date,
        status: 'pending',
        synced: 1,
        is_deleted: 0,
        deleted_at: null,
        created_at: b.created_at || b.bill_date,
        updated_at: b.created_at || b.bill_date,
        phone: b.party_phone,
      } as BillReminder));
      const combined = [...data, ...mappedBills].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
      setReminders(combined);
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadReminders);
    loadReminders();
    return unsubscribe;
  }, [navigation, activeTab, user]);

  const handleToggleStatus = async (reminder: Reminder) => {
    if (!user) return;
    const newStatus = reminder.status === 'pending' ? 'completed' : 'pending';
    try {
      await updateReminderStatus(reminder.id, user.id, newStatus);
      loadReminders();
    } catch (err) {
      Alert.alert(t('commonError'), t('rcUpdateFailed'));
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(t('rcDelete'), t('rcDeleteConfirm'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (!user) return;
          try {
            await deleteReminder(id, user.id);
            loadReminders();
          } catch (err) {
            Alert.alert(t('commonError'), t('rcDeleteFailed'));
          }
        }
      }
    ]);
  };

  const safeDate = (d: string) => { try { return format(new Date(d), 'dd MMM yyyy'); } catch { return d; } };

  const handleSendReminder = (reminder: BillReminder) => {
    const msg = `Reminder: ${reminder.title}\nDue: ${safeDate(reminder.due_date)}\n${reminder.description || ''}`;
    // Address the customer directly when the bill has their number (international form).
    const intl = internationalPhone(reminder.phone);
    Alert.alert(t('rcSendTitle'), t('rcSendHow'), [
      { text: t('supWhatsApp'), onPress: () => Linking.openURL(`whatsapp://send?${intl ? `phone=${intl}&` : ''}text=${encodeURIComponent(msg)}`).catch(() => Alert.alert(t('remNoWhatsAppTitle'), 'WhatsApp is not installed on this phone.')) },
      { text: t('remSms'), onPress: () => Linking.openURL(`sms:${intl ? '+' + intl : ''}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`) },
      { text: t('commonCancel'), style: 'cancel' },
    ]);
  };

  const renderReminder = (reminder: BillReminder) => {
    const due = new Date(reminder.due_date);
    const isOverdue = isPast(due) && !isToday(due);
    const isDueToday = isToday(due);
    const pending = reminder.status === 'pending';
    // Overdue / due today need attention: amber, never red (red means money).
    const flag = pending && (isOverdue || isDueToday);
    const fromBill = reminder.id.startsWith('bill_ref_');

    return (
      <View key={reminder.id} style={[styles.card, flag && styles.cardAttention]}>
        <View style={styles.cardTop}>
          <View style={styles.iconWrap}>
            <Icon name={TYPE_ICON[reminder.type] || 'bell'} size={iconSize.md} tint={color.textSecondary} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.title} numberOfLines={1}>{reminder.title}</Text>
            {!!reminder.description && <Text style={styles.desc}>{reminder.description}</Text>}
            <Text style={[styles.due, flag && styles.dueAttention]}>
              Due {safeDate(reminder.due_date)}{pending && isOverdue ? ' · overdue' : ''}{pending && isDueToday ? ' · today' : ''}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          {!fromBill && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleToggleStatus(reminder)} accessibilityRole="button">
              <Icon name={pending ? 'check' : 'rotate-ccw'} size={iconSize.sm} tint={color.accent} />
              <Text style={styles.actionText}>{pending ? 'Complete' : 'Undo'}</Text>
            </TouchableOpacity>
          )}
          {pending && ['payment', 'invoice'].includes(reminder.type) && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleSendReminder(reminder)} accessibilityRole="button">
              <Icon name="send" size={iconSize.sm} tint={color.accent} />
              <Text style={styles.actionText}>{t('rcSend')}</Text>
            </TouchableOpacity>
          )}
          <View style={styles.flex} />
          {!fromBill && (
            <TouchableOpacity onPress={() => handleDelete(reminder.id)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('rcDelete')}>
              <Icon name="trash-2" size={iconSize.sm} tint={color.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('rcTitle')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.tabs}>
        {(['pending', 'completed'] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.tabActive]} onPress={() => setActiveTab(t)} accessibilityRole="tab" accessibilityState={{ selected: activeTab === t }}>
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>{t === 'pending' ? 'Pending' : 'Completed'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadReminders} tintColor={color.accent} />}
      >
        {reminders.length === 0 && !loading ? (
          <View style={styles.empty}>
            <Icon name="bell-off" size={40} tint={color.textMuted} />
            <Text style={styles.emptyText}>No {activeTab} reminders</Text>
          </View>
        ) : (
          reminders.map(renderReminder)
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('AddReminder')} accessibilityRole="button" accessibilityLabel={t('rcAdd')}>
        <Icon name="plus" size={iconSize.lg} tint={color.textInverse} />
      </TouchableOpacity>
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
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  tab: {
    flex: 1, minHeight: touchTarget, borderRadius: radius.pill, borderWidth: hairline, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { backgroundColor: color.accent, borderColor: color.accent },
  tabText: { ...typeScale.label, color: color.textSecondary },
  tabTextActive: { color: color.textInverse, fontWeight: typeScale.bodyMedium.fontWeight },
  content: { padding: space.lg, paddingBottom: 120 },
  card: {
    backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  cardAttention: { borderColor: color.borderAttention },
  cardTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  cardText: { flex: 1 },
  title: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  desc: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },
  due: { ...typeScale.label, color: color.textSecondary, marginTop: space.sm },
  dueAttention: { color: color.attention, fontWeight: typeScale.bodyMedium.fontWeight },
  actions: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md,
    paddingTop: space.sm, borderTopWidth: hairline, borderTopColor: color.border,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touchTarget, paddingHorizontal: space.sm },
  actionText: { ...typeScale.bodyMedium, color: color.accent },
  empty: { alignItems: 'center', paddingVertical: 80, gap: space.md },
  emptyText: { ...typeScale.heading, color: color.textSecondary },
  fab: {
    position: 'absolute', bottom: space.xxl, right: space.xxl, width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center',
  },
});
