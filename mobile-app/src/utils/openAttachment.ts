import * as FileSystem from 'expo-file-system';

/**
 * Opening an attachment — the ONE decision every book shares.
 *
 * Images are shown inside the app: no other app, no permission, no file:// hand-off.
 * Anything else (a PDF, once file picking exists) is handed to the phone through the
 * share sheet, which converts to a content:// URI itself — Android 7+ blocks passing a
 * raw file:// path to another app.
 *
 * Pure logic, so it can be tested without a device. The screens use it through
 * useAttachmentOpener (components/ui/AttachmentViewer).
 */

export type AttachmentTarget =
  | { kind: 'image'; uri: string }
  | { kind: 'external'; uri: string }
  | { kind: 'missing' };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp)(\?.*)?$/i;
const ANY_EXT = /\.[a-z0-9]{2,5}(\?.*)?$/i;

/**
 * An image by its extension — or with no extension at all, which is what the image
 * picker produces on some phones. Everything this app attaches today is an image.
 */
export const isImagePath = (uri: string): boolean => IMAGE_EXT.test(uri) || !ANY_EXT.test(uri);

/** Decides how to open a stored attachment. Never throws: an unreadable path is "missing". */
export async function resolveAttachment(uri?: string | null): Promise<AttachmentTarget> {
  if (!uri || !uri.trim()) return { kind: 'missing' };
  // A web address cannot be checked on disk; let the viewer try it.
  if (/^https?:\/\//i.test(uri)) return isImagePath(uri) ? { kind: 'image', uri } : { kind: 'external', uri };
  let exists = false;
  try {
    exists = (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    exists = false;
  }
  if (!exists) return { kind: 'missing' };
  return isImagePath(uri) ? { kind: 'image', uri } : { kind: 'external', uri };
}

/** Hands a non-image to the phone's own apps. Resolves false when nothing can take it. */
export async function openExternally(uri: string): Promise<boolean> {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) return false;
  try {
    await Sharing.shareAsync(uri);
    return true;
  } catch {
    return false;
  }
}
