# Dog & Cat Manager 開発・運用

## 概要

Dog & Cat ManagerはNext.js App Router、Prisma、PostgreSQLで構成する犬・猫専用サービスです。現在のruntime domainは`Pet`だけを扱います。

主要画面:

- `/`: Pet Dashboard
- `/pets`: Petプロフィール
- `/weights`: Pet体重
- `/care`: 食事、水、DOG散歩、CAT猫トイレ
- `/records`: 健康、通院、投薬、ワクチン、思い出
- `/settings`: プロフィール、Dashboard、お世話日設定
- `/settings/members`: Household共有・メンバー管理
- `/contact`: 問い合わせ
- `/admin`: アプリ管理

認証が必要な画像・同期API:

- `/api/pets/[id]/image`
- `/api/pet-records/[id]/image`
- `/api/realtime/household`
- `/api/realtime/household/revision`
- `/api/realtime/contact`
- `/api/realtime/contact/revision`

公開APIはAuth.js callbackと`/api/health`に限定します。

## 技術スタック

- Node.js 22
- Next.js 16 / React 19
- TypeScript
- Prisma 6 / PostgreSQL 16
- Auth.js 5 beta / Google OAuth
- Tailwind CSS
- Sharp
- Winston / daily rotate file

## データ設計

### Householdと認可

`Household`を共有データ境界とし、`HouseholdMember`の`OWNER`、`ADMIN`、`MEMBER`、`VIEWER`で権限を管理します。取得時だけでなく、更新transaction内でも最新membershipと対象データのHousehold所属を確認します。

VIEWERは共有データを閲覧できますが、Pet、体重、Care、Records、メンバー情報を更新できません。管理終了Petも既存履歴の閲覧対象として保持し、新規更新を拒否します。

### Pet

- `Pet`: プロフィール、species、性別、暦日、管理状態
- `DashboardPet`: ユーザー・Household別Dashboard表示順
- `PetWeightRecord`: 日別体重
- `PetFeedingRecord` / `PetWaterRecord`: 共通Care履歴
- `PetWalkRecord`: DOG専用散歩履歴
- `PetLitterRecord`: CAT専用猫トイレ履歴
- `PetRecord`と種類別detail: 健康、通院、投薬、ワクチン、思い出
- `PetMemoryRecordPet`: 思い出と複数Petの関連
- `PetMemoryRecordImage`: 思い出画像メタデータ
- `SavedMemoryTag`: Household別の再利用可能な思い出タグ

`HealthOverallCondition`、`HealthAmountCondition`、`HealthExcretionCondition`、`HealthSymptom`はPet Healthで使用します。Pet Records検索はPostgreSQL `pg_trgm`を使います。

### timestampと暦日

- `createdAt`、`updatedAt`、`expiresAt`などのtimestampはUTCで保存する。
- 利用者向け画面では`src/lib/date.ts`の関数でJST表示する。
- 測定日、記録日、誕生日、迎え入れ日はDBの暦日をそのまま扱う。
- Pet Careだけは`Household.careDayStartMinutes`をJSTの切り替え境界として使う。

## 環境変数

用途に応じて`.env.example`、`.env.development.example`、`.env.production.example`を参照してください。秘密値をrepositoryへcommitしないでください。

```dotenv
DATABASE_URL=
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=

AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_URL=
AUTH_TRUST_HOST=true

LOG_LEVEL=info
LOG_DIR=/app/logs
LOG_RETENTION_DAYS=14
LOG_MAX_FILE_SIZE_MB=20

HOUSEHOLD_ACTIVITY_RETENTION_DAYS=90

PET_IMAGE_DIR=/app/uploads/pets
PET_RECORD_IMAGE_DIR=/app/uploads/pet-records
```

開発・本番でDB、`AUTH_SECRET`、Cookie、画像rootをほかのサービスと共有しないでください。Docker Composeのホスト側ポートはappが`127.0.0.1:3002`、DBが`127.0.0.1:5434`です。

## ローカル開発

依存関係をインストールします。

```bash
npm ci
```

環境ファイルを準備し、必要なPostgreSQLへ接続できる状態でPrisma Clientを生成します。

```bash
npx prisma generate
npm run dev
```

ホストから直接起動する場合の画像rootは、必要に応じて`./uploads/pets`と`./uploads/pet-records`を指定します。画像ファイル本体や絶対パスはDBへ保存せず、サーバー生成のファイル名だけを保持します。

## Prisma

schema確認:

```bash
npx prisma format
npx prisma validate
npx prisma generate
```

開発用migration作成は、対象DBと生成SQLを確認したうえで行います。

```bash
npm run prisma:migrate
```

本番適用:

```bash
npm run prisma:deploy
```

`prisma migrate deploy`、`prisma migrate dev`、`prisma db push`、`prisma migrate reset`は実DBへ影響します。実行前に接続先、バックアップ、migration SQL、ロールバック方針を確認してください。

### historical migration

`20260814090000_remove_hamster_legacy`より前には、派生元サービスのschemaを作成したhistorical migrationが残ります。過去migrationは編集・削除・squashしません。fresh DBでは過去構造を順に作成した後、撤去migrationが削除対象tableを空データpreflight付きで削除します。

撤去migrationは、削除対象tableまたは旧Activity eventに1行でもデータがあれば例外で停止します。自動でDELETEやTRUNCATEは行いません。停止した場合はデータの意味と移行方針を人が確認してから再実行します。

## Docker Compose

DockerfileはbuilderでPrisma Client生成とNext.js buildを行い、runner起動時に`prisma migrate deploy`を実行します。runnerは非rootユーザーで動作します。

```bash
docker compose up -d --wait --wait-timeout 120
docker compose logs -f app
docker compose down
```

永続化対象:

- PostgreSQL volume: `dog_cat_manager_pgdata`
- ログ: `./logs:/app/logs`
- Pet画像: `./uploads:/app/uploads`

runnerが利用するディレクトリは`/app/uploads/pets`と`/app/uploads/pet-records`だけです。

## 画像

Petプロフィール画像とPet Record画像は別rootへ保存します。

- 入力制約: `src/lib/image-constraints.ts`
- WebP変換: `src/lib/image-processing.ts`
- プロフィール保存・読取: `src/lib/pet-image.ts`
- Record画像保存・読取: `src/lib/pet-record-image.ts`

Household完全削除とアカウント削除では、DB commit後に対象Householdの2 rootだけを削除します。パス安全性違反は拒否し、一方のrootで失敗しても他方を試行します。削除失敗はwarningへ記録し、commit済みDB結果は変更しません。

## ログ

`src/lib/logger.ts`はJSON Linesを標準出力・標準エラーと`LOG_DIR`へ出力します。想定外例外はerrorIdを付与し、利用者画面とログを対応付けます。

```bash
npm run log:smoke
```

ログへsecret、Authorization、Cookie、問い合わせ本文、メール、画像本体を出さないでください。ログ保持期間と最大ファイルサイズは環境変数で設定します。

## 定期保守

各CLIは`--dry-run`で対象件数だけを確認できます。

```bash
npm run invitations:cleanup -- --dry-run
npm run household-activities:cleanup -- --dry-run
npm run contact-inquiries:auto-close -- --dry-run
```

書き込み実行:

```bash
npm run invitations:cleanup
npm run household-activities:cleanup
npm run contact-inquiries:auto-close
```

- 使用済み招待は90日、未使用の期限切れ招待は期限から30日保持する。
- Household Activityは`HOUSEHOLD_ACTIVITY_RETENTION_DAYS`以前を整理する。
- `RESOLVED`の問い合わせは`resolvedAt`から7日後に`CLOSED`へ移行する。

cronやschedulerから実行するときは、同じreleaseのコード、同じ環境ファイル、同じDB接続先を使ってください。まず`--dry-run`の監視を行い、標準出力・errorIdをログへ保存します。

## 管理者補助

アプリ管理権限:

```bash
npm run admin:grant -- --email user@example.com --role SUPER_ADMIN
npm run admin:revoke -- --email user@example.com
```

目視確認用seed:

```bash
npm run seed:admin-pagination
npm run seed:contact-inquiries
```

seedは実DBへの書き込みです。接続先と用途を確認し、本番では明示的な承認なしに実行しないでください。

全画面のUI確認には、再利用可能なdevelopment DB限定fixtureを使用できます。引数なしは対象User・DB・予定件数のpreviewだけを表示し、`--apply`を指定したときだけ投入します。Google Accountを持つ実利用者が複数いる場合は、対象を推測せず停止するため、`UI_FIXTURE_TARGET_USER_ID`で明示してください。接続先の明示overrideには`UI_FIXTURE_DATABASE_URL`を使用できます。

```bash
npm run seed:ui
npm run seed:ui -- --apply
npm run seed:ui:cleanup
```

seedとcleanupはDB URL上のDB名と実接続先の両方が`dog_cat_manager_dev`であることを検証します。fixture画像rootを個別指定する場合は`UI_FIXTURE_PET_IMAGE_DIR`と`UI_FIXTURE_PET_RECORD_IMAGE_DIR`を使用してください。

## 検証

変更範囲のテストを先に実行し、最終的に全体を確認します。

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
git diff -- README.md
```

`README.md`はrepository所有者の保護対象です。通常の実装・ドキュメント更新では変更しません。

## バックアップと更新

更新前に少なくとも次を同じ時点でバックアップします。

- PostgreSQL DB
- `uploads/pets`
- `uploads/pet-records`
- 本番環境ファイルとsecret管理側の設定

DBと画像は相互参照するため、同じ復旧点として扱います。deploymentではmigration SQLと生成Clientの整合、healthcheck、ログ、主要画面、認証付き画像、Household境界を確認してください。
