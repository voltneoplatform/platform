import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANGS, LANG_NAMES } from '@/i18n';
import { useSession } from '@/session';
import { prefs } from '@/storage';
import { Button, C, Card, Choice, ErrorNotice, Field, Muted, Notice, Screen } from '@/ui';

export default function Login() {
  const { t, lang, setLang, api, signIn, wrongRole } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'identifier' | 'code'>('identifier');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void prefs.getIdentifier().then((v) => v && setIdentifier(v));
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.brand }}>
      <Screen>
        <View style={{ paddingVertical: 24, gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: C.brand }}>VOLT NEO</Text>
          <Muted>{t('appName')}</Muted>
        </View>
        <Card>
          <Choice
            label={t('language')}
            value={lang}
            onChange={setLang}
            options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          />
        </Card>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: C.ink }}>{t('signInTitle')}</Text>
          {wrongRole && <Notice tone="warn">{t('adminRoleOnly')}</Notice>}
          {step === 'identifier' ? (
            <>
              <Muted>{t('signInIntro')}</Muted>
              <Field
                testID="identifier"
                label={t('identifier')}
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <ErrorNotice error={error} />
              <Button
                testID="send-code"
                title={t('sendCode')}
                busy={busy}
                disabled={identifier.trim().length < 5}
                onPress={() =>
                  void run(async () => {
                    await api.requestCode(identifier.trim());
                    setStep('code');
                  })
                }
              />
            </>
          ) : (
            <>
              <Muted>{t('codeSentTo', { to: identifier.trim() })}</Muted>
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
                onPress={() => void run(() => signIn(identifier.trim(), code))}
              />
              <Button
                title={t('useAnother')}
                variant="secondary"
                onPress={() => {
                  setStep('identifier');
                  setCode('');
                  setError(null);
                }}
              />
            </>
          )}
        </Card>
      </Screen>
    </SafeAreaView>
  );
}
