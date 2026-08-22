# Dog & Cat Manager 設計方針

## サービスの位置づけ

Dog & Cat Managerは、犬・猫のプロフィール、お世話、体重、記録をHousehold単位で共有する独立サービスです。現在のruntime、Prisma schema、画面、Action、APIは`Pet` domainだけを扱います。

派生元のHamster Managerは別repository・別serviceとして運用し、DB、Session、Cookie、画像rootを共有しません。共通認証、Session共有、SSO、Household同期、ServiceSwitcherは現時点では実装しません。

## 共通基盤

- Auth.jsとPrisma Adapterで`User`、`Account`、`Session`、`VerificationToken`を管理する。
- `Household`、`HouseholdMember`、`HouseholdInvitation`を共有境界とし、すべての取得・更新で現在のmembershipを確認する。
- Household内ロールは`OWNER`、`ADMIN`、`MEMBER`、`VIEWER`。VIEWERは共有データを閲覧できるが更新できない。
- `Household.isDemo`は更新拒否に使う汎用認可属性として保持する。匿名デモrouteやデモデータ投入機能は持たない。
- 業務更新、`HouseholdActivity`、`realtimeRevision`増加は同一transactionで確定する。
- timestampはUTCで保存し、利用者向け表示は`src/lib/date.ts`でJSTへ変換する。測定日・記録日・誕生日などの暦日は変換しない。

## Petプロフィール

`Pet`はHouseholdに属し、犬・猫、性別、品種、生年月日、迎え入れ日、メモ、管理状態を保持します。

- speciesは作成後に変更しない。
- 管理終了後もPetと履歴を保持し、新規更新だけを拒否する。
- 同名制約はHousehold内だけに適用する。
- プロフィール画像は`PET_IMAGE_DIR`へHousehold別UUID WebPとして保存し、認証付き`/api/pets/[id]/image`からだけ配信する。
- 画像制約と変換は`src/lib/image-constraints.ts`、`src/lib/image-processing.ts`で共有する。

## Pet Dashboard

Dashboardは`DashboardPet`に保存されたPet順を優先し、`AppSetting.dashboardBoardCount`件を表示します。削除・管理終了・未知IDを除外し、不足分だけ現在Householdの管理中Petで補完します。

設定保存時は表示数と選択数の一致、重複、Household外IDをサーバー側でも検証します。並び順は`DashboardPet.sortOrder`へ保存し、通常のPet登録順とは分離します。

## Pet体重

`PetWeightRecord`はPetと測定日の組み合わせを一意にし、体重をkg単位のDecimalで保持します。

- 測定日は時刻を持たない暦日として扱う。
- VIEWER、管理終了Pet、別HouseholdのPetを更新できない。
- 一覧はDBページングし、グラフ取得件数には上限を設ける。
- Pet体重CSV exportは標準・詳細の2形式で提供する。詳細形式は将来の取込用に安定した識別列とschema versionを持つ。
- Pet体重CSV importは現時点では提供しない。

## Pet Care

`PetFeedingRecord`、`PetWaterRecord`、`PetWalkRecord`、`PetLitterRecord`を独立したイベント履歴として保存します。

- 食事・水は全Pet、散歩はDOG、猫トイレはCATだけに許可する。
- `Household.careDayStartMinutes`を4種類で共有し、JSTのお世話日境界を決める。
- 入力timestampはUTC保存し、未来時刻と送信されたお世話日の不一致を拒否する。
- ActionはFormDataのspeciesを信用せず、transaction内で取得したPetを確認する。
- Pet Care通知やデバイスAPIは提供しない。

## Pet Records

`PetRecord`を親に、健康、通院、投薬、ワクチン、思い出の5種類を扱います。

- 種類別detailは親と1対1で、親削除時にCascadeする。
- 思い出は`PetMemoryRecordPet`で複数Petに関連付け、代表Petも対象一覧へ必ず含める。
- `SavedMemoryTag`はHousehold単位の入力候補として再利用し、記録済みタグとは独立して削除できる。
- `HealthOverallCondition`、`HealthAmountCondition`、`HealthExcretionCondition`、`HealthSymptom`はPet Healthで利用する共有enumとして保持する。
- 検索用textとタグはDB側で絞り込み、PostgreSQL `pg_trgm`のGIN indexを維持する。
- 思い出画像は`PET_RECORD_IMAGE_DIR`へHousehold別UUID WebPとして保存し、認証付き`/api/pet-records/[id]/image`からだけ配信する。
- VIEWERと管理終了Petは閲覧・検索だけを許可する。

## Settings

設定画面は次だけを扱います。

- User表示名
- Pet Dashboardの表示数、対象Pet、順序
- Householdのお世話日切り替え時刻
- 問い合わせ、共有管理、アカウント削除への導線

フォームは`useActionState`で結果を受け取り、保存確定時だけdirty基準を更新します。個人設定は`AppSetting`、Household共通のお世話日境界は`Household`へ保存します。

## RealtimeとActivity

Household realtime sourceはPetプロフィール、Pet体重、4種類のPet Care、Pet Records、共有・メンバー・設定の共通更新だけを扱います。

- 業務データ、Activity、revisionを同一transactionで更新する。
- commit後にSSEをpublishし、失敗しても保存結果は失敗扱いにしない。
- SSEはプロセス内配信のため、DB revision pollingをフォールバックとして併用する。
- Activity detailsへCareやRecordsの自由入力本文を保存しない。

## 削除と画像後処理

Household完全削除とアカウント削除は、最新ロール・メンバー数・OWNER数・移譲先をtransaction内で再確認します。DB commit後に削除対象HouseholdのPetプロフィール画像とPet Record画像をそれぞれのrootから削除します。

画像パスはHousehold IDと生成済みファイル名を検証してroot外操作を拒否します。後処理失敗はwarningへ記録し、commit済みのDB結果を巻き戻しません。

## migration履歴

`prisma/migrations/20260814090000_remove_hamster_legacy`より前には、派生元domainを作成したhistorical migrationが残ります。migration履歴は書き換えません。

撤去migrationは次の安全策を持ちます。

- 削除対象tableに1行でもあれば`RAISE EXCEPTION`で停止する。
- 旧Activity event行があれば削除せず停止する。
- Activity enumは現行共通eventと`PET_*` eventだけで再作成する。
- Pet table、`DashboardPet`、`SavedMemoryTag`、共有Health enum、`pg_trgm`を削除しない。
- migrationファイルの作成とレビューを先に行い、実DBへの適用は別の承認済み運用作業とする。
