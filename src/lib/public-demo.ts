import type { Household } from "@prisma/client";

export const PUBLIC_DEMO_SLUG = "public-sample";
export const PUBLIC_DEMO_HOUSEHOLD_ID = "public-demo-household";
export const PUBLIC_DEMO_HOUSEHOLD_NAME = "サンプル飼育グループ";
export const REQUEST_PATHNAME_HEADER = "x-hamster-manager-pathname";

export const PUBLIC_DEMO_HAMSTER_IDS = {
  kinako: "public-demo-hamster-kinako",
  komugi: "public-demo-hamster-komugi",
  azuki: "public-demo-hamster-azuki"
} as const;

export const PUBLIC_DEMO_RECORD_IDS = {
  kinakoHealth: "public-demo-record-kinako-health",
  kinakoMedical: "public-demo-record-kinako-medical",
  kinakoMemory: "public-demo-record-kinako-memory",
  komugiHealth: "public-demo-record-komugi-health",
  komugiMemory: "public-demo-record-komugi-memory",
  azukiMedical: "public-demo-record-azuki-medical",
  azukiMemory: "public-demo-record-azuki-memory"
} as const;

const DEMO_HAMSTER_IMAGE_PATHS: Readonly<Record<string, string>> = {
  [PUBLIC_DEMO_HAMSTER_IDS.kinako]: "/demo/hamsters/kinako.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.komugi]: "/demo/hamsters/komugi.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.azuki]: "/demo/hamsters/azuki.svg"
};

const DEMO_RECORD_IMAGE_PATHS: Readonly<Record<string, string>> = {
  [PUBLIC_DEMO_RECORD_IDS.kinakoMemory]: "/demo/records/health-sample.svg",
  [PUBLIC_DEMO_RECORD_IDS.komugiMemory]: "/demo/records/playtime-sample.svg",
  [PUBLIC_DEMO_RECORD_IDS.azukiMemory]: "/demo/records/memory-sample.svg"
};

export function isPublicDemoPath(pathname: string) {
  return pathname === "/demo" || pathname.startsWith("/demo/");
}

export function getPublicDemoHamsterImagePath(hamsterId: string) {
  return DEMO_HAMSTER_IMAGE_PATHS[hamsterId] ?? null;
}

export function getPublicDemoRecordImagePath(recordId: string) {
  return DEMO_RECORD_IMAGE_PATHS[recordId] ?? null;
}

export function isPublicDemoHousehold(
  household: Pick<Household, "isDemo" | "demoSlug"> | null | undefined
) {
  return household?.isDemo === true && household.demoSlug === PUBLIC_DEMO_SLUG;
}
