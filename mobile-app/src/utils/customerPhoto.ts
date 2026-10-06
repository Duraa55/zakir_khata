import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { isUnder, persistInto } from './durableFile';

/**
 * Customer and staff photos — durability first. ONE approach for both.
 *
 * ImagePicker hands back a file:// URI in the app CACHE directory. Android reclaims
 * that directory under storage pressure, so a photo stored as that URI can vanish
 * on the same phone with no sync involved. persist*Photo() copies the picked file
 * into documentDirectory, which the OS treats as app data, and returns THAT path for
 * the photo_local_path column (customers since v34, staff_records since v35).
 *
 * Compression matches the receipt pickers (allowsEditing crop + quality 0.5).
 * Resizing to ~512px would need expo-image-manipulator, which is not installed;
 * the square crop keeps the stored file small in practice.
 */

const PHOTO_DIR = () => `${FileSystem.documentDirectory}customer_photos/`;
const STAFF_PHOTO_DIR = () => `${FileSystem.documentDirectory}staff_photos/`;
const STAFF_DOC_DIR = () => `${FileSystem.documentDirectory}staff_docs/`;

const PICK_OPTIONS = {
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: true,
  aspect: [1, 1] as [number, number],
  quality: 0.5,
};

/** A document is photographed whole — cropping it square would cut the page. */
const DOC_PICK_OPTIONS = {
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: false,
  quality: 0.8,
};

/** Camera-or-gallery chooser, same flow as CashEntryModal. Resolves to a picker URI or null. */
const pickPhoto = (title: string, options: object = PICK_OPTIONS): Promise<string | null> =>
  new Promise(resolve => {
    const fromCamera = async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission Denied', 'Camera permission is required to take photos.'); return resolve(null); }
      const result = await ImagePicker.launchCameraAsync(options);
      resolve(!result.canceled && result.assets?.[0]?.uri ? result.assets[0].uri : null);
    };
    const fromGallery = async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission Denied', 'Gallery permission is required to choose photos.'); return resolve(null); }
      const result = await ImagePicker.launchImageLibraryAsync(options);
      resolve(!result.canceled && result.assets?.[0]?.uri ? result.assets[0].uri : null);
    };
    Alert.alert(title, 'Choose an option', [
      { text: 'Camera', onPress: fromCamera },
      { text: 'Gallery', onPress: fromGallery },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });

// The copy itself lives in durableFile.ts — one helper for every attached file.

// ── Customers ────────────────────────────────────────────────────────────────

export const pickCustomerPhoto = (): Promise<string | null> => pickPhoto('Customer Photo');

/** True when the path is already our durable copy (so re-saving does not re-copy). */
export const isPersistedCustomerPhoto = (uri?: string | null): boolean => isUnder(uri, PHOTO_DIR());

/**
 * Copies a picked image into documentDirectory/customer_photos/<customerId>.jpg
 * and returns the durable path. A path that is already ours is returned as-is.
 */
export const persistCustomerPhoto = (pickedUri: string, customerId: string): Promise<string> =>
  persistInto(PHOTO_DIR(), pickedUri, customerId);

// ── Staff ────────────────────────────────────────────────────────────────────

export const pickStaffPhoto = (): Promise<string | null> => pickPhoto('Staff Photo');

export const isPersistedStaffPhoto = (uri?: string | null): boolean => isUnder(uri, STAFF_PHOTO_DIR());

/** Same as persistCustomerPhoto, into documentDirectory/staff_photos/. */
export const persistStaffPhoto = (pickedUri: string, staffId: string): Promise<string> =>
  persistInto(STAFF_PHOTO_DIR(), pickedUri, staffId);

// ── Staff documents (CNIC, contract, certificates) ───────────────────────────

/**
 * Photograph or choose a document page. Images only: file picking (PDFs) needs
 * expo-document-picker, which is not installed.
 */
export const pickStaffDocument = (): Promise<string | null> => pickPhoto('Staff Document', DOC_PICK_OPTIONS);

export const isPersistedStaffDocument = (uri?: string | null): boolean => isUnder(uri, STAFF_DOC_DIR());

/** Copies a picked document into documentDirectory/staff_docs/ — never the picker cache. */
export const persistStaffDocument = (pickedUri: string, staffId: string): Promise<string> =>
  persistInto(STAFF_DOC_DIR(), pickedUri, staffId);

/** The bit worth showing a human: the file's own name, not the whole path. */
export const documentLabel = (uri: string): string => uri.split('/').pop() || uri;
