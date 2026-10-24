import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '@/session';
import { C, Loading, Screen } from '@/ui';

function Routes() {
  const { status } = useSession();
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
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="drivers/index" />
        <Stack.Screen name="drivers/new" />
        <Stack.Screen name="drivers/[id]" />
        <Stack.Screen name="agreements/[id]/index" />
        <Stack.Screen name="agreements/[id]/install" />
        <Stack.Screen name="cash" />
        <Stack.Screen name="installations" />
        <Stack.Screen name="tickets/index" />
        <Stack.Screen name="tickets/[id]" />
        <Stack.Screen name="recoveries/index" />
        <Stack.Screen name="recoveries/[id]" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
