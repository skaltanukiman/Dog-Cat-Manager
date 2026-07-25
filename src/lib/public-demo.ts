import type { Household } from "@prisma/client";

export const PUBLIC_DEMO_SLUG = "public-sample";
export const PUBLIC_DEMO_HOUSEHOLD_ID = "public-demo-household";
export const PUBLIC_DEMO_HOUSEHOLD_NAME = "サンプル飼育グループ";
export const PUBLIC_DEMO_DIFFERENCE_NOTICE =
  "機能紹介用のため、通常版とは一部の画面構成・表示内容・操作UIが異なる場合があります。";

export const PUBLIC_DEMO_HAMSTER_IDS = {
  kinako: "public-demo-hamster-kinako",
  komugi: "public-demo-hamster-komugi",
  azuki: "public-demo-hamster-azuki",
  monaka: "public-demo-hamster-monaka",
  kurumi: "public-demo-hamster-kurumi",
  goma: "public-demo-hamster-goma",
  milk: "public-demo-hamster-milk",
  shiratama: "public-demo-hamster-shiratama",
  potato: "public-demo-hamster-potato"
} as const;

export const PUBLIC_DEMO_RECORD_IDS = {
  kinakoHealth: "public-demo-record-kinako-health",
  kinakoMedical: "public-demo-record-kinako-medical",
  kinakoMemory: "public-demo-record-kinako-memory",
  komugiHealth: "public-demo-record-komugi-health",
  komugiMemory: "public-demo-record-komugi-memory",
  azukiMedical: "public-demo-record-azuki-medical",
  azukiMemory: "public-demo-record-azuki-memory",
  monakaHealth: "public-demo-record-monaka-health",
  monakaMemory: "public-demo-record-monaka-memory",
  kurumiHealth: "public-demo-record-kurumi-health",
  kurumiMemory: "public-demo-record-kurumi-memory",
  gomaMedical: "public-demo-record-goma-medical",
  gomaHealth: "public-demo-record-goma-health",
  gomaMemory: "public-demo-record-goma-memory",
  milkMemoryMorning: "public-demo-record-milk-memory-morning",
  milkMemoryPlay: "public-demo-record-milk-memory-play",
  milkHealth: "public-demo-record-milk-health",
  shiratamaMemory: "public-demo-record-shiratama-memory",
  shiratamaHealth: "public-demo-record-shiratama-health",
  potatoHealth: "public-demo-record-potato-health",
  potatoMemory: "public-demo-record-potato-memory"
} as const;

const DEMO_HAMSTER_IMAGE_PATHS: Readonly<Record<string, string>> = {
  [PUBLIC_DEMO_HAMSTER_IDS.kinako]: "/demo/hamsters/kinako.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.komugi]: "/demo/hamsters/komugi.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.azuki]: "/demo/hamsters/azuki.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.monaka]: "/demo/hamsters/monaka.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.kurumi]: "/demo/hamsters/kurumi.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.goma]: "/demo/hamsters/goma.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.milk]: "/demo/hamsters/milk.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.shiratama]: "/demo/hamsters/shiratama.svg",
  [PUBLIC_DEMO_HAMSTER_IDS.potato]: "/demo/hamsters/potato.svg"
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
