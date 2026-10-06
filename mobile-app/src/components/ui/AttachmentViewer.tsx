import React, { useCallback, useState } from 'react';
import { Modal, View, Text, Image, TouchableOpacity, Alert, StyleSheet, StatusBar } from 'react-native';
import { useLanguageStore } from '../../store/useLanguageStore';
import { resolveAttachment, openExternally } from '../../utils/openAttachment';
import { color, space, touchTarget, type as typeScale } from '../../theme/tokens';

/**
 * Full-screen, in-app preview of an image attachment. Tap × (or the back button) to
 * close. If the image cannot be drawn, it says so instead of showing a blank screen.
 */
export const AttachmentViewer = ({ uri, onClose }: { uri: string | null; onClose: () => void }) => {
  const { t } = useLanguageStore();
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        {!!uri && failed !== uri ? (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setFailed(uri)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={styles.message}>{t('attachmentCannotShow')}</Text>
        )}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('close')}
        >
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

/**
 * The one way a screen opens an attachment:
 *
 *   const { openAttachment, attachmentViewer } = useAttachmentOpener();
 *   <TouchableOpacity onPress={() => openAttachment(uri)}> … </TouchableOpacity>
 *   {attachmentViewer}
 *
 * Images preview in-app; other files go to the phone's apps; a missing file or a file
 * nothing can open gets a clear message — never silence, never a crash.
 */
export function useAttachmentOpener() {
  const { t } = useLanguageStore();
  const [viewing, setViewing] = useState<string | null>(null);

  const openAttachment = useCallback(async (uri?: string | null) => {
    const target = await resolveAttachment(uri);
    if (target.kind === 'missing') {
      Alert.alert(t('attachmentMissingTitle'), t('attachmentMissingBody'));
      return;
    }
    if (target.kind === 'image') {
      setViewing(target.uri);
      return;
    }
    if (!(await openExternally(target.uri))) {
      Alert.alert(t('attachmentNoAppTitle'), t('attachmentNoAppBody'));
    }
  }, [t]);

  const attachmentViewer = <AttachmentViewer uri={viewing} onClose={() => setViewing(null)} />;
  return { openAttachment, attachmentViewer };
}

const styles = StyleSheet.create({
  // The one place a dark surface is right: a photo viewer, where any light around the
  // image would compete with it. rgba, not hex — an overlay, not a palette colour.
  backdrop: { flex: 1, backgroundColor: color.scrimPhoto, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '85%' },
  message: { ...typeScale.body, color: color.textInverse, textAlign: 'center', paddingHorizontal: space.xxl },
  closeBtn: {
    position: 'absolute', top: space.xxxl + space.lg, right: space.lg,
    width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: 32, color: color.textInverse },
});
