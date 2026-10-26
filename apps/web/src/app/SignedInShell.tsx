import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import type { User } from '@/shared/api/types';
import { tr } from '@/shared/i18n';
import { Brand } from '@/shared/ui/Doodle';
import { ControlIcon } from '@/shared/ui/ControlIcon';

export function SignedInShell({ user }: { user: User }) {
  const { pathname, search, hash } = useLocation();
  const [compactHeader, setCompactHeader] = useState(() => window.scrollY > 24);
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  useEffect(() => {
    const onScroll = () => setCompactHeader(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const householdId =
    pathname.match(/^\/households\/([^/]+)(?:\/|$)/)?.[1] ??
    (pathname === '/settings'
      ? new URLSearchParams(search).get('householdId')
      : null);

  return (
    <div className="shell">
      <header className={`topbar${compactHeader ? ' is-compact' : ''}`}>
        <Link
          className="brand"
          to="/households"
          aria-label={tr('common:lumioHouseholdsTitle')}
        >
          <Brand />
          <span className="brand-tagline">{tr('common:homeStuffHappier')}</span>
        </Link>
        <div className="top-actions">
          <small>{user.email}</small>
          <Link
            className="settings-icon-link"
            to={
              householdId
                ? `/settings?householdId=${encodeURIComponent(householdId)}`
                : '/settings'
            }
            aria-label={tr('common:settings')}
            title={tr('common:settings')}
          >
            <ControlIcon name="setting" />
          </Link>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
