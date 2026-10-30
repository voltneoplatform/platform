import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

export interface Photo {
  uri: string;
  name: string;
  /** Web only: the browser file, for the test build of the screens. */
  file?: Blob;
}

let n = 0;

/**
 * Takes or chooses one photo and shrinks it to at most 1600 px wide as JPEG,
 * so uploads stay well under the API's size limit on slow mobile data.
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<Photo | 'denied' | null> {
  if (source === 'camera' && Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  n += 1;
  const name = `photo-${Date.now()}-${n}.jpg`;
  if (Platform.OS === 'web') {
    return { uri: asset.uri, name: asset.fileName ?? name, file: asset.file ?? undefined };
  }
  const resized = await manipulateAsync(
    asset.uri,
    asset.width > 1600 ? [{ resize: { width: 1600 } }] : [],
    { compress: 0.7, format: SaveFormat.JPEG },
  );
  return { uri: resized.uri, name };
}

/** Adds photos to a multipart form under one field name. */
export async function appendPhotos(form: FormData, field: string, photos: Photo[]) {
  for (const p of photos) {
    if (Platform.OS === 'web') {
      const blob = p.file ?? (await (await fetch(p.uri)).blob());
      form.append(field, blob, p.name);
    } else {
      // Expo's fetch reads a part's bytes itself and refuses React Native's
      // { uri, name, type } descriptions ("Unsupported FormDataPart
      // implementation"); expo-file-system's File provides them. Its name is the
      // file's own (a .jpg from the resize step) and its type comes from that.
      form.append(field, new File(p.uri) as unknown as Blob, p.name);
    }
  }
}
