import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LanguageSwitch } from '@/LanguageSwitch';
import { SessionProvider, useSession } from '@/session';
import { C, Loading, Screen } from '@/ui';

function Routes() {
  const { status, t } = useSession();
  if (status === 'loading') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const signedIn = status === 'signed-in';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: C.brand },
        headerTintColor: '#FFF',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: C.bg },
        headerRight: () => <LanguageSwitch onDark />,
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: t('appName') }} />
        <Stack.Screen name="receipts" options={{ title: t('receipts') }} />
        <Stack.Screen name="agreement" options={{ title: t('myAgreement') }} />
        <Stack.Screen name="help" options={{ title: t('help') }} />
      </Stack.Protected>
    </Stack>
  );
}

/** Shown on every screen of a build that talks to the test site (EXPO_PUBLIC_DEPLOYMENT=staging). */
function TestSiteBanner() {
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  if (process.env.EXPO_PUBLIC_DEPLOYMENT !== 'staging') return null;
  return (
    <View
      style={{ backgroundColor: C.warnBg, paddingTop: 6, paddingBottom: 6 + insets.bottom }}
      accessibilityRole="alert"
    >
      <Text style={{ color: '#7A4B00', textAlign: 'center', fontWeight: '700', fontSize: 13 }}>
        {t('testSite')}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          <Routes />
        </View>
        <TestSiteBanner />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
