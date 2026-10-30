import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGS, LANG_NAMES } from './i18n';
import { useSession } from './session';
import { C } from './ui';

/**
 * A small language button for the top-right corner: shows the current
 * language and opens a short list of the three. `onDark` is for the navy header.
 */
export function LanguageSwitch({ onDark = false }: { onDark?: boolean }) {
  const { t, lang, setLang } = useSession();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <>
      <Pressable
        testID="language-switch"
        accessibilityRole="button"
        accessibilityLabel={`${t('language')}: ${LANG_NAMES[lang]}`}
        hitSlop={8}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 10,
          paddingVertical: 5,
          marginRight: onDark ? 4 : 0,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: onDark ? 'rgba(255,255,255,0.45)' : C.border,
          backgroundColor: pressed
            ? onDark
              ? 'rgba(255,255,255,0.15)'
              : C.infoBg
            : onDark
              ? 'transparent'
              : C.card,
        })}
      >
        <Text style={{ color: onDark ? '#FFF' : C.ink, fontSize: 13, fontWeight: '600' }}>
          {LANG_NAMES[lang]}
        </Text>
        <Text style={{ color: onDark ? '#FFF' : C.muted, fontSize: 10 }}>▼</Text>
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }}
          onPress={() => setOpen(false)}
          accessibilityLabel={t('cancel')}
        >
          <View
            style={{
              position: 'absolute',
              top: insets.top + 52,
              right: 12,
              minWidth: 160,
              backgroundColor: C.card,
              borderRadius: 12,
              paddingVertical: 6,
              elevation: 6,
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <Text
              style={{ color: C.muted, fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 }}
            >
              {t('language')}
            </Text>
            {LANGS.map((l) => (
              <Pressable
                key={l}
                testID={`language-${l}`}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: l === lang }}
                onPress={() => {
                  setLang(l);
                  setOpen(false);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? C.infoBg : 'transparent',
                })}
              >
                <Text
                  style={{
                    fontSize: 16,
                    color: C.ink,
                    fontWeight: l === lang ? '700' : '400',
                  }}
                >
                  {LANG_NAMES[l]}
                </Text>
                {l === lang ? <Text style={{ color: C.primary, fontSize: 16 }}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
