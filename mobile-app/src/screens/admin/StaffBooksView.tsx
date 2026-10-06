import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const ORANGE = '#FF6B35';

export const StaffBooksView = ({ route, navigation }: any) => {
  const { t } = useLanguageStore();
  const staff = route.params?.staff;

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text>{t('staffNotFound')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{staff.name}'s Books</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Read-Only Banner */}
      <View style={styles.banner}>
        <Text style={styles.bannerText}>👁 Viewing {staff.name}'s data (read-only)</Text>
      </View>

      {/* Top Tabs Placeholder */}
      <View style={styles.tabsRow}>
        {['Cash', 'Stock', 'Bill', 'Expense'].map(tab => (
          <View key={tab} style={styles.tab}>
            <Text style={styles.tabText}>{tab}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ textAlign: 'center', color: '#6B7280', marginTop: 40 }}>
          This is a read-only wrapper view. By default, the app applies standard permissions so that the owner/admin sees the combined data in their own books if desired, or we can render exact read-only duplicates of the 5 books here.
        </Text>
      </ScrollView>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F4F6' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: ORANGE, paddingHorizontal: 16, height: 60,
  },
  backBtn: { width: 40, justifyContent: 'center' },
  backArrow: { fontSize: 24, color: '#fff', fontWeight: '400' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },

  banner: { backgroundColor: '#FEF3C7', padding: 10, alignItems: 'center' },
  bannerText: { color: '#92400E', fontSize: 13, fontWeight: '500' },

  tabsRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { fontSize: 13, color: '#4B5563', fontWeight: '500' }
});
