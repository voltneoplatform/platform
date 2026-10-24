import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './api';

/**
 * Small values kept on the phone. The refresh token goes to the Android
 * keystore-backed secure store; the web build (used only for testing the
 * screens) falls back to the browser's storage.
 */
async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode: keep going without saving */
    }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

export const refreshTokenStore: TokenStore = {
  get: () => read('vn_field_refresh'),
  set: (v) => write('vn_field_refresh', v),
};

export const prefs = {
  getLang: () => read('vn_field_lang'),
  setLang: (v: string) => write('vn_field_lang', v),
  getIdentifier: () => read('vn_field_identifier'),
  setIdentifier: (v: string) => write('vn_field_identifier', v),
};
