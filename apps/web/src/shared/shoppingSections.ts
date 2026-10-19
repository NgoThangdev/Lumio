export const shoppingSections = [
  { code: 'FRESH_FOOD', label: 'Fresh food' },
  { code: 'MEAT_SEAFOOD', label: 'Meat & seafood' },
  { code: 'DAIRY', label: 'Dairy' },
  { code: 'PANTRY', label: 'Pantry' },
  { code: 'DRINKS', label: 'Drinks' },
  { code: 'HOUSEHOLD', label: 'Household' },
  { code: 'PERSONAL_CARE', label: 'Personal care' },
  { code: 'OTHER', label: 'Other' },
] as const;

export type ShoppingSection = (typeof shoppingSections)[number]['code'];
export type CategoryShoppingSection = Exclude<ShoppingSection, 'OTHER'>;
