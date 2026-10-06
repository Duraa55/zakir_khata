import React, { useEffect, useRef } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  Animated, ActivityIndicator, Dimensions, Keyboard, Platform
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useStaffStore } from '../../store/useStaffStore';
import { StaffRecord } from '../../types/staff.types';
import { getDisplayName } from '../../utils/displayName';
import { TopHeaderWithBooks } from '../../components/TopHeaderWithBooks';
import { SummaryBar, SummaryFigure } from '../../components/ui/primitives';
import { CustomerAvatar } from '../../components/ui/CustomerAvatar';
import { staffPhotoUri } from '../../services/database/staffDb';
import { canCreateStaff } from '../../services/database/managedAccountDb';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale, chrome } from '../../theme/tokens';
import { Icon } from '../../components/ui/primitives';

// Defined outside component to avoid recreation on every render
const StaffItem = React.memo(({ item, onPress }: {
  item: StaffRecord;
  onPress: () => void;
}) => {

  return (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={onPress}
    >
      <View style={styles.itemHeader}>
        {/* remote → local copy → initial, the same chain as customer photos */}
        <CustomerAvatar name={item.name_en} uri={staffPhotoUri(item)} style={styles.avatarBox} textStyle={styles.avatarInitial} />
        <View style={styles.itemInfo}>
          <Text style={styles.staffName}>{getDisplayName(item)}</Text>
          <Text style={styles.staffRole}>{item.role} · Joined {new Date(item.joining_date).toLocaleDateString()}</Text>
        </View>
        {/* Salary lives inside staff details ("Salary & cash ledger"); the row opens those. */}
        <Icon name="chevron-right" size={iconSize.sm} tint={color.textMuted} />
      </View>
    </TouchableOpacity>
  );
});

export const StaffBookScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { t } = useLanguageStore();
  const user = useAuthStore(state => state.user);
  const staff = useStaffStore(state => state.staff);
  const loading = useStaffStore(state => state.loading);
  const stats = useStaffStore(state => state.stats);
  const fetchStaff = useStaffStore(state => state.fetchStaff);
  const loadStats = useStaffStore(state => state.loadStats);
  // Two levels: an admin adds a staff member WITH a login; a staff member adds a sub-staff
  // RECORD with no login. The data layer enforces who may do which; the button is only
  // hidden so it never leads to a refusal.
  const [canAdd, setCanAdd] = React.useState(false);
  useEffect(() => { canCreateStaff().then(setCanAdd); }, [user?.id]);

  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);

  const loadData = () => {
    if (!user) return;
    fetchStaff(user.id);
    loadStats(user.id);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation, user]);

  useEffect(() => {
    loadData();
  }, [user]);

  const [isKeyboardVisible, setIsKeyboardVisible] = React.useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const renderItem = React.useCallback(({ item }: { item: StaffRecord }) => {
    return (
      <StaffItem 
        item={item} 
        onPress={() => navigation.navigate('StaffDetailBook', { staff: item })} 
      />
    );
  }, [navigation]);

  return (
    <View style={styles.container}>
      
      {/* Top Header with Profile & Books Bar */}
      <TopHeaderWithBooks navigation={navigation} activeBook="StaffBook" />

      {/* Sub Header */}
      <View style={styles.subHeader}>
        <TouchableOpacity 
          style={styles.pdfBtn} 
          onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'staff' })}
        >
          <Text style={styles.pdfBtnText}>{t('staffPdfReport')}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary — same brand surface as the dashboard and the other books */}
      <SummaryBar>
        <SummaryFigure label={`Active ${stats.active} · Inactive ${stats.inactive}`}>
          <Text style={styles.summaryTitle}>{t('staffTotal')}: {stats.total}</Text>
        </SummaryFigure>
      </SummaryBar>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : staff.length === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: chrome.listBottom, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.xl }}>
          <View style={styles.emptyState}>
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <Text style={styles.instructionText}>{t('staffStep1')}</Text>
              <Text style={styles.instructionText}>{t('staffStep2')}</Text>
              <Text style={styles.instructionText}>{t('staffStep3')}</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={staff}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: space.lg, paddingBottom: chrome.listBottom }}
        />
      )}

      {/* Add Button */}
      {!isKeyboardVisible && canAdd && (
        <View style={[styles.addBtnContainer, { bottom: 0 }]}>
          <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AddStaffModal')} activeOpacity={0.85} accessibilityRole="button">
            <Text style={styles.addBtnText} numberOfLines={1}>{t(user?.role === 'admin' ? 'staffAdd' : 'staffAddSub')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },

  subHeader: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: space.lg, paddingTop: chrome.barPadY,
  },
  pdfBtn: { minHeight: touchTarget, justifyContent: 'center', paddingLeft: space.md },
  pdfBtnText: { ...typeScale.bodyMedium, fontSize: 14, color: color.accent },

  summaryTitle: { ...typeScale.title, color: color.onBrand },

  itemRow: {
    backgroundColor: color.surface, borderRadius: radius.md,
    paddingVertical: chrome.rowPadY, paddingHorizontal: space.lg, marginBottom: chrome.rowGap,
    borderWidth: hairline, borderColor: color.border, minHeight: touchTarget,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  avatarBox: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
    justifyContent: 'center', alignItems: 'center', borderWidth: hairline, borderColor: color.border,
  },
  avatarInitial: { ...typeScale.bodyMedium, color: color.textSecondary },
  // flex: 1 so a long (or Urdu) name wraps before it pushes the chevron off.
  itemInfo: { flex: 1 },
  staffName: { ...typeScale.bodyMedium, color: color.textPrimary },
  staffRole: { ...typeScale.caption, color: color.textSecondary, marginTop: space.xs },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  instructionText: { ...typeScale.label, color: color.textSecondary },

  addBtnContainer: { position: 'absolute', right: space.lg },
  addBtn: {
    backgroundColor: color.accent, minHeight: chrome.fab, paddingHorizontal: space.lg, borderRadius: radius.pill,
    justifyContent: 'center', alignItems: 'center',
  },
  addBtnText: { ...typeScale.bodyMedium, color: color.textInverse },
});
