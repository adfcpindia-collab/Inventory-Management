export const ROLES = ['ADMIN', 'MANAGER', 'STORE', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const TRACKING_TYPES = ['NONE', 'BATCH', 'SERIAL'] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

export const PRODUCT_TYPES = [
  'FINISHED_GOOD',
  'SEMI_FINISHED',
  'RAW_MATERIAL',
  'COMPONENT',
  'CONSUMABLE',
  'OTHER',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
