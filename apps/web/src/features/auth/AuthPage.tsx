import { useState } from 'react';
import { api } from '../../shared/api/client';
import type { User } from '../../shared/api/types';
import { Brand, Doodle } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { localizedError, tr } from '../../shared/i18n';
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
          <span className="brand-tagline">{tr('common:homeStuffHappier')}</span>
        </div>
      </header>
      <main className="content">
        <div className="auth-layout">
          <div className="intro">
            <Doodle kind="basket" className="auth-doodle" />
            <p className="eyebrow">{tr('auth:littleThinkAbout')}</p>
            <h1>
              {tr('common:knowHave')}
              <br />
              {tr('common:useWell')}
            </h1>
            <p>{tr('auth:happyLittlePlace')}</p>
          </div>
          <Card className="auth-card">
            {error && <Notice kind="error">{error}</Notice>}
            <div
              className="tabs"
              role="tablist"
              aria-label={tr('auth:accountAccess')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'sign-in'}
                className={mode === 'sign-in' ? 'active' : ''}
                onClick={() => setMode('sign-in')}
              >
                {tr('common:sign')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => setMode('register')}
              >
                {tr('common:signUp')}
              </button>
            </div>
            <h2>
              {mode === 'register'
                ? tr('common:createAccount2')
                : tr('common:welcomeBack')}
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
                  .catch((cause: unknown) => setError(localizedError(cause)))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                {tr('common:email')}
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                {tr('common:password')}
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
                  ? tr('auth:wait')
                  : mode === 'register'
                    ? tr('common:createAccount')
                    : tr('common:sign')}
              </Button>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
