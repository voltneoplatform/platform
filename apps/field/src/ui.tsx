import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextStyle,
} from 'react-native';
import { ApiError } from './api';
import { useSession } from './session';
import { pickPhoto, type Photo } from './photos';

export const C = {
  bg: '#F4F6F9',
  card: '#FFFFFF',
  ink: '#16202B',
  muted: '#5A6573',
  border: '#D9DFE6',
  brand: '#0F2A44',
  primary: '#0B5CD5',
  danger: '#C0262D',
  success: '#1B7A3A',
  warnBg: '#FFF3DD',
  infoBg: '#E8F0FD',
  successBg: '#E5F4EA',
  dangerBg: '#FDECEC',
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 8,
  },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink },
  body: { fontSize: 16, color: C.ink, lineHeight: 22 },
  muted: { fontSize: 14, color: C.muted, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '600', color: C.ink, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
    color: C.ink,
    backgroundColor: '#FFF',
    minHeight: 48,
  },
  button: {
    minHeight: 50,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#FFF',
  },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  notice: { borderRadius: 10, padding: 12 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tile: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
  },
  count: { fontSize: 26, fontWeight: '800', color: C.brand, minWidth: 40, textAlign: 'right' },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  thumb: { width: 84, height: 84, borderRadius: 8, backgroundColor: C.border },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
});

export function Screen({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export const H1 = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.h1} accessibilityRole="header">
    {children}
  </Text>
);
export const H2 = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.h2} accessibilityRole="header">
    {children}
  </Text>
);
export const Body = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.body, style]}>{children}</Text>
);
export const Muted = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.muted, style]}>{children}</Text>
);
export const Row = ({ children }: { children: React.ReactNode }) => (
  <View style={s.row}>{children}</View>
);

/** A label and value on one line. */
export function KV({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <View style={s.kv}>
      <Muted>{k}</Muted>
      <Text style={[s.body, strong ? { fontWeight: '700' } : null, { flexShrink: 1 }]}>{v}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const off = disabled || busy;
  const bg = variant === 'primary' ? C.primary : variant === 'danger' ? C.danger : '#FFF';
  const fg = variant === 'secondary' ? C.ink : '#FFF';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: bg,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: C.border,
        },
      ]}
    >
      {busy && <ActivityIndicator color={fg} />}
      <Text style={[s.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  placeholder,
  multiline,
  autoCapitalize = 'sentences',
  maxLength,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: KeyboardTypeOptions;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  testID?: string;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        style={[s.input, multiline ? { minHeight: 90, textAlignVertical: 'top' } : null]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        autoCorrect={false}
      />
    </View>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View>
      {label && <Text style={s.label}>{label}</Text>}
      <View style={s.row}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o.value)}
              style={[s.chip, on ? s.chipOn : null]}
            >
              <Text style={{ fontSize: 15, color: on ? '#FFF' : C.ink, fontWeight: '600' }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Check({
  label,
  value,
  onChange,
}: {
  label: React.ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={s.check}
    >
      <View style={[s.box, value ? { backgroundColor: C.brand } : null]}>
        {value && <Text style={{ color: '#FFF', fontWeight: '800' }}>✓</Text>}
      </View>
      <Text style={[s.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'success' | 'danger';
  children: React.ReactNode;
}) {
  const bg =
    tone === 'warn'
      ? C.warnBg
      : tone === 'success'
        ? C.successBg
        : tone === 'danger'
          ? C.dangerBg
          : C.infoBg;
  return (
    <View style={[s.notice, { backgroundColor: bg }]} accessibilityLiveRegion="polite">
      <Text style={[s.body, tone === 'danger' ? { color: C.danger } : null]}>{children}</Text>
    </View>
  );
}

/** Shows an error in the person's language where we can, else the server's words. */
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useSession();
  if (!error) return null;
  let text = t('somethingWrong');
  let detail: string | null = null;
  if (error instanceof ApiError) {
    text = error.offline
      ? t('noConnection')
      : error.message === 'SESSION_ENDED'
        ? t('sessionEnded')
        : error.message;
    // What the phone itself reported, small, for anyone reporting the problem.
    const d = (error.body as { detail?: unknown } | undefined)?.detail;
    if (error.offline && typeof d === 'string') detail = d;
  }
  return <Notice tone="danger">{detail ? `${text}\n(${detail})` : text}</Notice>;
}

export function Badge({
  text,
  tone = 'info',
}: {
  text: string;
  tone?: 'info' | 'warn' | 'success' | 'danger' | 'plain';
}) {
  const map = {
    info: [C.infoBg, C.primary],
    warn: [C.warnBg, '#8A5300'],
    success: [C.successBg, C.success],
    danger: [C.dangerBg, C.danger],
    plain: ['#EEF1F4', C.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 13, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

/** A big tappable row on the home screen. */
export function Tile({
  title,
  subtitle,
  count,
  alert,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  count?: number | string | null;
  alert?: string | null;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.tile, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.h2}>{title}</Text>
        {subtitle && <Muted>{subtitle}</Muted>}
        {alert && <Text style={{ color: C.danger, fontWeight: '700' }}>{alert}</Text>}
      </View>
      {count !== undefined && count !== null && <Text style={s.count}>{count}</Text>}
      <Text style={{ fontSize: 22, color: C.muted }}>›</Text>
    </Pressable>
  );
}

export function Loading() {
  const { t } = useSession();
  return (
    <View style={{ padding: 24, alignItems: 'center', gap: 8 }}>
      <ActivityIndicator color={C.brand} />
      <Muted>{t('loading')}</Muted>
    </View>
  );
}

/** Loads on mount and whenever deps change; reload() fetches again. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Photos taken with the camera (or chosen from the phone), shown as thumbnails. */
export function Photos({
  photos,
  onChange,
  max = 6,
}: {
  photos: Photo[];
  onChange: (p: Photo[]) => void;
  max?: number;
}) {
  const { t } = useSession();
  const [error, setError] = useState<string | null>(null);
  async function add(source: 'camera' | 'library') {
    setError(null);
    const r = await pickPhoto(source);
    if (r === 'denied') setError(t('cameraDenied'));
    else if (r) onChange([...photos, r].slice(0, max));
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>
        {t('photos')} ({photos.length}/{max})
      </Text>
      {photos.length > 0 && (
        <View style={s.row}>
          {photos.map((p, i) => (
            <Pressable
              key={p.uri}
              accessibilityLabel={t('removePhoto')}
              onLongPress={() => onChange(photos.filter((_, j) => j !== i))}
            >
              <Image source={{ uri: p.uri }} style={s.thumb} />
              <Pressable onPress={() => onChange(photos.filter((_, j) => j !== i))}>
                <Text style={{ color: C.danger, fontSize: 13, textAlign: 'center' }}>
                  {t('removePhoto')}
                </Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}
      {photos.length < max && (
        <Row>
          <View style={{ flex: 1 }}>
            <Button title={t('takePhoto')} variant="secondary" onPress={() => void add('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={t('choosePhoto')}
              variant="secondary"
              onPress={() => void add('library')}
            />
          </View>
        </Row>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </View>
  );
}
