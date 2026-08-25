export const CLOUDFLARE_OAUTH_PROVIDER_ID = "cloudflare" as const;

export const R2_FREE_ALLOWANCE = {
  storageBytes: 10 * 1024 ** 3,
  writesAndLists: 1_000_000,
  readsAndChecks: 10_000_000,
} as const;

export const R2_PRICING = {
  storagePerGbMonthUsd: 0.015,
  writesPerMillionUsd: 4.5,
  readsPerMillionUsd: 0.36,
} as const;

export const MAX_UPLOAD_BYTES = 3 * 1024 ** 2;

export const KPI_LABELS = {
  writesAndLists: "Writes & lists",
  readsAndChecks: "Reads & checks",
  storage: "Storage",
  cost: "Cost",
} as const;
