import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LanguageSwitch } from '@/LanguageSwitch';
import { useSession } from '@/session';
import { prefs } from '@/storage';
import { Button, C, Card, ErrorNotice, Field, Muted, Screen } from '@/ui';

type Step =
  | { kind: 'phone' }
  | { kind: 'code' }
  | { kind: 'choose'; names: { id: string; name: string }[]; selectToken: string };

export default function Login() {
  const { t, api, verify, select } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'phone' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void prefs.getPhone().then((v) => v && setPhone(v));
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const digits = phone.replace(/\D/g, '').slice(-10);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.brand }}>
      <Screen>
        <View
          style={{
            paddingVertical: 24,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <Text style={{ fontSize: 28, fontWeight: '800', color: C.brand }}>VOLT NEO</Text>
          <LanguageSwitch />
        </View>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: C.ink }}>{t('signInTitle')}</Text>
          {step.kind === 'phone' && (
            <>
              <Muted>{t('signInIntro')}</Muted>
              <Field
                testID="phone"
                label={t('phone')}
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/[^\d+ ]/g, ''))}
                keyboardType="phone-pad"
                maxLength={16}
              />
              <ErrorNotice error={error} />
              <Button
                testID="send-code"
                title={t('sendCode')}
                busy={busy}
                disabled={digits.length !== 10}
                onPress={() =>
                  void run(async () => {
                    await api.requestCode(digits);
                    setCode('');
                    setStep({ kind: 'code' });
                  })
                }
              />
              <Muted>{t('signInHelp')}</Muted>
            </>
          )}
          {step.kind === 'code' && (
            <>
              <Muted>{t('codeSentTo', { to: digits })}</Muted>
              <Field
                testID="code"
                label={t('code')}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
              />
              <ErrorNotice error={error} />
              <Button
                testID="sign-in"
                title={t('signIn')}
                busy={busy}
                disabled={code.length !== 6}
                onPress={() =>
                  void run(async () => {
                    const r = await verify(digits, code);
                    if ('choose' in r) {
                      setStep({ kind: 'choose', names: r.choose, selectToken: r.selectToken });
                    }
                  })
                }
              />
              <Button
                title={t('useAnother')}
                variant="secondary"
                onPress={() => {
                  setStep({ kind: 'phone' });
                  setError(null);
                }}
              />
            </>
          )}
          {step.kind === 'choose' && (
            <>
              <Muted>{t('whoAreYou')}</Muted>
              {step.names.map((n) => (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void run(() => select(step.selectToken, n.id))}
                  style={({ pressed }) => ({
                    padding: 16,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: pressed ? C.infoBg : C.card,
                  })}
                >
                  <Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>{n.name}</Text>
                </Pressable>
              ))}
              <ErrorNotice error={error} />
            </>
          )}
        </Card>
      </Screen>
    </SafeAreaView>
  );
}
