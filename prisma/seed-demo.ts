import { PrismaClient, type Prisma } from "@prisma/client";
import { pathToFileURL } from "node:url";

import { parseDateInput, todayInputJst, toDateInputValue } from "../src/lib/date";
import {
  isPublicDemoHousehold,
  PUBLIC_DEMO_HAMSTER_IDS,
  PUBLIC_DEMO_HOUSEHOLD_ID,
  PUBLIC_DEMO_HOUSEHOLD_NAME,
  PUBLIC_DEMO_RECORD_IDS,
  PUBLIC_DEMO_SLUG
} from "../src/lib/public-demo";

function relativeDate(days: number, today = todayInputJst()) {
  const value = parseDateInput(today);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function weightRows(
  hamsterKey: string,
  points: ReadonlyArray<readonly [daysAgo: number, weightG: number]>
): Prisma.WeightRecordCreateWithoutHamsterInput[] {
  return points.map(([daysAgo, weightG], index) => ({
    id: `public-demo-weight-${hamsterKey}-${index + 1}`,
    recordDate: relativeDate(daysAgo),
    weightG
  }));
}

function cleaningRow(
  hamsterKey: string,
  daysAgo: number,
  values: Omit<Prisma.CleaningRecordCreateWithoutHamsterInput, "id" | "recordDate">
): Prisma.CleaningRecordCreateWithoutHamsterInput {
  return {
    id: `public-demo-cleaning-${hamsterKey}-${Math.abs(daysAgo)}`,
    recordDate: relativeDate(daysAgo),
    ...values
  };
}

function recordSearchText(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join("\n").normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function demoHamsters(): Prisma.HamsterCreateWithoutHouseholdInput[] {
  const kinakoHealthMemo = "食欲・活動量ともに普段どおり。毛並みもきれいです。";
  const komugiHealthMemo = "少しくしゃみがあったため、床材のほこりを確認しました。";
  const kinakoMedicalReason = "右目を細める様子が続いたため相談";
  const azukiMedicalReason = "食欲が落ちたため健康状態を確認";

  return [
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.kinako,
      name: "きなこ",
      memo: "好奇心旺盛。夕方になると回し車で遊び始めます。",
      birthDate: relativeDate(-420),
      adoptionDate: relativeDate(-360),
      isActive: true,
      weightRecords: {
        create: weightRows("kinako", [
          [-120, 37.4],
          [-105, 37.8],
          [-90, 38.1],
          [-75, 38.3],
          [-60, 38.7],
          [-45, 38.9],
          [-30, 39.0],
          [-15, 39.2],
          [-3, 39.1]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("kinako", -18, {
            toiletCleaned: true,
            bathCleaned: true,
            flooringPartCleaned: true,
            memo: "汚れた部分の床材も交換"
          }),
          cleaningRow("kinako", -10, {
            toiletCleaned: true,
            houseCleaned: true,
            memo: "ハウス内の貯蔵ごはんを確認"
          }),
          cleaningRow("kinako", -5, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "砂を全量交換"
          }),
          cleaningRow("kinako", -2, {
            toiletCleaned: true,
            flooringAllCleaned: true,
            houseCleaned: true,
            memo: "月例の全体掃除"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.kinakoHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-4),
            recordTimeMinutes: 19 * 60 + 30,
            title: "健康チェック: 良好",
            memo: kinakoHealthMemo,
            searchText: recordSearchText("健康チェック", "良好", kinakoHealthMemo),
            healthDetail: {
              create: {
                overallCondition: "GOOD",
                appetite: "NORMAL",
                activityLevel: "NORMAL",
                stoolCondition: "NORMAL",
                urineCondition: "NORMAL",
                symptoms: []
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.kinakoMedical,
            recordType: "MEDICAL",
            recordDate: relativeDate(-52),
            title: "通院: サンプル動物クリニック",
            memo: "点眼後は落ち着き、翌週には普段どおりになりました。",
            searchText: recordSearchText("通院", kinakoMedicalReason, "目薬"),
            medicalDetail: {
              create: {
                hospitalName: "サンプル動物クリニック",
                reason: kinakoMedicalReason,
                diagnosis: "軽い結膜の刺激",
                examination: "目と周辺の状態を確認",
                treatment: "洗眼",
                medication: "サンプル点眼薬",
                medicationInstructions: "1日1回、3日間",
                consultationFee: 3200
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.kinakoMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-20),
            title: "お気に入りのおやつ",
            memo: "小さく切った野菜を両手で持って、ゆっくり食べていました。",
            searchText: recordSearchText("お気に入りのおやつ", "食事", "かわいい行動"),
            memoryDetail: {
              create: {
                tags: ["食事", "かわいい行動"],
                searchTags: ["食事", "かわいい行動"],
                isFavorite: true
              }
            }
          }
        ]
      }
    },
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.komugi,
      name: "こむぎ",
      memo: "のんびり屋。巣箱の入口で眠ることがあります。",
      birthDate: relativeDate(-310),
      adoptionDate: relativeDate(-250),
      isActive: true,
      weightRecords: {
        create: weightRows("komugi", [
          [-120, 42.8],
          [-100, 42.6],
          [-80, 42.5],
          [-60, 42.3],
          [-40, 42.4],
          [-20, 42.1],
          [-6, 42.2]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("komugi", -16, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "砂場の容器も水洗い"
          }),
          cleaningRow("komugi", -8, {
            toiletCleaned: true,
            flooringPartCleaned: true,
            memo: "給水器の下を部分交換"
          }),
          cleaningRow("komugi", -3, {
            toiletCleaned: true,
            houseCleaned: true,
            memo: "巣材を少し残して掃除"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.komugiHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-9),
            recordTimeMinutes: 8 * 60,
            title: "健康チェック: 少し気になる",
            memo: komugiHealthMemo,
            searchText: recordSearchText("健康チェック", "くしゃみ", komugiHealthMemo),
            healthDetail: {
              create: {
                overallCondition: "CONCERN",
                appetite: "NORMAL",
                activityLevel: "NORMAL",
                stoolCondition: "NORMAL",
                urineCondition: "NORMAL",
                symptoms: ["SNEEZING"]
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.komugiMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-35),
            title: "トンネル遊び",
            memo: "紙筒をつなげたトンネルを何度も往復していました。",
            searchText: recordSearchText("トンネル遊び", "遊び", "日常"),
            memoryDetail: {
              create: {
                tags: ["遊び", "日常"],
                searchTags: ["遊び", "日常"],
                isFavorite: false
              }
            }
          }
        ]
      }
    },
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.azuki,
      name: "あずき",
      memo: "以前いっしょに暮らしていた子。過去の記録を保管しています。",
      birthDate: relativeDate(-900),
      adoptionDate: relativeDate(-830),
      isActive: false,
      weightRecords: {
        create: weightRows("azuki", [
          [-260, 35.8],
          [-240, 36.1],
          [-220, 36.0],
          [-200, 35.7],
          [-180, 35.5],
          [-160, 35.4]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("azuki", -205, {
            toiletCleaned: true,
            bathCleaned: true,
            flooringPartCleaned: true,
            memo: "当時の定期掃除記録"
          }),
          cleaningRow("azuki", -190, {
            toiletCleaned: true,
            flooringAllCleaned: true,
            houseCleaned: true,
            memo: "床材と巣材を交換"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.azukiMedical,
            recordType: "MEDICAL",
            recordDate: relativeDate(-175),
            title: "通院: サンプル動物クリニック",
            memo: "食事内容を調整しながら経過を観察しました。",
            searchText: recordSearchText("通院", azukiMedicalReason, "食欲"),
            medicalDetail: {
              create: {
                hospitalName: "サンプル動物クリニック",
                reason: azukiMedicalReason,
                diagnosis: "年齢に伴う体調変化",
                examination: "触診と体重測定",
                treatment: "食事内容の相談",
                consultationFee: 2800
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.azukiMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-210),
            title: "静かな昼下がり",
            memo: "巣箱から顔を出して、しばらくこちらを眺めていました。",
            searchText: recordSearchText("静かな昼下がり", "思い出", "寝姿"),
            memoryDetail: {
              create: {
                tags: ["思い出", "寝姿"],
                searchTags: ["思い出", "寝姿"],
                isFavorite: true
              }
            }
          }
        ]
      }
    }
  ];
}

export async function rebuildPublicDemoData(client: PrismaClient) {
  await client.$transaction(async (tx) => {
    const [slugTarget, idTarget] = await Promise.all([
      tx.household.findUnique({
        where: { demoSlug: PUBLIC_DEMO_SLUG },
        select: { id: true, isDemo: true, demoSlug: true, _count: { select: { members: true } } }
      }),
      tx.household.findUnique({
        where: { id: PUBLIC_DEMO_HOUSEHOLD_ID },
        select: { id: true, isDemo: true, demoSlug: true, _count: { select: { members: true } } }
      })
    ]);

    if (slugTarget && !isPublicDemoHousehold(slugTarget)) {
      throw new Error("固定デモ識別子が通常Householdに使用されているため、デモseedを中止しました。");
    }
    if (idTarget && !isPublicDemoHousehold(idTarget)) {
      throw new Error("固定デモIDが通常Householdに使用されているため、デモseedを中止しました。");
    }
    if (slugTarget && idTarget && slugTarget.id !== idTarget.id) {
      throw new Error("デモHouseholdの固定識別子が競合しているため、デモseedを中止しました。");
    }

    const existingDemo = slugTarget ?? idTarget;
    if (existingDemo?._count.members) {
      throw new Error("デモHouseholdにユーザー所属があるため、安全のためデモseedを中止しました。");
    }

    if (existingDemo) {
      await tx.household.delete({ where: { id: existingDemo.id } });
    }

    await tx.household.create({
      data: {
        id: PUBLIC_DEMO_HOUSEHOLD_ID,
        name: PUBLIC_DEMO_HOUSEHOLD_NAME,
        isDemo: true,
        demoSlug: PUBLIC_DEMO_SLUG,
        hamsters: {
          create: demoHamsters()
        },
        savedMemoryTags: {
          create: [
            { id: "public-demo-tag-daily", name: "日常", normalizedName: "日常" },
            { id: "public-demo-tag-food", name: "食事", normalizedName: "食事" },
            { id: "public-demo-tag-play", name: "遊び", normalizedName: "遊び" },
            { id: "public-demo-tag-memory", name: "思い出", normalizedName: "思い出" }
          ]
        }
      }
    });
  });
}

async function main() {
  const client = new PrismaClient();
  try {
    await rebuildPublicDemoData(client);
    console.log(`デモデータを再構築しました（JST基準日: ${toDateInputValue(relativeDate(0))}）。`);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
