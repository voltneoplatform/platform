'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthSession } from '@voltneo/shared';
import { useSession } from '@/lib/session';

const RESEND_SECONDS = 30;

export default function LoginPage() {
  const router = useRouter();
  const { api, status, signIn, notice, clearNotice } = useSession();
  const [step, setStep] = useState<'identifier' | 'code'>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (status === 'signed-in') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    clearNotice();
    try {
      await api.publicPost('/v1/auth/otp/request', { identifier });
      setStep('code');
      setCode('');
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The API refuses admin-panel sign-in for field roles (they use the Field App).
      const session = await api.publicPost<AuthSession>('/v1/auth/otp/verify', {
        identifier,
        code,
      });
      signIn(session);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="brand" style={{ padding: '0 0 12px' }}>
          VOLT NEO
        </div>
        <h1>Sign in</h1>
        <p className="muted">Head-office admin panel</p>

        {notice && (
          <div className="alert info" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        {step === 'identifier' ? (
          <form onSubmit={requestCode}>
            <div className="field">
              <label htmlFor="identifier">Email or mobile number</label>
              <input
                id="identifier"
                autoComplete="username"
                autoFocus
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@voltneo.in or 98300 12345"
              />
            </div>
            <button
              className="primary"
              type="submit"
              disabled={busy || !identifier.trim()}
              style={{ width: '100%' }}
            >
              {busy ? 'Sending…' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p>
              If <strong>{identifier}</strong> belongs to an active staff account, a 6-digit code is
              on its way. It works for 5 minutes.
            </p>
            <div className="field">
              <label htmlFor="code">Login code</label>
              <input
                id="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            <button
              className="primary"
              type="submit"
              disabled={busy || code.length !== 6}
              style={{ width: '100%' }}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <div
              className="row"
              style={{ justifyContent: 'space-between', marginTop: 14, fontSize: 14 }}
            >
              <button
                type="button"
                className="link"
                onClick={() => {
                  setStep('identifier');
                  setError(null);
                }}
              >
                Use a different email or number
              </button>
              <button
                type="button"
                className="link"
                disabled={resendIn > 0 || busy}
                onClick={() => void requestCode()}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
