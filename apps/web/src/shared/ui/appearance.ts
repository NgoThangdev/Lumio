export type AppearanceChoice = 'system' | 'light' | 'dark';

const appearanceStorageKey = 'lumio-appearance';

export function readAppearanceChoice(): AppearanceChoice {
  try {
    const value = window.localStorage.getItem(appearanceStorageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyAppearance(choice = readAppearanceChoice()) {
  const root = document.documentElement;
  const dark =
    choice === 'dark' ||
    (choice === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#121a15' : '#faf9f5');
}

export function saveAppearanceChoice(choice: AppearanceChoice): boolean {
  try {
    if (choice === 'system')
      window.localStorage.removeItem(appearanceStorageKey);
    else window.localStorage.setItem(appearanceStorageKey, choice);
  } catch {
    applyAppearance(choice);
    return false;
  }
  applyAppearance(choice);
  return true;
}
