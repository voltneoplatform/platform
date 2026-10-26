import type { Metadata } from 'next';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Volt Neo Admin',
  description: 'Volt Neo head-office admin panel',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {process.env.NEXT_PUBLIC_DEPLOYMENT === 'staging' && (
          <div className="test-site-banner" role="status">
            Test site: test data only, no real money. Driver SMS are not sent.
          </div>
        )}
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
