import { useEffect, useState } from 'react';
import {
  applyAppearance,
  readAppearanceChoice,
  saveAppearanceChoice,
  type AppearanceChoice,
} from '@/shared/ui/appearance';
import i18n, { saveLanguageChoice, type AppLanguage, tr } from '@/shared/i18n';
import { Button, Card } from '@/shared/ui/primitives';

export function AppearanceLanguageSection() {
  const [appearance, setAppearance] = useState(readAppearanceChoice);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [appearanceNotice, setAppearanceNotice] = useState('');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
      if (readAppearanceChoice() === 'system') applyAppearance('system');
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function chooseAppearance(choice: AppearanceChoice) {
    const persisted = saveAppearanceChoice(choice);
    setAppearance(choice);
    setAppearanceNotice(
      persisted
        ? choice === 'system'
          ? 'notifications:appearanceFollowingDevice'
          : choice === 'dark'
            ? 'notifications:darkModeSaved'
            : 'notifications:lightModeSaved'
        : 'notifications:appearanceSaveFailed',
    );
  }

  return (
    <Card id="appearance-settings" className="appearance-settings">
      <p className="eyebrow">{tr('notifications:browser')}</p>
      <h2>{tr('settings:appearance')}</h2>
      <p className="muted">{tr('settings:chooseDarkMode')}</p>
      <label className="preference-row appearance-switch">
        <span>
          <strong>{tr('settings:darkMode')}</strong>
          <small>
            {appearance === 'system'
              ? tr('settings:followingDeviceAppearance', {
                  mode: tr(systemDark ? 'common:dark' : 'settings:light'),
                })
              : tr('notifications:modeSelectedBrowser', {
                  mode: tr(
                    appearance === 'dark' ? 'common:dark' : 'settings:light',
                  ),
                })}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={appearance === 'system' ? systemDark : appearance === 'dark'}
          onChange={(event) =>
            chooseAppearance(event.target.checked ? 'dark' : 'light')
          }
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={appearance === 'system'}
        onClick={() => chooseAppearance('system')}
      >
        {tr('settings:useDeviceSetting')}
      </Button>
      {appearanceNotice && (
        <p className="muted" role="status">
          {tr(appearanceNotice as Parameters<typeof tr>[0])}
        </p>
      )}
      <label>
        {tr('settings:language')}
        <select
          value={i18n.resolvedLanguage === 'vi' ? 'vi' : 'en'}
          onChange={(event) =>
            saveLanguageChoice(event.target.value as AppLanguage)
          }
        >
          <option value="en">{tr('settings:english')}</option>
          <option value="vi">{tr('settings:vietnamese')}</option>
        </select>
      </label>
    </Card>
  );
}
