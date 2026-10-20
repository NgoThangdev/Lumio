import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export type TranslationNamespace = keyof typeof resources.en;
export type TranslationKey = {
  [N in TranslationNamespace]: keyof (typeof resources.en)[N] extends infer K
    ? K extends string
      ? `${N}:${K}`
      : never
    : never;
}[TranslationNamespace];

export function tr(
  key: TranslationKey,
  options?: Record<string, unknown>,
): string {
  const separator = key.indexOf(':');
  const namespace = key.slice(0, separator);
  const messageKey = key.slice(separator + 1);
  return (i18n.t as (key: string, options: Record<string, unknown>) => string)(
    messageKey,
    { ns: namespace, ...options },
  );
}

export function formatDate(
  value: string | Date,
  language = i18n.resolvedLanguage ?? 'en',
) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

export function formatDateOnly(
  value: string,
  language = i18n.resolvedLanguage ?? 'en',
) {
  const dateOnly = value.slice(0, 10);
  const date = new Date(`${dateOnly}T12:00:00+07:00`);
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

export function formatNumber(
  value: number | string,
  language = i18n.resolvedLanguage ?? 'en',
) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat(language, { maximumFractionDigits: 20 }).format(
    number,
  );
}

const knownApiErrors: Record<string, string> = {
  STOCK_CHANGED: 'common:stockChangedSince',
  BATCH_DETAIL_REQUIRED: 'common:batchDetailsRequired',
  LOCATION_REQUIRED: 'common:chooseLocationRecording',
  LOCATION_NOT_FOUND: 'common:locationFoundHousehold',
  LOCATION_NOT_IN_HOUSEHOLD: 'common:chooseLocationHousehold',
  INVALID_LOCATION_ID: 'common:chooseValidLocation',
  LOCATION_IN_USE: 'common:locationStillReferenced',
  CATEGORY_IN_USE: 'common:categoryStillReferenced',
  ACTIVE_TRIP_ENTRY: 'common:removeItemActive',
  DESTINATION_NOT_DRAFT: 'common:chooseDestinationTrip',
  LAST_ADMIN: 'common:householdKeepLeast',
  ALREADY_MEMBER: 'common:alreadyMemberHousehold',
  INVITATION_EXPIRED: 'common:invitationHasExpired',
  INVITATION_REVOKED: 'common:invitationRevoked',
  INVITATION_USED: 'common:invitationHasAlready',
  INVALID_DIGEST_TIME: 'common:chooseDigestTime',
  INVALID_NOTIFICATION_PREFERENCE: 'common:oneNotificationSettings',
  INVALID_QUIET_HOURS: 'common:enterValidQuiet',
  HOUSEHOLD_ADMIN_REQUIRED: 'common:onlyHouseholdAdmin3',
  HOUSEHOLD_MEMBERSHIP_REQUIRED: 'common:longerHaveAccess',
  ITEM_NOT_FOUND: 'common:itemFound',
  TRIP_NOT_FOUND: 'common:shoppingTripFound',
};

export function localizedError(error: unknown): string {
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  if (knownApiErrors[code]) return tr(knownApiErrors[code] as TranslationKey);
  if (error instanceof Error && error.name === 'OfflineBeforeSendError')
    return tr('common:reOfflineAction' as TranslationKey);
  if (error instanceof Error && error.name === 'MutationOutcomeUnknownError')
    return tr('common:requestStartedOutcome' as TranslationKey);
  if (
    error instanceof Error &&
    error.message &&
    !/^[A-Z][A-Z0-9_]+$/.test(error.message)
  ) {
    const networkCopy: Record<string, TranslationKey> = {
      'Failed to fetch': 'common:connectionReachedCheck',
      'NetworkError when attempting to fetch resource.':
        'common:connectionReachedCheck',
    };
    if (networkCopy[error.message]) return tr(networkCopy[error.message]);
    if ('status' in error) {
      const status =
        typeof error.status === 'number'
          ? `HTTP ${error.status}`
          : tr('common:server');
      return `${tr('common:somethingWentWrong')} (${status}: ${error.message})`;
    }
  }
  const diagnostic = code && /^[A-Z][A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  return `${tr('common:somethingWentWrong')}${diagnostic}`;
}

const apiLabels: Record<string, TranslationKey> = {
  QUANTITY: 'common:quantity',
  FIVE_LEVEL: 'common:fiveLevel',
  PRESENCE_BACKUP: 'common:presenceBackup',
  FULL: 'common:full',
  THREE_QUARTERS: 'common:threeQuarters',
  HALF: 'common:half',
  QUARTER: 'common:quarter',
  EMPTY: 'common:empty',
  CRITICAL: 'common:critical',
  HIGH: 'common:high',
  MEDIUM: 'common:medium',
  LOW: 'common:low',
  BUY: 'common:buy',
  OUT: 'common:out',
  OK: 'common:ok',
  EXPIRING: 'common:expiry',
  OPENED: 'common:opened',
  ACTIVE: 'common:active',
  EXPIRED: 'common:expired',
  REVOKED: 'common:revoked',
  USED: 'common:used',
  PENDING: 'common:pending',
  STALE: 'common:stale',
  USE_SOON: 'common:useSoon',
  NONE: 'common:none',
  RESTOCKED: 'common:restocked',
  CONFIRMED: 'common:confirmed',
  CORRECTED: 'common:corrected',
  PURCHASED: 'common:purchased',
  SKIPPED: 'common:skipped',
  MOVED: 'common:changeSaved',
  FRESH_FOOD: 'common:freshFood',
  MEAT_SEAFOOD: 'common:meatSeafood',
  DAIRY: 'common:dairy',
  PANTRY: 'common:pantry',
  DRINKS: 'common:drinks',
  HOUSEHOLD: 'common:household',
  PERSONAL_CARE: 'common:personalCare',
  OTHER: 'common:other',
  STALE_RECORD: 'common:stockRecordOut',
  RECENT_RECORD: 'common:stockRecentlyRecorded',
  MISSING_STATE: 'common:stateHasRecorded',
  NO_STOCK_RECORD: 'common:stockRecordOut',
  STOCK_CHANGED: 'common:stockChangedSince',
  USE: 'common:used2',
  RESTOCK: 'common:restocked2',
  INITIAL_STOCK: 'common:initialStock',
  OPEN: 'home:openedPackage',
  FINISH_OPENED: 'common:finishedOpenedStock',
  INITIALIZE: 'home:initialStateRecorded',
  UPDATE_LEVEL: 'common:levelUpdated',
  ADD_BACKUP: 'common:backup',
  OPEN_REFILL: 'home:openedRefill',
  SET_PRESENCE: 'home:presenceUpdated',
  UNDO: 'common:undo',
  SHOPPING_TRIP_COMPLETED: 'home:shoppingTripFinished',
  TRIP_STOCK_CORRECTED: 'home:shoppingStockCheck',
  LOCATION_STOCK_CORRECTED: 'home:locationStockCorrected',
};

export function localizedEnum(value: string | null | undefined): string {
  if (!value) return '';
  const key = apiLabels[value];
  return key ? tr(key) : value;
}

export type AppLanguage = 'en' | 'vi';
export const LANGUAGE_STORAGE_KEY = 'lumio-language';

function supportedLanguage(
  value: string | null | undefined,
): AppLanguage | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'vi' || normalized.startsWith('vi-')) return 'vi';
  return null;
}

function initialLanguage(): AppLanguage {
  try {
    const explicit = supportedLanguage(
      localStorage.getItem(LANGUAGE_STORAGE_KEY),
    );
    if (explicit) return explicit;
  } catch {
    // Storage may be disabled; use browser negotiation without persisting.
  }
  return supportedLanguage(navigator.language) ?? 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'vi'],
  defaultNS: 'common',
  ns: Object.keys(resources.en),
  keySeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function updateDocumentLanguage(language: string) {
  document.documentElement.lang = supportedLanguage(language) ?? 'en';
}

function syncServiceWorkerLanguage(language: string) {
  if (!('serviceWorker' in navigator)) return;
  let explicit = false;
  try {
    explicit = Boolean(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    // The service worker follows the browser language when storage is unavailable.
  }
  const message = {
    type: 'LUMIO_LANGUAGE',
    language: supportedLanguage(language) ?? 'en',
    explicit,
  };
  void navigator.serviceWorker.ready
    .then((registration) => {
      (navigator.serviceWorker.controller ?? registration.active)?.postMessage(
        message,
      );
    })
    .catch(() => undefined);
}

updateDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
syncServiceWorkerLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on('languageChanged', (language) => {
  updateDocumentLanguage(language);
  syncServiceWorkerLanguage(language);
});
window.addEventListener('languagechange', () => {
  try {
    if (localStorage.getItem(LANGUAGE_STORAGE_KEY)) return;
  } catch {
    // Follow the browser setting when storage is unavailable.
  }
  void i18n.changeLanguage(supportedLanguage(navigator.language) ?? 'en');
});
window.addEventListener('storage', (event) => {
  if (event.key !== LANGUAGE_STORAGE_KEY) return;
  const language = supportedLanguage(event.newValue);
  void i18n.changeLanguage(
    language ?? supportedLanguage(navigator.language) ?? 'en',
  );
});

export function saveLanguageChoice(language: AppLanguage | 'system') {
  try {
    if (language === 'system') localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The in-memory language still changes for this visit.
  }
  const next =
    language === 'system'
      ? (supportedLanguage(navigator.language) ?? 'en')
      : language;
  syncServiceWorkerLanguage(next);
  void i18n.changeLanguage(next);
}

export default i18n;
