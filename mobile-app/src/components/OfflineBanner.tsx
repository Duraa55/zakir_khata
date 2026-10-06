import { useLanguageStore } from '../store/useLanguageStore';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSyncStore } from '../store/useSyncStore';
import { IS_FIREBASE_CONFIGURED } from '../services/firebase/firebaseConfig';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './ui/primitives';
import { color, space, hairline, chrome, iconSize, type as typeScale } from '../theme/tokens';

/**
 * Shown across the top while the phone is offline. Amber: it needs attention, nothing is lost.
 *
 * It says where the data IS, never what sync will do for it. The old copy promised
 * "Changes will sync when you're back online" unconditionally — with Firebase
 * unconfigured nothing is ever queued, so that promise was the same false assurance
 * about data safety that Settings and the Sync centre were fixed for (check 135).
 * Branch on IS_FIREBASE_CONFIGURED first, and reuse THEIR strings so the three
 * surfaces cannot drift into saying different things about one fact.
 */
export const OfflineBanner = () => {
  const { t } = useLanguageStore();
  const isOnline = useSyncStore(state => state.isOnline);
  const insets = useSafeAreaInsets();

  if (isOnline) return null;

  const syncExists = IS_FIREBASE_CONFIGURED;

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, chrome.barPadY) }]}>
      <Icon name={syncExists ? 'wifi-off' : 'alert-circle'} size={iconSize.sm} tint={color.attention} />
      <Text style={styles.text}>{t(syncExists ? 'syncOffline' : 'syncNotSetUp')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceRaised, borderBottomWidth: hairline, borderColor: color.borderAttention,
    paddingBottom: chrome.barPadY, paddingHorizontal: space.lg, zIndex: 999,
  },
  text: { ...typeScale.caption, color: color.attention, textAlign: 'center', flexShrink: 1 },
});
