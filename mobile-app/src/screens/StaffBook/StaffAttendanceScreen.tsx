import React, { useEffect, useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { getStaffRecords } from '../../services/database/staffDb';
import type { StaffRecord } from '../../types/staff.types';
import { getTodayAttendanceForUser, clockIn, clockOut, StaffAttendance } from '../../services/database/attendanceDb';
import { Icon } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';


export const StaffAttendanceScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendance[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const staffList = await getStaffRecords(user.id);
      const attList = await getTodayAttendanceForUser(user.id);
      setStaff(staffList);
      setAttendance(attList);
    } catch (e) {
      if (__DEV__) console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [navigation, user]);

  const handleClockIn = async (staffId: string) => {
    if (!user) return;
    try {
      await clockIn(user.id, staffId, 'present');
      loadData();
    } catch (err) {
      if (__DEV__) console.error(err);
      Alert.alert(t('commonError'), t('attClockInFailed'));
    }
  };

  const handleClockOut = async (attId: string) => {
    if (!user) return;
    try {
      await clockOut(attId, user.id);
      loadData();
    } catch (err) {
      if (__DEV__) console.error(err);
      Alert.alert(t('commonError'), t('attClockOutFailed'));
    }
  };

  const renderItem = ({ item }: { item: StaffRecord }) => {
    const todayAtt = attendance.find(a => a.staff_id === item.id);

    return (
      <View style={styles.card}>
        <View style={styles.infoCol}>
          <Text style={styles.name}>{item.name_en}</Text>
          {!!item.role && <Text style={styles.role}>{item.role}</Text>}
        </View>

        <View style={styles.actionCol}>
          {!todayAtt ? (
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => handleClockIn(item.id)} accessibilityRole="button">
              <Icon name="log-in" size={iconSize.sm} tint={color.textInverse} />
              <Text style={styles.btnTextInverse}>{t('attClockIn')}</Text>
            </TouchableOpacity>
          ) : !todayAtt.clock_out ? (
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => handleClockOut(todayAtt.id)} accessibilityRole="button">
              <Icon name="log-out" size={iconSize.sm} tint={color.accent} />
              <Text style={styles.btnText}>{t('attClockOut')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.done}>
              <Icon name="check-circle" size={iconSize.sm} tint={color.textSecondary} />
              <Text style={styles.doneText}>{t('attShiftDone')}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('attToday')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={color.accent} style={styles.spinner} />
      ) : staff.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="users" size={40} tint={color.textMuted} />
          <Text style={styles.emptyText}>{t('attNoStaff')}</Text>
        </View>
      ) : (
        <FlatList
          data={staff}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderItem}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  spinner: { flex: 1 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  emptyText: { ...typeScale.body, color: color.textSecondary },
  listContent: { padding: space.lg, paddingBottom: 135 },
  card: {
    flexDirection: 'row', backgroundColor: color.surface, padding: space.lg, borderRadius: radius.md, marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border, alignItems: 'center', justifyContent: 'space-between', gap: space.md,
  },
  infoCol: { flex: 1 },
  name: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  role: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },
  actionCol: { alignItems: 'flex-end', flexShrink: 0 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touchTarget, paddingHorizontal: space.lg, borderRadius: radius.md },
  btnPrimary: { backgroundColor: color.accent },
  btnOutline: { borderWidth: hairline, borderColor: color.accent, backgroundColor: color.surface },
  btnText: { ...typeScale.bodyMedium, color: color.accent },
  btnTextInverse: { ...typeScale.bodyMedium, color: color.textInverse },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touchTarget },
  doneText: { ...typeScale.label, color: color.textSecondary },
});
