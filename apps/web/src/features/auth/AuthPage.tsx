import { useState } from 'react';
import { api } from '../../shared/api/client';
import type { User } from '../../shared/api/types';
import { Brand, Doodle } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';

export function AuthPage({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Brand />
          <span className="brand-tagline">Home stuff, happier days.</span>
        </div>
      </header>
      <main className="content">
        <div className="auth-layout">
          <div className="intro">
            <Doodle kind="basket" className="auth-doodle" />
            <p className="eyebrow">A little less to think about</p>
            <h1>
              Know what you have.
              <br />
              Use it well.
            </h1>
            <p>
              A happy little place for everything at home. Keep track of what
              you have, use it well, and shop with a little less guesswork.
            </p>
          </div>
          <Card className="auth-card">
            {error && <Notice kind="error">{error}</Notice>}
            <div className="tabs" role="tablist" aria-label="Account access">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'sign-in'}
                className={mode === 'sign-in' ? 'active' : ''}
                onClick={() => setMode('sign-in')}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => setMode('register')}
              >
                Sign up
              </button>
            </div>
            <h2>
              {mode === 'register' ? 'Create your account' : 'Welcome back'}
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                void api<User>(`/auth/${mode}`, 'POST', { email, password })
                  .then((user) => {
                    onAuthed(user);
                    setPassword('');
                  })
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'Sign in failed.',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  minLength={8}
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <Button disabled={busy}>
                {busy
                  ? 'Please wait…'
                  : mode === 'register'
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
