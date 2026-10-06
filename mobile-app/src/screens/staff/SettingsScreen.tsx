import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Alert, ScrollView,
  Image, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/useSyncStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { IS_FIREBASE_CONFIGURED } from '../../services/firebase/firebaseConfig';
import { useNavigation } from '@react-navigation/native';
import { Icon } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { persistAttachment } from '../../utils/durableFile';
import { getOwnStaffProfile, accountPhotoUri } from '../../services/database/staffDb';
import { StaffRecord } from '../../types/staff.types';
import { documentLabel } from '../../utils/customerPhoto';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';

const RadioDot = ({ active }: { active: boolean }) => (
  <View
    style={[
      styles.radioDot,
      active && styles.radioDotActive,
    ]}
  >
    {active && <View style={styles.radioDotInner} />}
  </View>
);

export const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { user, logout, updateProfilePicture } = useAuthStore();
  const { isOnline, pendingCount, isSyncing, processSyncQueue } = useSyncStore();
  const { language, setLanguage, t } = useLanguageStore();
  const [uploadingPic, setUploadingPic] = useState(false);
  // One shared opener, same as Staff Book: images preview in-app, other files go to
  // the phone, a missing file says so.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();

  // The profile an admin filled in for this account, if this account is someone's staff.
  // It holds the photo and the documents the admin attached; `users` holds neither.
  const [ownProfile, setOwnProfile] = useState<StaffRecord | null>(null);
  useEffect(() => {
    if (!user?.id) { setOwnProfile(null); return; }
    let active = true;
    getOwnStaffProfile(user.id)
      .then(p => { if (active) setOwnProfile(p); })
      .catch(e => { if (__DEV__) console.error('[Settings] own staff profile failed:', e); });
    return () => { active = false; };
  }, [user?.id]);

  // Own picture wins; the admin's photo shows until this account sets one.
  const avatarUri = accountPhotoUri(user?.pictureUrl, ownProfile);
  const ownDocuments = ownProfile?.document_urls ?? [];

  const handlePickProfilePic = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('setPermissionTitle'),
        t('setPermissionBody'),
        [{ text: t('commonOk') }],
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
    });

    if (result.canceled || !result.assets?.length) return;

    const uri = result.assets[0].uri;
    if (!user?.id) return;

    setUploadingPic(true);
    try {
      // Durable copy first — the picker's cache path can vanish (see durableFile.ts).
      const durable = await persistAttachment('profile', uri);
      await updateProfilePicture(user.id, durable);
    } finally {
      setUploadingPic(false);
    }
  };

  const handleSync = async () => {
    if (!IS_FIREBASE_CONFIGURED) {
      Alert.alert(t('setSyncUnavailableTitle'), t('setSyncUnavailableBody'));
      return;
    }
    if (!isOnline) {
      Alert.alert(t('setOfflineTitle'), t('setOfflineBody'));
      return;
    }
    await processSyncQueue();
    Alert.alert(t('setSyncDoneTitle'), t('setSyncDoneBody'));
  };

  const handleLogout = () => {
    Alert.alert(t('setLogout'), t('setLogoutConfirm'), [
      { text: t('commonCancel'), style: 'cancel' },
      { text: t('setLogout'), style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('setTitle')}</Text>
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.scrollContent}>

        {/* ── Account Section ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('setAccount')}</Text>
          <View style={styles.profileRow}>
            {/* Profile picture */}
            <TouchableOpacity
              onPress={handlePickProfilePic}
              disabled={uploadingPic}
              style={styles.avatarWrap}
              accessibilityRole="button"
              accessibilityLabel={t('setChangePicture')}
            >
              {uploadingPic ? (
                <View style={[styles.avatarCircle, styles.avatarPlaceholder]}>
                  <ActivityIndicator size="small" color={color.accent} />
                </View>
              ) : avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.avatarCircle}
                />
              ) : (
                <View style={[styles.avatarCircle, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>
                    {user?.name?.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              {/* Camera badge */}
              <View style={styles.cameraBadge}>
                <Icon name="camera" size={12} tint={color.textInverse} />
              </View>
            </TouchableOpacity>

            <View style={styles.profileText}>
              <Text style={styles.userName}>{user?.name}</Text>
              <Text style={styles.userPhone}>{user?.phone}</Text>
              {user?.businessName && (
                <Text style={styles.userBiz}>{user.businessName}</Text>
              )}
            </View>
          </View>

          <TouchableOpacity
            style={styles.changePasswordBtn}
            onPress={() => navigation.navigate('ChangePassword')}
          >
            <Icon name="lock" size={iconSize.sm} tint={color.accent} />
            <Text style={styles.changePasswordText}>{t('setChangePassword')}</Text>
          </TouchableOpacity>
          {/* Staff and sub-staff are added and removed in Staff Book (Add staff / Remove),
              which creates the login and the staff profile together. */}

          {/* DEV-ONLY testing tool — never rendered in a release build. */}
          {__DEV__ && user?.role === 'admin' && (
            <TouchableOpacity
              style={[styles.changePasswordBtn, styles.devBtn]}
              onPress={() => Alert.alert(
                t('setWipeTitle'),
                t('setWipeBody'),
                [
                  { text: t('commonCancel'), style: 'cancel' },
                  {
                    text: t('setWipe'), style: 'destructive',
                    onPress: async () => {
                      try {
                        const { wipeNonAdminStaffForTesting } = await import('../../services/database/devWipe');
                        const r = await wipeNonAdminStaffForTesting();
                        Alert.alert(t('setWipedTitle'), t('setWipedBody', { users: r.users, records: r.staffRecords }));
                      } catch (e: any) {
                        Alert.alert(t('commonError'), e?.message || t('setWipeFailed'));
                      }
                    },
                  },
                ]
              )}
            >
              <Icon name="alert-triangle" size={iconSize.sm} tint={color.attention} />
              <Text style={styles.devText}>{t('setDevWipe')}</Text>
            </TouchableOpacity>
          )}

          {/* DEV-ONLY — removes the retired sub-staff LEVEL. Their profiles survive as
              no-login records; only the logins and the rows they wrote go. */}
          {__DEV__ && user?.role === 'admin' && (
            <TouchableOpacity
              style={[styles.changePasswordBtn, styles.devBtn]}
              onPress={() => Alert.alert(
                t('setWipeSubTitle'),
                t('setWipeSubBody'),
                [
                  { text: t('commonCancel'), style: 'cancel' },
                  {
                    text: t('setWipe'), style: 'destructive',
                    onPress: async () => {
                      try {
                        const { wipeSubStaffLoginsForTesting } = await import('../../services/database/devWipe');
                        const r = await wipeSubStaffLoginsForTesting();
                        const rows = Object.entries(r.entries).reduce((sum, [, n]) => sum + n, 0);
                        Alert.alert(
                          t('setWipedTitle'),
                          t('setWipedSubBody', { logins: r.logins, records: r.unlinkedRecords, rows }),
                        );
                      } catch (e: any) {
                        Alert.alert(t('commonError'), e?.message || t('setWipeFailed'));
                      }
                    },
                  },
                ]
              )}
            >
              <Icon name="alert-triangle" size={iconSize.sm} tint={color.attention} />
              <Text style={styles.devText}>{t('setDevWipeSub')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── My documents ──
            What the admin attached to this account's staff profile. Read-only: the
            admin owns these, and this account only ever needs to open them. Hidden
            entirely for an admin, who has no staff profile and so no documents. */}
        {ownDocuments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('commonAttachments')}</Text>
            {ownDocuments.map((doc, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.docRow, idx > 0 && styles.docRowBorder]}
                onPress={() => openAttachment(doc)}
                accessibilityRole="button"
                accessibilityLabel={documentLabel(doc)}
              >
                <Icon name="paperclip" size={iconSize.sm} tint={color.textSecondary} />
                <Text style={styles.docText} numberOfLines={1}>{documentLabel(doc)}</Text>
                <Icon name="chevron-right" size={iconSize.sm} tint={color.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── UI Language ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('languageLabel')}</Text>
          <Text style={styles.sectionSubtitle}>{t('languageHelp')}</Text>
          <View style={styles.langRow}>
            <TouchableOpacity
              style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
              onPress={() => setLanguage('en')}
            >
              <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>
                English
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === 'ur' && styles.langBtnActive]}
              onPress={() => setLanguage('ur')}
            >
              <Text style={[styles.langBtnText, language === 'ur' && styles.langBtnTextActive]}>
                اردو
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Sync Status ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('setSyncStatus')}</Text>
          {/* With no Firebase there is no backup at all, and pendingCount is 0 because
              nothing is ever queued — so the screen used to report everything as synced.
              That is a false assurance about data safety: a shopkeeper would believe
              their records were safe off the phone. Say plainly that they are not. */}
          <View style={styles.syncRow}>
            <Icon
              name={!IS_FIREBASE_CONFIGURED ? 'alert-circle' : pendingCount === 0 ? 'check-circle' : 'refresh-cw'}
              size={iconSize.lg}
              tint={!IS_FIREBASE_CONFIGURED || pendingCount > 0 ? color.attention : color.textSecondary}
            />
            <View style={styles.syncText}>
              <Text style={styles.syncStatusText}>
                {!IS_FIREBASE_CONFIGURED
                  ? t('setSyncLocalOnly')
                  : pendingCount === 0 ? t('setSyncAllSynced') : t('setSyncPending', { count: String(pendingCount) })}
              </Text>
              <Text style={styles.syncStatusSub}>
                {!IS_FIREBASE_CONFIGURED
                  ? t('setSyncLocalOnlySub')
                  : pendingCount === 0 ? t('setSyncUpToDate') : t('setSyncWillSync')}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.syncBtn,
              (!isOnline || isSyncing) && styles.syncBtnDisabled,
            ]}
            onPress={handleSync}
            disabled={!isOnline || isSyncing}
          >
            <Text style={[styles.syncBtnText, (!isOnline || isSyncing) && styles.syncBtnTextDisabled]}>
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Icon name="log-out" size={iconSize.sm} tint={color.textPrimary} />
          <Text style={styles.logoutText}>{t('setLogout')}</Text>
        </TouchableOpacity>

      </ScreenContainer>
      {attachmentViewer}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

  header: {
    backgroundColor: color.surface, paddingHorizontal: space.lg, minHeight: 56, justifyContent: 'center',
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  headerTitle: { ...typeScale.title, color: color.textPrimary },

  scrollContent: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: 40 },

  // ── Section ──
  section: {
    backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  sectionLabel: { ...typeScale.label, color: color.textSecondary, marginBottom: space.md },
  // Same row shape as the Staff Book document list, so an attachment looks the same
  // wherever it is opened from.
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, minHeight: touchTarget },
  docRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  docText: { ...typeScale.body, color: color.textPrimary, flex: 1 },
  sectionSubtitle: { ...typeScale.body, color: color.textSecondary, marginBottom: space.md },

  // ── Profile ──
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.md },
  avatarWrap: { position: 'relative' },
  avatarCircle: { width: 64, height: 64, borderRadius: radius.pill, borderWidth: hairline, borderColor: color.border },
  avatarPlaceholder: { backgroundColor: color.surfaceRaised, justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { ...typeScale.title, fontSize: 24, color: color.textPrimary },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: radius.pill,
    backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: color.surface,
  },
  profileText: { flex: 1 },
  userName: { ...typeScale.heading, fontSize: 17, color: color.textPrimary },
  userPhone: { ...typeScale.label, color: color.textSecondary, marginTop: 2 },
  userBiz: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  changePasswordBtn: {
    flexDirection: 'row', gap: space.sm, justifyContent: 'center', alignItems: 'center',
    backgroundColor: color.surface, minHeight: touchTarget, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.borderStrong,
  },
  changePasswordText: { ...typeScale.bodyMedium, color: color.accent },
  devBtn: { marginTop: space.sm, borderColor: color.borderAttention },
  devText: { ...typeScale.bodyMedium, color: color.attention },

  // ── Language ──
  langRow: { flexDirection: 'row', gap: space.md },
  langBtn: {
    flex: 1, minHeight: touchTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: hairline, borderColor: color.borderStrong, backgroundColor: color.surface,
  },
  langBtnActive: { backgroundColor: color.accent, borderColor: color.accent },
  langBtnText: { ...typeScale.bodyMedium, color: color.textSecondary },
  langBtnTextActive: { color: color.textInverse },

  // ── Radio ──
  radioRow: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget, gap: space.md },
  radioDot: {
    width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDotActive: { borderColor: color.accent },
  radioDotInner: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.accent },
  radioLabel: { ...typeScale.body, color: color.textPrimary, flex: 1 },

  // ── Sync ──
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  syncText: { flex: 1 },
  syncStatusText: { ...typeScale.bodyMedium, color: color.textPrimary },
  syncStatusSub: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  syncBtn: {
    backgroundColor: color.surface, minHeight: touchTarget, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', borderWidth: hairline, borderColor: color.borderStrong,
  },
  syncBtnDisabled: { borderColor: color.border },
  syncBtnText: { ...typeScale.bodyMedium, color: color.accent },
  syncBtnTextDisabled: { color: color.textMuted },

  // ── Logout ── (not money, so not red: a plain outlined action)
  logoutBtn: {
    flexDirection: 'row', gap: space.sm, justifyContent: 'center', alignItems: 'center',
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.lg, minHeight: 52,
  },
  logoutText: { ...typeScale.bodyMedium, color: color.textPrimary },
});
