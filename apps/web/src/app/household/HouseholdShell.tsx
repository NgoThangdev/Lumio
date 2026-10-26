import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
import { tr } from '@/shared/i18n';
import { Doodle } from '@/shared/ui/Doodle';
import { ControlIcon } from '@/shared/ui/ControlIcon';

export function HouseholdShell({ children }: { children: ReactNode }) {
  const household = useHousehold();
  const { pathname } = useLocation();
  const home = pathname.endsWith('/home');
  const shopping = pathname.includes('/shopping');
  const tripDetail =
    shopping &&
    !pathname.endsWith('/quick-purchase') &&
    /\/shopping\/[^/]+$/.test(pathname);
  const item = pathname.match(/\/inventory\/([^/]+)$/);
  const locationCheck = pathname.includes('/locations/');
  const members = pathname.endsWith('/members');
  const base = `/households/${household.id}`;

  return (
    <>
      {!home && !tripDetail && !locationCheck && (
        <div
          className={`workspace-heading${item ? ' workspace-heading-detail' : ''}`}
        >
          <div>
            <Link className="link household-link" to="/households">
              {tr('common:households3')}
            </Link>
            <p className="eyebrow">{household.name}</p>
            <h1>
              {home
                ? tr('common:home')
                : shopping
                  ? tr('common:shopping2')
                  : item
                    ? tr('common:itemDetail')
                    : locationCheck
                      ? tr('common:locationCheck')
                      : members
                        ? tr('common:membersInvites')
                        : tr('common:inventory')}
            </h1>
            {!item && (
              <p className="page-subtitle">
                {home
                  ? tr('common:calmerWayCare')
                  : shopping
                    ? tr('common:littlePlanningHappier')
                    : members
                      ? tr('common:manageSharesHousehold')
                      : tr('common:sHomeNeeds')}
              </p>
            )}
          </div>
          {item ? (
            <Link className="secondary" to={`${base}/inventory`}>
              {tr('common:allItems')}
            </Link>
          ) : household.role === 'ADMIN' && !members ? (
            <Link
              className="secondary members-link"
              to={`${base}/members`}
              aria-label={tr('common:membersInvites')}
              title={tr('common:membersInvites')}
            >
              <ControlIcon name="adduser" />
            </Link>
          ) : (
            <Doodle
              kind={shopping ? 'basket' : 'inventory'}
              className="heading-doodle"
            />
          )}
        </div>
      )}
      <nav
        className={`workspace-nav${home ? ' home-nav' : ''}`}
        aria-label={tr('common:householdSectionsTitle')}
      >
        <Link
          className={home ? 'selected' : ''}
          aria-current={home ? 'page' : undefined}
          to={`${base}/home`}
        >
          <ControlIcon name="homeicon" />
          <span>{tr('common:home')}</span>
        </Link>
        <Link
          className={!home && !shopping && !members ? 'selected' : ''}
          aria-current={!home && !shopping && !members ? 'page' : undefined}
          to={`${base}/inventory`}
        >
          <ControlIcon name="clipboard" />
          <span>{tr('common:inventory')}</span>
        </Link>
        <Link
          className={shopping ? 'selected' : ''}
          aria-current={shopping ? 'page' : undefined}
          to={`${base}/shopping`}
        >
          <ControlIcon name="shoppingcart" />
          <span>{tr('common:shopping2')}</span>
        </Link>
        <Link to="/households">
          <ControlIcon name="warehouse" />
          <span>{tr('common:households')}</span>
        </Link>
      </nav>
      {children}
    </>
  );
}
