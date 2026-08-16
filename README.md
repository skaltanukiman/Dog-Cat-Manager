# Dog & Cat Manager

Dog & Cat Manager は、犬・猫のプロフィールと日々の飼育記録をまとめて管理する Web アプリです。複数のペットを登録し、体重、お世話、健康・通院・投薬・ワクチン・思い出の記録を一か所で確認できます。

データは Household（共有グループ）単位で分離され、家族など複数の Google アカウントで共有できます。Household ごとの権限に応じて閲覧・編集・メンバー管理を制御し、複数の Household に参加している場合は操作対象を切り替えられます。

アプリケーションは Next.js App Router、Prisma、PostgreSQL で構成されています。Pet プロフィール画像と思い出画像は DB ではなくサーバーのファイルシステムへ保存し、Docker Compose では PostgreSQL、ログ、画像を永続化します。

## 主な機能

- **Pet Dashboard**: 管理中の犬・猫と当日のお世話状況を一覧表示。表示数、対象 Pet、並び順をユーザー・Household ごとに設定
- **Pet プロフィール**: 犬・猫の名前、犬種・猫種、性別、誕生日、迎え入れ日、メモ、プロフィール画像を管理。管理終了後も既存履歴を保持
- **体重**: Pet ごとに日別の体重とメモを記録し、グラフと履歴で推移を確認
- **Care**: 全 Pet 共通の食事・水、犬専用の散歩、猫専用の猫トイレを履歴として記録。Household ごとにお世話日の切り替え時刻を設定
- **Records**: 健康、通院、投薬、ワクチン、思い出を記録。Pet または Household 全体を対象に検索・絞り込み・ページング
- **思い出と画像**: 複数 Pet を一つの思い出へ関連付け、タグ、お気に入り、複数画像を保存
- **Household 共有**: 招待リンク、メンバー権限、Household 切り替え、退出・所有権移譲・削除、共有グループの操作履歴
- **認証**: Auth.js と Google OAuth によるログイン、DB セッション、利用停止ユーザーのログイン・既存セッション拒否
- **設定**: ユーザープロフィール、Records の初期表示範囲、Dashboard、お世話日の切り替え時刻、アカウント削除
- **サポート**: 利用者からの問い合わせ作成・履歴・返信と、管理者による検索・担当・ステータス・返信管理
- **アプリ全体管理**: ユーザー、利用状態、アプリ全体権限、Household、招待、問い合わせの管理
- **リアルタイム更新**: Household と問い合わせの変更を SSE で反映し、revision polling で取りこぼしを補完
- **PWA メタデータ**: ホーム画面追加用の Web App Manifest とアイコン

## 主要画面

通常画面は Google ログインが必要です。`/login`、招待受け入れ、Auth.js の callback、health API だけが公開されています。

| URL | 役割 |
| --- | --- |
| `/` | Pet Dashboard と当日のお世話状況 |
| `/pets` | Pet プロフィールの登録・編集・管理終了 |
| `/care` | 食事、水、散歩、猫トイレの記録 |
| `/records` | 健康、通院、投薬、ワクチン、思い出の記録・検索 |
| `/weights` | 体重の登録、グラフ、履歴 |
| `/settings` | プロフィール、Records、Dashboard、お世話日の設定 |
| `/settings/members` | Household 名、招待、メンバー権限、退出・削除、操作履歴 |
| `/contact` | 問い合わせの作成と履歴 |
| `/admin` | アプリ全体の管理トップ、招待一覧 |
| `/admin/users` | ユーザー、利用状態、アプリ全体権限の管理 |
| `/admin/households` | Household と所属メンバーの確認 |
| `/admin/inquiries` | 問い合わせ管理 |

## 技術スタック

| 分類 | 技術 |
| --- | --- |
| Runtime | Node.js 22 |
| Web | Next.js 16.2.9、React 19.2.7、TypeScript 5.9.3 |
| UI | Tailwind CSS 3.4.19、Lucide React、Recharts 3.9.0 |
| Database | PostgreSQL 16、Prisma 6.19.3 |
| Authentication | Auth.js 5.0.0-beta.31、Google OAuth、Prisma Adapter |
| Image | Sharp 0.34.0、WebP 変換、ローカルファイル保存 |
| Logging | Winston 3.19.0、日次ローテーション、JSON Lines |
| Infrastructure | Docker、Docker Compose、Next.js standalone output |
| Validation / Test | Zod、ESLint 9、Node.js test runner + `tsx` |

依存関係の正確なバージョン範囲は [`package.json`](package.json) と [`package-lock.json`](package-lock.json) を参照してください。

## アーキテクチャ概要

```text
Browser / PWA
  ├─ Google OAuth ── Auth.js ── DB Session
  └─ Next.js App Router
       ├─ Server Components / Server Actions / Route Handlers
       ├─ Prisma ── PostgreSQL
       ├─ Sharp ── uploads/pets
       │          └─ uploads/pet-records
       └─ Winston ── logs
```

- `Household` が共有データと認可の境界です。
- DB の timestamp は UTC で保存し、利用者向け画面では JST で表示します。
- 誕生日、迎え入れ日、測定日、記録日のような時刻を持たない日付は暦日のまま扱います。
- Pet Care だけは、Household に設定した JST の日替わり時刻をお世話日の境界に使用します。
- Pet プロフィール画像と思い出画像は Household ごとのディレクトリへ WebP で保存し、認証・Household 認可付き API から配信します。

## 必要なもの

ホスト上で開発サーバーを実行する場合:

- Node.js 22
- npm
- PostgreSQL 16、または DB だけを起動する Docker Compose 環境
- Google OAuth クライアント

アプリと DB を Docker で実行する場合:

- Docker Engine または Docker Desktop
- Docker Compose v2
- Google OAuth クライアント

## ローカル開発環境のセットアップ

### 1. リポジトリと依存関係

```bash
git clone https://github.com/skaltanukiman/Dog-Cat-Manager.git
cd Dog-Cat-Manager
npm ci
```

### 2. 環境ファイル

開発用の例を `.env` へコピーします。

```bash
cp .env.development.example .env
```

PowerShell の場合:

```powershell
Copy-Item .env.development.example .env
```

少なくとも `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET` を設定してください。ホストから `npm run dev` を実行する場合は、`.env` の次の値も変更します。

```dotenv
DATABASE_URL="postgresql://dog_cat_user:dev_password@localhost:5434/dog_cat_manager_dev?schema=public"
AUTH_URL="http://localhost:3000"
LOG_DIR="./logs"
PET_IMAGE_DIR="./uploads/pets"
PET_RECORD_IMAGE_DIR="./uploads/pet-records"
```

Google OAuth クライアントには、開発サーバーに合わせて次の redirect URI を登録します。

```text
http://localhost:3000/api/auth/callback/google
```

### 3. PostgreSQL

既存の PostgreSQL 16 を使用するか、Docker Compose で DB だけを起動します。

```bash
docker compose up -d db
```

Compose の PostgreSQL はホストの `127.0.0.1:5434` へ公開されます。ホストから実行する Prisma と Next.js は `localhost:5434`、Compose 内の `app` は `db:5432` を使用します。

### 4. Prisma と開発サーバー

```bash
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

起動後、`http://localhost:3000` を開きます。`prisma:migrate` は接続先 DB を変更するため、実行前に `DATABASE_URL` を確認してください。

## 環境変数

実値は `.env` にだけ保存し、secret をリポジトリへ commit しないでください。用途別のひな形は次の 3 ファイルです。

- [`.env.example`](.env.example): 標準構成
- [`.env.development.example`](.env.development.example): 開発 DB 用
- [`.env.production.example`](.env.production.example): 本番用の例

### アプリケーションと認証

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | 必須 | Prisma が接続する PostgreSQL URL。Compose 内は `db:5432`、ホストからは通常 `localhost:5434` |
| `AUTH_SECRET` | 必須 | Auth.js が使用する十分に強い秘密値 |
| `AUTH_GOOGLE_ID` | 必須 | Google OAuth Client ID |
| `AUTH_GOOGLE_SECRET` | 必須 | Google OAuth Client Secret |
| `AUTH_URL` | 必須 | アプリの外部 URL。redirect URI、招待リンク、Cookie の secure 判定に使用 |
| `AUTH_TRUST_HOST` | example で設定 | `true`。Auth.js の host 信頼設定を明示 |

`AUTH_SECRET` には十分に強いランダム値を使用し、共有・公開しないでください。本番の `AUTH_URL` は実際の HTTPS URL に変更します。

### PostgreSQL コンテナ

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `POSTGRES_DB` | Compose 利用時 | 作成する DB 名 |
| `POSTGRES_USER` | Compose 利用時 | PostgreSQL ユーザー |
| `POSTGRES_PASSWORD` | Compose 利用時 | PostgreSQL パスワード。本番では例示値を必ず変更 |

`POSTGRES_*` と `DATABASE_URL` の DB 名、ユーザー、パスワードを一致させてください。

### ログ、画像、保守

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `LOG_LEVEL` | 任意 | ログレベル。example は開発 `debug`、標準・本番 `info` |
| `LOG_DIR` | 任意 | ログ保存先。未指定時は `./logs`、Compose では `/app/logs` |
| `LOG_RETENTION_DAYS` | 任意 | ログ保持日数。example は `14` |
| `LOG_MAX_FILE_SIZE_MB` | 任意 | ログファイルの最大サイズ。example は `20` |
| `HOUSEHOLD_ACTIVITY_RETENTION_DAYS` | 保守 CLI 利用時 | Household 操作履歴の保持日数。example は `90` |
| `PET_IMAGE_DIR` | 任意 | Pet プロフィール画像の保存 root。未指定時は `./uploads/pets` |
| `PET_RECORD_IMAGE_DIR` | 任意 | 思い出画像の保存 root。未指定時は `./uploads/pet-records` |

seed / UI fixture 専用の override 変数は [開発・運用ドキュメント](docs/development-and-operations.md) を参照してください。

## Docker Compose での起動

### 1. 環境ファイルを準備

開発用途:

```bash
cp .env.development.example .env
```

本番相当:

```bash
cp .env.production.example .env
```

`.env` の secret、DB パスワード、`AUTH_URL` を実環境に合わせます。Compose 内では `DATABASE_URL` のホストを `db`、ポートを `5432` のまま使用します。

Google OAuth の redirect URI は、Compose の開発 URL なら次の値です。

```text
http://localhost:3002/api/auth/callback/google
```

### 2. ビルド・起動

```bash
docker compose up -d --build --wait --wait-timeout 120
docker compose logs -f app
```

- アプリ: `http://127.0.0.1:3002`
- PostgreSQL: `127.0.0.1:5434`
- health check: `http://127.0.0.1:3002/api/health`

アプリコンテナは起動時に `prisma migrate deploy` を実行します。migration が失敗した場合、アプリは起動しません。

### 3. 停止

```bash
docker compose down
```

`docker compose down` では DB volume とホスト側のログ・画像は残ります。`docker compose down -v` は PostgreSQL volume を削除するため、必要なデータがある環境では実行しないでください。

### 永続化先

| データ | 保存先 |
| --- | --- |
| PostgreSQL | Docker volume `dog_cat_manager_pgdata` |
| アプリログ | ホストの `./logs` |
| Pet プロフィール画像 | ホストの `./uploads/pets` |
| 思い出画像 | ホストの `./uploads/pet-records` |

Linux ホストでは、非 root のアプリユーザー（UID/GID `1001`）が `logs` と `uploads` へ書き込めるよう権限を設定してください。

```bash
mkdir -p logs uploads/pets uploads/pet-records
sudo chown -R 1001:1001 logs uploads
chmod 750 logs uploads uploads/pets uploads/pet-records
```

## Prisma / Database

Prisma schema は [`prisma/schema.prisma`](prisma/schema.prisma)、migration は [`prisma/migrations/`](prisma/migrations/) で管理しています。

```bash
# Prisma Client を生成
npm run prisma:generate

# 開発 DB に migration を適用し、schema 変更時は migration を作成
npm run prisma:migrate

# 既存 migration を本番・CIへ適用
npm run prisma:deploy

# schema の整形・検証
npx prisma format
npx prisma validate
```

`prisma migrate dev`、`prisma migrate deploy`、`prisma db push`、`prisma migrate reset` は接続先 DB を変更します。実行前に `DATABASE_URL`、バックアップ、生成 SQL を確認してください。

DB と `uploads/pets`、`uploads/pet-records` は相互参照するため、バックアップと復元では同じ時点の一組として扱います。

## 開発用コマンド

### 日常的に使用するコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Next.js 開発サーバーを起動 |
| `npm run build` | production build を作成 |
| `npm run start` | build 済みアプリを起動 |
| `npm run lint` | ESLint を実行 |
| `npm run typecheck` | Next.js の型生成後に TypeScript を検査 |
| `npm test` | `tests/**/*.test.ts(x)` を実行 |
| `npm run prisma:generate` | Prisma Client を生成 |
| `npm run prisma:migrate` | 開発用 migration を適用・作成 |
| `npm run prisma:deploy` | 既存 migration を適用 |
| `npm run log:smoke` | JSON Lines ログの smoke test |

### 保守コマンド

書き込み前に `--dry-run` で対象件数を確認できます。

```bash
npm run invitations:cleanup -- --dry-run
npm run household-activities:cleanup -- --dry-run
npm run contact-inquiries:auto-close -- --dry-run
```

実行時は `--dry-run` を外します。

- `invitations:cleanup`: 使用済み・期限切れの招待を保持期間に従って削除
- `household-activities:cleanup`: `HOUSEHOLD_ACTIVITY_RETENTION_DAYS` より古い操作履歴を削除
- `contact-inquiries:auto-close`: 対応済みから 7 日経過した問い合わせを終了へ移行

本番で定期実行する場合は、稼働中の `app` コンテナ内で同じ release、環境ファイル、DB 接続先を使用します。

```bash
docker compose exec -T app npm run invitations:cleanup -- --dry-run
```

## 権限

Household 内の権限と、アプリ全体の管理権限は別の概念です。

### Household 内の権限

| ロール | 主な権限 |
| --- | --- |
| `OWNER` | 共有データの閲覧・編集、招待、メンバー解除、ロール変更、Household 名・お世話日設定、所有権移譲・削除 |
| `ADMIN` | 共有データの閲覧・編集、招待、`MEMBER` / `VIEWER` の解除、お世話日設定 |
| `MEMBER` | 共有データの閲覧・編集 |
| `VIEWER` | 共有データの閲覧のみ |

### アプリ全体の権限

| ロール | 主な権限 |
| --- | --- |
| `USER` | 通常利用 |
| `ADMIN` | `/admin`、ユーザー・Household・招待・問い合わせの閲覧と問い合わせ対応 |
| `SUPER_ADMIN` | `ADMIN` の権限に加え、他ユーザーのアプリ全体ロールと利用停止・解除を管理 |

初期管理者を設定するには、対象の Google アカウントで一度ログインして `User` を作成してから CLI を実行します。

```bash
npm run admin:grant -- --email user@example.com --role SUPER_ADMIN
```

`--role` は `ADMIN` または `SUPER_ADMIN` を指定できます。省略時は `SUPER_ADMIN` です。通常ユーザーへ戻す場合:

```bash
npm run admin:revoke -- --email user@example.com
```

自分自身や最後の利用可能な `SUPER_ADMIN` を降格・利用停止する操作は拒否されます。

## テストと品質確認

変更範囲に応じて、次を実行します。CI では PostgreSQL 16 に migration を適用してから lint、typecheck、test、build を実行します。

```bash
npm run prisma:generate
npx prisma validate
npm run prisma:deploy
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

## ディレクトリ構成

```text
src/
├─ app/
│  ├─ (app)/              # 画面とレイアウト
│  ├─ actions/            # Server Actions
│  └─ api/                # Auth、health、画像、リアルタイム API
├─ components/            # UI コンポーネント
├─ lib/                   # 認可、DB query、日付、画像、ログなど
└─ auth.ts                # Auth.js 設定

prisma/
├─ schema.prisma
└─ migrations/

scripts/                  # 定期保守・診断 CLI
tests/                    # Node.js test runner のテスト
docs/                     # 設計、機能マップ、開発・運用資料
public/                   # PWA アイコンなどの静的ファイル
```

## デプロイ

現在の production image は Node.js 22 Alpine 上で Next.js standalone server を非 root ユーザーとして実行します。Compose のアプリポートは VPS ホストの `127.0.0.1:3002` にだけ公開されるため、外部公開時は HTTPS を終端する Nginx などの reverse proxy から転送してください。

基本的な更新手順:

```bash
git pull
docker compose build app
docker compose up -d --wait --wait-timeout 120
docker compose logs --tail=100 app
curl --fail http://127.0.0.1:3002/api/health
```

更新前に PostgreSQL、`uploads/pets`、`uploads/pet-records`、本番の secret 管理設定をバックアップしてください。DB migration の適用結果、Google ログイン、主要画面、認証付き画像、Household 境界、health check、ログを確認します。

公開ドメイン、reverse proxy、scheduler、バックアップ先はリポジトリで固定していません。実環境の運用方針に合わせて構成してください。

## 関連ドキュメント

- [機能マップ](docs/feature-map.md): 画面、Action / API、データアクセス、テストの対応
- [設計方針](docs/dog-cat-manager-design.md): Pet、Care、Records、認可、日付、リアルタイム、画像の設計
- [開発・運用](docs/development-and-operations.md): migration、ログ、保守 CLI、fixture、バックアップなどの詳細
