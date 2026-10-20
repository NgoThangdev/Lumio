import commonEn from './locales/en/common.json';
import commonVi from './locales/vi/common.json';
import authEn from './locales/en/auth.json';
import authVi from './locales/vi/auth.json';
import householdsEn from './locales/en/households.json';
import householdsVi from './locales/vi/households.json';
import homeEn from './locales/en/home.json';
import homeVi from './locales/vi/home.json';
import attentionEn from './locales/en/attention.json';
import attentionVi from './locales/vi/attention.json';
import inventoryEn from './locales/en/inventory.json';
import inventoryVi from './locales/vi/inventory.json';
import itemDetailEn from './locales/en/item-detail.json';
import itemDetailVi from './locales/vi/item-detail.json';
import shoppingEn from './locales/en/shopping.json';
import shoppingVi from './locales/vi/shopping.json';
import settingsEn from './locales/en/settings.json';
import settingsVi from './locales/vi/settings.json';
import locationCheckEn from './locales/en/location-check.json';
import locationCheckVi from './locales/vi/location-check.json';
import notificationsEn from './locales/en/notifications.json';
import notificationsVi from './locales/vi/notifications.json';

export const resources = {
  en: {
    common: commonEn,
    auth: authEn,
    households: householdsEn,
    home: homeEn,
    attention: attentionEn,
    inventory: inventoryEn,
    'item-detail': itemDetailEn,
    shopping: shoppingEn,
    settings: settingsEn,
    'location-check': locationCheckEn,
    notifications: notificationsEn,
  },
  vi: {
    common: commonVi,
    auth: authVi,
    households: householdsVi,
    home: homeVi,
    attention: attentionVi,
    inventory: inventoryVi,
    'item-detail': itemDetailVi,
    shopping: shoppingVi,
    settings: settingsVi,
    'location-check': locationCheckVi,
    notifications: notificationsVi,
  },
} as const;
export const en = resources.en;
