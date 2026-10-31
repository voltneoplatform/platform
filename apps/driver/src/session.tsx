import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DriverApi, type DriverProfile, type Session, type VerifyResult } from './api';
import { LANGS, translate, type Lang, type MessageKey, type Params } from './i18n';
import { LABELS, type Labels } from './i18n/labels';
import { prefs, refreshTokenStore } from './storage';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  driver: DriverProfile | null;
  lang: Lang;
  /** Changes the app's language and, once signed in, the language of the driver's SMS. */
  setLang: (l: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  labels: Labels;
  api: DriverApi;
  /** Returns the names to choose from when the phone is shared, else signs in. */
  verify: (phone: string, code: string) => Promise<VerifyResult>;
  select: (selectToken: string, driverId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [lang, setLangState] = useState<Lang>('BN');
  // A language picked on the sign-in screen wins over the one on file, and is saved there.
  const picked = useRef<Lang | null>(null);

  const api = useMemo(
    () =>
      new DriverApi({
        baseUrl: API_URL,
        store: refreshTokenStore,
        onSessionEnded: () => {
          setDriver(null);
          setStatus('signed-out');
        },
      }),
    [],
  );

  const accept = useCallback(
    (s: Session | null) => {
      const choice = picked.current;
      picked.current = null;
      if (s && choice && choice !== s.driver.language) {
        setDriver({ ...s.driver, language: choice });
        void api.patch('/v1/me', { language: choice }).catch(() => undefined);
      } else {
        setDriver(s?.driver ?? null);
        // The language Volt Neo has on file for the driver (set at registration or here).
        if (s?.driver.language) {
          setLangState(s.driver.language);
          void prefs.setLang(s.driver.language);
        }
      }
      setStatus(s ? 'signed-in' : 'signed-out');
    },
    [api],
  );

  useEffect(() => {
    void (async () => {
      const saved = await prefs.getLang();
      if (saved && (LANGS as readonly string[]).includes(saved)) setLangState(saved as Lang);
      try {
        accept(await api.restore());
      } catch {
        // No signal at start-up: show sign-in rather than hang.
        setStatus('signed-out');
      }
    })();
  }, [api, accept]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      driver,
      lang,
      setLang: (l) => {
        setLangState(l);
        void prefs.setLang(l);
        if (driver) {
          setDriver({ ...driver, language: l });
          void api.patch('/v1/me', { language: l }).catch(() => undefined);
        } else {
          picked.current = l;
        }
      },
      t: (key, params) => translate(lang, key, params),
      labels: LABELS[lang],
      api,
      verify: async (phone, code) => {
        const r = await api.verify(phone, code);
        await prefs.setPhone(phone);
        if ('session' in r) accept(r.session);
        return r;
      },
      select: async (selectToken, driverId) => {
        accept(await api.select(selectToken, driverId));
      },
      signOut: async () => {
        await api.signOut();
        setDriver(null);
        setStatus('signed-out');
      },
    }),
    [status, driver, lang, api, accept],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
