import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, type DriverApi } from './api';

/**
 * Opens a PDF from the API (a receipt, the Key Facts): downloaded with the
 * driver's sign-in, then handed to the phone's PDF viewer through the share
 * sheet. The web build (screen testing only) opens it in a new tab.
 */
export async function openPdf(api: DriverApi, path: string, name: string): Promise<void> {
  const token = await api.token();
  if (!token) throw new ApiError(401, 'SESSION_ENDED');
  const url = `${api.baseUrl}${path}`;
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
    const blob = await res.blob();
    globalThis.open?.(URL.createObjectURL(blob), '_blank');
    return;
  }
  let file: File;
  try {
    file = await File.downloadFileAsync(url, new File(Paths.cache, name.replace(/[^\w.-]/g, '_')), {
      headers: { authorization: `Bearer ${token}` },
      idempotent: true,
    });
  } catch (err) {
    throw new ApiError(0, 'NO_CONNECTION', { detail: String(err).slice(0, 200) });
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

/** Opens a web page (the UPI payment page, a signed-copy link) in the phone's browser. */
export async function openPage(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
