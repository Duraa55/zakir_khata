import * as FileSystem from 'expo-file-system';

/**
 * Durable files — the ONE way this app keeps a picked file.
 *
 * ImagePicker returns a file:// URI inside the app's CACHE directory. Android may clear
 * that directory whenever storage runs low, so a path saved as-is can point at nothing
 * a week later: silent data loss with no sync involved. Everything a user attaches is
 * therefore copied into documentDirectory, which the OS treats as app data, and only
 * THAT path is stored.
 *
 * Customer photos, staff photos and staff documents already used this; cash, bill and
 * expense attachments, item photos and the profile picture now do too.
 */

/** A folder inside documentDirectory, with its trailing slash. */
export const durableDir = (folder: string): string => `${FileSystem.documentDirectory}${folder}/`;

/** True when the path already lives inside documentDirectory — nothing to copy. */
export const isDurable = (uri?: string | null): boolean =>
  !!uri && !!FileSystem.documentDirectory && uri.startsWith(FileSystem.documentDirectory);

/** True when the path already lives in this particular folder. */
export const isUnder = (uri: string | null | undefined, dir: string): boolean =>
  !!uri && !!FileSystem.documentDirectory && uri.startsWith(dir);

/**
 * Copies a picked file into `dir` and returns the durable path. A path already in `dir`
 * is returned as-is, so saving the same record twice never makes a second copy.
 */
export const persistInto = async (dir: string, pickedUri: string, id: string): Promise<string> => {
  if (isUnder(pickedUri, dir)) return pickedUri;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  // A timestamp alone is not unique: two files filed in the same millisecond would
  // land on one filename, and the second copy would silently replace the first.
  const target = `${dir}${id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  await FileSystem.copyAsync({ from: pickedUri, to: target });
  return target;
};

/** Where each kind of attachment is filed. */
export const ATTACHMENT_FOLDERS = {
  cash: 'cash_attachments',
  bill: 'bill_attachments',
  expense: 'expense_receipts',
  item: 'item_photos',
  profile: 'profile_photos',
} as const;

export type AttachmentKind = keyof typeof ATTACHMENT_FOLDERS;

/**
 * Makes an attachment durable before it is saved. Anything already in permanent storage
 * (an attachment re-saved while editing) is kept exactly as it is; a remote URL is not a
 * device file and is left alone too.
 */
export const persistAttachment = async (kind: AttachmentKind, uri: string): Promise<string> => {
  if (isDurable(uri) || /^https?:\/\//i.test(uri)) return uri;
  return persistInto(durableDir(ATTACHMENT_FOLDERS[kind]), uri, kind);
};
