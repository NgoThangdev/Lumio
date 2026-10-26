import { useNavigate } from 'react-router';
import type { User } from '@/shared/api/types';
import { Button } from '@/shared/ui/primitives';
import { tr } from '@/shared/i18n';
import { AppearanceLanguageSection } from './AppearanceLanguageSection';
import { BrowserPushSection } from './BrowserPushSection';
import { HouseholdSettingsSection } from './HouseholdSettingsSection';
import { NotificationPreferencesSection } from './NotificationPreferencesSection';
import { OfflineAppSection } from './OfflineAppSection';
import { SignOutSection } from './SignOutSection';

export function SettingsPage({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => Promise<void>;
}) {
  const navigate = useNavigate();

  return (
    <section className="settings-page narrow">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">{tr('common:account')}</p>
          <h1>{tr('common:settings')}</h1>
          <p className="muted">{tr('settings:manageHouseholdShopping')}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {tr('common:back')}
        </Button>
      </div>
      <nav
        className="settings-jump-links"
        aria-label={tr('settings:settingsSections')}
      >
        <a href="#appearance-settings">{tr('settings:appearance')}</a>
        <a href="#household-settings">{tr('common:household')}</a>
        <a href="#notification-settings">{tr('notifications:notifications')}</a>
        <a href="#push-settings">{tr('notifications:browserPush')}</a>
        <a href="#offline-settings">{tr('settings:offlineApp')}</a>
      </nav>
      <AppearanceLanguageSection />
      <HouseholdSettingsSection />
      <OfflineAppSection />
      <NotificationPreferencesSection user={user} />
      <BrowserPushSection user={user} />
      <SignOutSection onSignOut={onSignOut} />
    </section>
  );
}
