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

function demoCreatedAt(order: number) {
  const value = relativeDate(-1000);
  value.setUTCHours(12, 0, order, 0);
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
      createdAt: demoCreatedAt(1),
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
      createdAt: demoCreatedAt(2),
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
      createdAt: demoCreatedAt(3),
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
    },
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.monaka,
      createdAt: demoCreatedAt(4),
      name: "もなか",
      memo: "お迎えしたばかり。夜になると回し車をゆっくり試しています。",
      birthDate: relativeDate(-150),
      adoptionDate: relativeDate(-52),
      isActive: true,
      weightRecords: {
        create: weightRows("monaka", [
          [-45, 29.6],
          [-31, 30.2],
          [-17, 30.8],
          [-4, 31.1]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("monaka", -12, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "新しい砂場の使い方を確認"
          }),
          cleaningRow("monaka", -3, {
            toiletCleaned: true,
            flooringPartCleaned: true,
            memo: "巣箱の近くを少量だけ交換"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.monakaHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-6),
            recordTimeMinutes: 20 * 60 + 10,
            title: "健康チェック: 環境に慣れてきた様子",
            memo: "食欲は安定。夕方から活動する時間が少しずつ増えています。",
            searchText: recordSearchText("健康チェック", "環境", "食欲", "活動量"),
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
            id: PUBLIC_DEMO_RECORD_IDS.monakaMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-38),
            title: "はじめての砂浴び",
            memo: "砂場で何度もくるんと回って、気持ちよさそうにしていました。",
            searchText: recordSearchText("はじめての砂浴び", "お迎え", "日常"),
            memoryDetail: {
              create: {
                tags: ["お迎え", "日常"],
                searchTags: ["お迎え", "日常"],
                isFavorite: false
              }
            }
          }
        ]
      }
    },
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.kurumi,
      createdAt: demoCreatedAt(5),
      name: "くるみ",
      memo: "慎重な性格。手のひらの匂いを確かめてから近づいてきます。",
      birthDate: relativeDate(-540),
      adoptionDate: relativeDate(-470),
      isActive: true,
      weightRecords: {
        create: weightRows("kurumi", [
          [-180, 46.1],
          [-150, 46.3],
          [-120, 46.4],
          [-90, 46.5],
          [-60, 46.7],
          [-30, 46.6],
          [-5, 46.8]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("kurumi", -21, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "砂場の砂を全量交換"
          }),
          cleaningRow("kurumi", -14, {
            toiletCleaned: true,
            flooringPartCleaned: true,
            memo: "給水器の周りを部分交換"
          }),
          cleaningRow("kurumi", -7, {
            toiletCleaned: true,
            houseCleaned: true,
            memo: "ハウスの中を整えて乾燥させた"
          }),
          cleaningRow("kurumi", -1, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "月末の砂場とトイレ掃除"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.kurumiHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-8),
            recordTimeMinutes: 21 * 60,
            title: "健康チェック: 良好",
            memo: "食欲、活動量、便の状態ともにいつもどおりです。",
            searchText: recordSearchText("健康チェック", "良好", "食欲", "活動量"),
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
            id: PUBLIC_DEMO_RECORD_IDS.kurumiMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-24),
            title: "ひまわりの種を見つけた日",
            memo: "お気に入りの種を巣箱まで大切に運んでいました。",
            searchText: recordSearchText("ひまわりの種", "食事", "かわいい行動"),
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
      id: PUBLIC_DEMO_HAMSTER_IDS.goma,
      createdAt: demoCreatedAt(6),
      name: "ごま",
      memo: "活発で、トンネルをくぐる遊びが好きです。",
      birthDate: relativeDate(-380),
      adoptionDate: relativeDate(-310),
      isActive: true,
      weightRecords: {
        create: weightRows("goma", [
          [-160, 34.8],
          [-130, 35.1],
          [-100, 35.0],
          [-70, 34.4],
          [-45, 34.6],
          [-20, 35.0],
          [-4, 35.2]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("goma", -19, {
            toiletCleaned: true,
            flooringPartCleaned: true,
            memo: "トンネル付近の床材を交換"
          }),
          cleaningRow("goma", -9, {
            toiletCleaned: true,
            bathCleaned: true,
            houseCleaned: true,
            memo: "遊び場とハウスをまとめて掃除"
          }),
          cleaningRow("goma", -2, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "今月の定期掃除"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.gomaMedical,
            recordType: "MEDICAL",
            recordDate: relativeDate(-54),
            title: "通院: 体重の変化を相談",
            memo: "一時的な体重の変化について相談し、食事と活動の様子を観察することにしました。",
            searchText: recordSearchText("通院", "体重", "食事", "サンプル動物クリニック"),
            medicalDetail: {
              create: {
                hospitalName: "サンプル動物クリニック",
                reason: "体重が少し下がったため確認",
                diagnosis: "急いだ対応は不要との説明",
                examination: "触診と体重測定",
                treatment: "食事量と活動量の記録を継続",
                nextVisitDate: relativeDate(-26),
                consultationFee: 2500
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.gomaHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-25),
            recordTimeMinutes: 18 * 60 + 40,
            title: "健康チェック: 回復傾向",
            memo: "食欲と活動量は戻り、便や尿の状態にも気になる点はありません。",
            searchText: recordSearchText("健康チェック", "回復", "食欲", "活動量"),
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
            id: PUBLIC_DEMO_RECORD_IDS.gomaMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-13),
            title: "トンネルを何度も往復",
            memo: "新しく置いたトンネルを気に入り、何度も顔を出して遊びました。",
            searchText: recordSearchText("トンネル", "遊び", "日常"),
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
      id: PUBLIC_DEMO_HAMSTER_IDS.milk,
      createdAt: demoCreatedAt(7),
      name: "みるく",
      memo: "砂場で長く過ごすことがあり、朝の様子を観察するのが楽しみです。",
      birthDate: relativeDate(-640),
      adoptionDate: relativeDate(-570),
      isActive: true,
      weightRecords: {
        create: weightRows("milk", [
          [-150, 40.2],
          [-120, 40.5],
          [-90, 40.7],
          [-60, 40.9],
          [-30, 41.0],
          [-3, 40.8]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("milk", -20, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "砂場の容器を洗って砂を交換"
          }),
          cleaningRow("milk", -11, {
            toiletCleaned: true,
            flooringPartCleaned: true,
            memo: "巣箱の入口まわりを部分交換"
          }),
          cleaningRow("milk", -6, {
            toiletCleaned: true,
            houseCleaned: true,
            memo: "ハウスの中を風通しよく整えた"
          }),
          cleaningRow("milk", -2, {
            toiletCleaned: true,
            bathCleaned: true,
            flooringAllCleaned: true,
            memo: "月初の床材全交換"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.milkMemoryMorning,
            recordType: "MEMORY",
            recordDate: relativeDate(-42),
            title: "朝の砂場タイム",
            memo: "砂場で丸くなって、しばらくのんびり過ごしていました。",
            searchText: recordSearchText("朝", "砂場", "寝姿", "日常"),
            memoryDetail: {
              create: {
                tags: ["寝姿", "日常"],
                searchTags: ["寝姿", "日常"],
                isFavorite: true
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.milkMemoryPlay,
            recordType: "MEMORY",
            recordDate: relativeDate(-16),
            title: "夏のひんやりプレート",
            memo: "暑い日にひんやりしたプレートの上で休憩していました。",
            searchText: recordSearchText("夏", "季節", "日常"),
            memoryDetail: {
              create: {
                tags: ["季節", "日常"],
                searchTags: ["季節", "日常"],
                isFavorite: false
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.milkHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-7),
            recordTimeMinutes: 7 * 60 + 20,
            title: "健康チェック: 良好",
            memo: "朝の食事も残さず、砂場や巣箱をいつもどおり行き来しています。",
            searchText: recordSearchText("健康チェック", "良好", "食事", "砂場"),
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
          }
        ]
      }
    },
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.shiratama,
      createdAt: demoCreatedAt(8),
      name: "しらたま",
      memo: "以前いっしょに暮らしていた子。穏やかな日々の記録を保管しています。",
      birthDate: relativeDate(-1120),
      adoptionDate: relativeDate(-1050),
      isActive: false,
      weightRecords: {
        create: weightRows("shiratama", [
          [-470, 31.4],
          [-440, 31.6],
          [-410, 31.7],
          [-380, 31.5]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("shiratama", -430, {
            toiletCleaned: true,
            bathCleaned: true,
            memo: "当時の砂場とトイレ掃除"
          }),
          cleaningRow("shiratama", -395, {
            toiletCleaned: true,
            flooringAllCleaned: true,
            houseCleaned: true,
            memo: "季節の変わり目に床材を交換"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.shiratamaMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-405),
            title: "窓辺でのんびり",
            memo: "明るい時間に巣箱から出て、静かに毛づくろいをしていました。",
            searchText: recordSearchText("窓辺", "寝姿", "思い出"),
            memoryDetail: {
              create: {
                tags: ["寝姿", "思い出"],
                searchTags: ["寝姿", "思い出"],
                isFavorite: true
              }
            }
          },
          {
            id: PUBLIC_DEMO_RECORD_IDS.shiratamaHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-420),
            recordTimeMinutes: 18 * 60,
            title: "健康チェック: 穏やか",
            memo: "食欲と活動量は落ち着いており、ゆっくり過ごしていました。",
            searchText: recordSearchText("健康チェック", "穏やか", "過去の記録"),
            healthDetail: {
              create: {
                overallCondition: "GOOD",
                appetite: "NORMAL",
                activityLevel: "LOW",
                stoolCondition: "NORMAL",
                urineCondition: "NORMAL",
                symptoms: []
              }
            }
          }
        ]
      }
    },
    {
      id: PUBLIC_DEMO_HAMSTER_IDS.potato,
      createdAt: demoCreatedAt(9),
      name: "ぽてと",
      memo: "以前の飼育記録。食べ物を巣箱へ運ぶ姿が印象に残っています。",
      birthDate: relativeDate(-980),
      adoptionDate: relativeDate(-910),
      isActive: false,
      weightRecords: {
        create: weightRows("potato", [
          [-330, 48.0],
          [-300, 48.4],
          [-270, 48.2],
          [-240, 48.5],
          [-210, 48.3]
        ])
      },
      cleaningRecords: {
        create: [
          cleaningRow("potato", -285, {
            toiletCleaned: true,
            flooringPartCleaned: true,
            memo: "巣箱の近くを部分交換"
          }),
          cleaningRow("potato", -230, {
            toiletCleaned: true,
            bathCleaned: true,
            houseCleaned: true,
            memo: "ハウスと砂場を丁寧に掃除"
          })
        ]
      },
      records: {
        create: [
          {
            id: PUBLIC_DEMO_RECORD_IDS.potatoHealth,
            recordType: "HEALTH",
            recordDate: relativeDate(-235),
            recordTimeMinutes: 19 * 60 + 15,
            title: "健康チェック: 食欲は良好",
            memo: "好物のペレットをよく食べ、夜の活動量も十分でした。",
            searchText: recordSearchText("健康チェック", "食欲", "活動量", "過去の記録"),
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
            id: PUBLIC_DEMO_RECORD_IDS.potatoMemory,
            recordType: "MEMORY",
            recordDate: relativeDate(-250),
            title: "巣箱へおやつを運ぶ",
            memo: "小さなおやつを何度も運んで、巣箱に大切にしまっていました。",
            searchText: recordSearchText("おやつ", "食事", "かわいい行動", "思い出"),
            memoryDetail: {
              create: {
                tags: ["食事", "かわいい行動", "思い出"],
                searchTags: ["食事", "かわいい行動", "思い出"],
                isFavorite: false
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
            { id: "public-demo-tag-memory", name: "思い出", normalizedName: "思い出" },
            { id: "public-demo-tag-sleep", name: "寝姿", normalizedName: "寝姿" },
            { id: "public-demo-tag-cute", name: "かわいい行動", normalizedName: "かわいい行動" },
            { id: "public-demo-tag-welcome", name: "お迎え", normalizedName: "お迎え" },
            { id: "public-demo-tag-season", name: "季節", normalizedName: "季節" }
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
