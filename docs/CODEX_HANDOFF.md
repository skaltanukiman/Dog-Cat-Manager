# Codex Handoff

このドキュメントは、新しい Codex チャットへ作業を引き継ぐためのメモです。ユーザー向けの正式なセットアップ・運用手順は `README.md` を参照してください。

## 新チャットで最初に伝えること

新しいチャットでは、まず `docs/NEW_CHAT_PROMPT.md` の内容を貼り付けてください。そのうえで、実装前に現在の `README.md` と対象ファイルを確認してから作業を始めると安全です。

## リポジトリ

- ローカル作業場所: `C:\Users\sound\source\repos\Hamster-Manager-Browser`
- GitHub リポジトリ: `skaltanukiman/Hamster-Manager-Browser`
- アプリ名: Hamster Manager Browser
- 用途: GAS / Google スプレッドシートで管理していたハムスターの衛生管理・体重管理を Web アプリ化する

注意:

- Codex の実行環境が別パスを `cwd` として示すことがあるが、実作業は `C:\Users\sound\source\repos\Hamster-Manager-Browser` で行ってきた。
- 既存のユーザー変更を勝手に戻さない。
- README や docs のみ変更など、ユーザーが範囲を限定した場合は必ずその範囲だけ変更する。
- このチャットのように `cwd` が OneDrive 側の空に近いパスを示す場合でも、実体のあるリポジトリを確認してから作業する。

## 技術スタック

- Next.js
- TypeScript
- Prisma
- PostgreSQL
- Auth.js / NextAuth
- Tailwind CSS
- Recharts
- Zod
- Docker
- Docker Compose

## 環境と運用方針

- SQLite は使わず、最初から PostgreSQL 前提。
- PostgreSQL は Docker Compose の `db` コンテナで動かす。
- Next.js アプリは Docker Compose の `app` コンテナで動かす。
- 既存の `discord-game-bot` など PM2 管理アプリとは分離する。
- このアプリでは PM2 を使わない。
- Docker Compose のコンテナ名:
  - `dog-cat-manager-web`
  - `dog-cat-manager-db`
- ホスト側ポート:
  - Next.js: `3002`
  - PostgreSQL: `127.0.0.1:5433`
- コンテナ内ポート:
  - Next.js: `3000`
  - PostgreSQL: `5432`
- Docker コンテナ間の `DATABASE_URL` はホスト名 `db` を使う。
- ホスト PC から DB に接続する場合は `localhost:5434` を使う。

## env の考え方

実データ用の `.env` は Git 管理しない。

存在する example:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

Docker Compose は `ENV_FILE` で読み込む env ファイルを切り替える。

PowerShell 例:

```powershell
$env:ENV_FILE=".env.development"
docker compose up -d
```

Docker Compose 内で app から db に接続する場合:

```env
DATABASE_URL="postgresql://dog_cat_user:dev_password@db:5432/dog_cat_manager_dev?schema=public"
POSTGRES_DB="dog_cat_manager_dev"
POSTGRES_USER="dog_cat_user"
POSTGRES_PASSWORD="dev_password"
```

Auth.js / Google OAuth 用:

```env
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_URL="http://localhost:3002"
AUTH_TRUST_HOST=true

LOG_LEVEL=debug
LOG_DIR=/app/logs
LOG_RETENTION_DAYS=14
LOG_MAX_FILE_SIZE_MB=20
HAMSTER_IMAGE_DIR=/app/uploads/hamsters
```

現行 Auth.js v5 系では `NEXTAUTH_URL` ではなく `AUTH_URL` を使う。Google OAuth の Callback URL は `/api/auth/callback/google`。Docker Compose の app はDog & Cat Manager専用のホストポート `127.0.0.1:3002` のみに公開し、本番では Nginx / HTTPS を経由させる。Auth.js Cookieは `dog-cat-manager.authjs` prefixで分離し、HTTPSではAuth.jsの規則どおり `__Secure-`（CSRFは `__Host-`）を付ける。`.env.production.example` の `AUTH_URL` は実際のHTTPSドメインへ変更する。

ホスト PC で `npm run dev` し、DB だけ Docker で動かす場合:

```env
DATABASE_URL="postgresql://dog_cat_user:dev_password@localhost:5434/dog_cat_manager_dev?schema=public"
POSTGRES_DB="dog_cat_manager_dev"
POSTGRES_USER="dog_cat_user"
POSTGRES_PASSWORD="dev_password"
```

`DATABASE_URL` のユーザー名、パスワード、DB 名は `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` と合わせる。

## よく使うコマンド

ローカル開発:

```powershell
npm install
docker compose up -d db
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Docker Compose でまとめて起動:

```powershell
$env:ENV_FILE=".env.development"
docker compose build app
docker compose up -d
```

app コンテナは起動時に `prisma migrate deploy` を自動実行し、成功後に Next.js を起動する。新しい Prisma Client と未更新DBの不整合を残さない。

サーバーログは `src/lib/logger.ts` のWinstonロガーからDocker標準出力・標準エラーと `/app/logs/application-YYYY-MM-DD.log` へJSON Lines形式で二重出力する。プロフィール画像は `./uploads:/app/uploads` へバインドし、`HAMSTER_IMAGE_DIR=/app/uploads/hamsters` に保存する。VPSでは事前に `mkdir -p logs uploads/hamsters && sudo chown -R 1001:1001 logs uploads && chmod 750 logs uploads uploads/hamsters` を実行する。`errorId` は両ログ出力で一致する。ループバック限定のため、LANやTailscale IPから `:3002` へ直接アクセスするスマートフォン確認には別の開発用公開設定が必要。

確認:

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
docker compose ps
```

Prisma:

```powershell
npm run migrate:assign-owner -- --email example@gmail.com
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:generate
npm run prisma:seed
```

開発中は `migrate dev`、本番反映は `migrate deploy` を使う。

## Windows 開発用スクリプト

- `start-dev.bat`
- `start-dev.ps1`

基本は `start-dev.bat` から起動する想定。

`start-dev.bat` は以下のように PowerShell を起動する。

```bat
powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
```

`-ExecutionPolicy Bypass` は `.ps1` や `npm.ps1` が実行ポリシーでブロックされる環境向けの対策。Docker 未インストール、ポート使用中、env 不備などを回避するものではない。

## VPS デプロイ方針

- さくらの VPS / Ubuntu 想定。
- `/home/ubuntu` 直下ではなく、アプリ専用ユーザーのホーム配下へ置く方針。
- 例: `/home/hamster/apps/hamster-manager-browser`
- Docker Compose で起動するため、ホスト側 Node.js のバージョンには依存しない。
- Nginx は必要に応じて VPS ホスト側に置く。
- 個人利用でスマホから見る場合は、インターネット公開より Tailscale 経由も選択肢。

VPS 更新例:

```bash
cd ~/apps/hamster-manager-browser
git pull
docker compose build
docker compose up -d
docker compose logs -f app
```

Docker Compose v1 の `docker-compose` で `KeyError: 'ContainerConfig'` が出たことがある。可能なら Compose v2 の `docker compose` を使う。作成途中の壊れたコンテナが残っている場合は、該当コンテナを確認して削除してから再実行する。

## 実装済み機能の要約

詳細は `README.md` が最新。

### 認証・共有

- Auth.js / NextAuth + Google OAuth を使用。
- Prisma Adapter で `users`、`accounts`、`sessions`、`verification_tokens` を PostgreSQL に保存。
- `User.accessStatus` は `ACTIVE` / `SUSPENDED`。停止時は全Sessionを同一transactionで削除し、Googleログイン、DB Session取得、共通認証コンテキストで停止を拒否する。ユーザーには内部理由を出さず一般化した案内を表示する。
- `src/proxy.ts` で未ログインユーザーを `/login` へリダイレクト。
- DBアクセス前は `src/lib/auth-context.ts` の `getRequiredHouseholdContext()` でログインユーザーと現在の Household を取得する。
- 初回ログインで Household がなければ個人用 Household を自動作成。同じユーザーの初期作成は PostgreSQL advisory transaction lock で直列化し、並行初期表示による二重作成を防ぐ。
- 現在は cookie `hamster_current_household` があればその Household を使う。cookie がない場合は招待参加した共有中 Household を優先し、なければ最初の membership を操作対象にする。
- 複数の Household に所属している場合は `src/components/household-switcher.tsx` がヘッダーに「操作対象」を出し、`switchCurrentHousehold()` で cookie を更新する。
- `/settings/members` でメンバー一覧、招待リンク作成、メンバー参加解除。
- 招待リンクを作成できるのは Household の `OWNER` / `ADMIN`。
- `OWNER` は `MEMBER` / `ADMIN` の権限切り替えが可能。
- `ADMIN` は招待リンク作成と `MEMBER` の共有参加解除が可能。
- `OWNER` は自分自身と最後の OWNER を除き、共有メンバーの参加解除が可能。
- `/invitations/accept#token=...` でユーザーを Household に MEMBER として追加。受諾画面は公開入口とし、未ログイン時はGoogle OAuthの往復中だけ同じタブの `sessionStorage` にtokenを保持する。平文tokenは管理画面URLへ載せずAction stateで一度だけ返し、フラグメントから読み込んだ直後にアドレスバーから除去し、ログイン後は `sessionStorage` からも削除する。
- 招待トークンは `src/lib/invitations.ts` で生成し、DB には SHA-256 ハッシュのみ保存。

### 共通 UI

- `StatusMessage` は通常メッセージを数秒後にアニメーションで自動非表示にする。
- エラーメッセージは自動で消さず、右端の閉じるボタンで消せる。
- 想定外例外は `src/lib/server-errors.ts` でエラーID付きの構造化ログへ記録し、利用者には内部情報を含まない日本語メッセージを表示する。
- `src/app/error.tsx` / `src/app/global-error.tsx` は再試行、ダッシュボードへの復帰、ログ照合用エラーIDを表示する。
- `unchanged` は「変更はありません。」として表示する。
- `duplicate` は「同じ日付の記録が既に存在します。」として表示する。
- ハムスター一覧、衛生管理、体重履歴の保存ボタンは `DirtySubmitButton` / `MobileDirtySaveArea` で変更検知し、編集が入るまで非活性。
- サーバー側 action でも変更なしの場合は DB 更新せず `unchanged` を返す。
- `src/app/api/realtime/household/route.ts`、`src/app/api/realtime/household/revision/route.ts`、`src/components/realtime-refresh-listener.tsx` で Household 単位の同期を行う。
- DB 更新後の Server Action は `notifyHouseholdChange()` を呼び、Household の `realtimeRevision` をインクリメントして別タブ・別ユーザー画面へ変更を通知する。
- SSE が届かない場合でも、クライアントは 4 秒おきに revision API で DB 上の `realtimeRevision` と最新更新元を確認して追従する。
- フォーム送信時は `realtimeActorId` を hidden input / FormData に差し込み、最新更新元の `realtimeActorClientId` / `realtimeActorUserId` と照合して更新した画面自身の再読み込み・通知を抑止する。
- revision は単調増加するため、同一ミリ秒の連続更新や SSE とポーリングの応答順逆転を古い更新として無視できる。連続する他ユーザー更新は短時間まとめて `router.refresh()` する。
- `form[data-dirty-watch]` に未保存変更がある場合は自動 `router.refresh()` せず、右下通知から手動再読み込みする。
- SSEとrevision確認が連続失敗し、12秒以上同期成功がない場合は同期停止警告を表示する。revision確認は最大30秒までバックオフし、成功時に警告を解除する。
- アプリデータ更新とDB上のrevision更新は同一トランザクションで確定し、コミット後のSSE配信失敗はログへ記録して保存成功を維持する。
- 現状のSSE即時通知バスは app プロセス内メモリ。複数 app インスタンスでも DB 永続化された revision API の追従は効くが、即時性を保つなら PostgreSQL LISTEN/NOTIFY など外部 pub/sub へ差し替える。

### ダッシュボード

- 表示対象ハムスターのカード表示。
- 最新体重。
- トイレ掃除、砂場掃除、床材全交換、ハウス掃除の最新状態。
- 掃除日は経過日数 / 日付をクリックまたはタッチで切り替え。
- 管理中 / 管理外表示。
- 長いメモは省略し、クリックまたはタッチでモーダル表示。
- カード高さがメモや未記録状態で大きく崩れないよう調整済み。
- 認証付きRoute Handlerからプロフィール画像を取得し、名前・メモと最新情報の間へ円形サムネイルを表示。未登録・読込失敗時はプレースホルダー。

### ハムスター管理

- 登録、編集、削除。
- 名前、メモ、誕生日、お迎え日。
- JPEG / PNG / WebP のプロフィール画像登録・差し替え・削除。2MB以内をEXIF補正後512px正方形WebPへ変換し、Household別の永続ディレクトリへ保存。
- 名前 15 文字以内。
- メモ 2000 文字以内。
- 誕生日、お迎え日は未来日不可。
- 管理中 / 管理外切り替え。
- 管理外はプロフィール編集、衛生記録、体重記録をロック。
- 一覧検索、登録順 / 名前、昇順 / 降順、20件ページング。
- 検索は NFKC 正規化、小文字化、カタカナをひらがなへ寄せる。
- 削除チェックボックス常時表示。選択時だけアクションバー表示。
- アクションバーは全選択、全解除、削除。
- 編集保存は変更がある場合のみ実行。
- 未保存変更の移動確認モーダルあり。

### 衛生管理

- ハムスターと年月を選ぶと月別記録を表示。
- PC は表形式、スマホは日別カード形式。
- 掃除項目のチェックボックスとメモは、変更後に保存ボタンを押した時点で月単位にまとめて確定し、Household 同期通知を送る。
- スマホ表示だけ、年月項目の下に日付フィルターを表示し、該当日だけを画面表示できる。
- スマホの日付フィルターは `CleaningMobileDayFilter` / `CleaningMobileForm` で扱う。絞り込みで非表示にした日付もフォーム内には残し、保存時に隠れた日付を削除しない。
- 今日の日付を背景色で強調。
- 表形式では「今日」文言なし、スマホカードでは「今日」バッジあり。
- 未来日は入力不可。
- 管理外は入力不可。
- スマホではチェックボックスまたはメモの変更後に現在スクリーン右下へ固定保存ボタンを表示。
- 固定保存ボタンは `document.body` 直下へ portal して、親要素の transform 影響を避けている。
- 保存は変更がある場合のみ実行。直接 submit されても変更なしなら DB 更新せず `unchanged` を返す。
- 未保存変更の移動確認モーダルあり。

### 体重管理

- 体重登録、編集、削除。
- 未来日不可。
- 体重は 1〜500g、0.1g 単位。
- 同じハムスター・同じ日付の新規登録は、上書きせず重複エラーとして返す。
- 履歴編集は変更がある場合のみ保存。直接 submit されても変更なしなら DB 更新せず `unchanged` を返す。
- 履歴は DB 側でフィルター、ソート、ページング。
- 20件ページング。
- グラフはページング中の一覧だけではなく、現在条件に一致する全体を表示。
- 初期表示は日付 / 降順。
- 登録後は登録順 / 降順へ切り替え。
- 削除チェックボックス常時表示。選択時だけアクションバー表示。
- 未保存変更の移動確認モーダルあり。

### CSV

- `/weights/export`: 体重 CSV エクスポート。
- `/weights/import`: CSV種類の選択画面。
- `/weights/import/app`: アプリ版CSVの新規追加・既存更新。`record_id` で既存記録を特定し、空欄は新規行として扱う。
- `/weights/import/gas`: GAS 版体重 CSV の新規移行。既存記録は更新せずスキップ。
- `/export` は `/weights/export` へリダイレクト。
- アプリ版エクスポートは既定で `app_id`、`record_type`、`schema_version`、`record_id` を出力し、再インポートに使用する。閲覧用では4列をまとめて除外できる。
- CSV インポートは新規登録件数、更新件数、スキップ件数、エラー件数、エラー詳細を表示。
- CSVインポートは2MB・10,000行までで、体重は0より大きく500g以下、未来日は不可。正常行だけを候補にし、登録とrevision更新を同一トランザクションで確定する。
- GAS 側 `id` はアプリ DB ID として使わない。
- アプリ版CSVは全件検証後に一括反映し、1件でもエラーがあれば全件未反映。別Householdの `record_id` は拒否する。

### 設定

- ログイン中ユーザーの表示名変更。自動生成された個人用 Household 名にも反映する。
- 表示名は 50 文字以内。
- ダッシュボード表示ボード数 1〜30 件。
- 表示対象ハムスター選択。
- 表示対象検索。
- ハムスター選択方式の切り替え。
  - コンボボックス式
  - プルダウン式（新規ユーザーの初期値）
- 保存ボタンまでスクロールする固定ボタンあり。

## DB モデル要約

- `hamsters`
  - `householdId`
  - `@@unique([householdId, name])`
  - `memo`
  - `profileImageFileName`
  - `birthDate`
  - `adoptionDate`
  - `isActive`
- `cleaning_records`
  - `hamsterId`
  - `recordDate`
  - `toiletCleaned`
  - `bathCleaned`
  - `flooringPartCleaned`
  - `flooringAllCleaned`
  - `houseCleaned`
  - `memo`
  - `@@unique([hamsterId, recordDate])`
- `weight_records`
  - `hamsterId`
  - `recordDate`
  - `weightG`
  - `@@unique([hamsterId, recordDate])`
- `app_settings`
  - `userId`
  - `householdId`
  - `@@unique([userId, householdId])`
  - `dashboardBoardCount`
  - `hamsterSelectorMode`
- `dashboard_hamsters`
  - ダッシュボード表示対象と `sortOrder`
- `users`
  - `appRole` はアプリ全体権限。`USER` / `ADMIN` / `SUPER_ADMIN`
  - `accessStatus` は利用状態。停止中だけ停止日時・実行者・内部理由を現在情報として持つ
- `user_access_actions`
  - `SUPER_ADMIN` による停止・解除の永続履歴。解除後や関連User削除後も操作時ID・表示名snapshotを保持する
- `households`
  - 共有単位。`realtimeRevision`、`realtimeActorClientId`、`realtimeActorUserId` でリアルタイム更新の順序と最新更新元を保持する。
- `household_members`
  - `OWNER` / `ADMIN` / `MEMBER`
- `household_invitations`
  - 7日有効の招待リンク。`tokenHash` を保存。

## 実装時の注意

- UI 文言は日本語。
- 既存デザインに合わせる。
- ハムスター・衛生記録・体重記録・CSV・設定は必ず現在 Household で絞る。
- Server Action は画面表示に頼らず、DB更新直前に所属 Household を確認する。
- 複数 Household 対応では、cookie の値を信用しすぎず membership を必ず確認する。
- アカウント削除は `/settings/account/delete` と専用Actionに分離する。ユーザーlockの後に全HouseholdをID順でlockし、単独HouseholdだけCascade削除、共有Householdは必要な所有権移譲後に退出、最後にUserを削除する。初期Householdは再作成せず、commit後に単独Household画像・Household Cookie・Auth.js Session Cookieを削除する。
- `AppSetting` は `userId` + `householdId` 単位。招待参加時と共有切り替え時に不足していれば作成する。
- `/admin` はアプリ全体管理者用。`ADMIN` / `SUPER_ADMIN` のみアクセス可能で、ユーザー権限変更と `/admin/users` の利用停止・解除は `SUPER_ADMIN` のみ。停止・解除は既存権限変更と同じ全体advisory lockを使い、自己停止と最後の利用中SUPER_ADMIN停止を防ぐ。アカウント・共有・飼育データは削除しない。
- 初期管理者は Google ログイン後に `npm run admin:grant -- --email ... --role SUPER_ADMIN` で付与する。
- 既存データはリセットせず、必要に応じて `npm run migrate:assign-owner -- --email ...` で未割り当てハムスターを管理者 Household へ移す。
- PC で表、スマホでカードのように、レスポンシブ差分を意識する。
- 画面幅が狭いときの横はみ出し、固定ボタンの被りに注意。
- 未来日制限はフロントだけでなくサーバー側 action でも確認する。
- 管理外ハムスターへの編集・保存・削除制限を忘れない。
- ハムスター候補は原則、管理中のみ表示し、「管理外も含む」で管理外も出す。
- 検索仕様は `src/lib/search.ts` の `normalizeSearchText` に寄せる。
- 未保存変更確認は `UnsavedChangesGuard` を使う。
- 削除 UI は「チェックボックス常時表示、選択時だけアクションバー表示」が現在仕様。
- 変更後は少なくとも `npm.cmd run lint`、`npm.cmd run test`、`npm.cmd run build` を確認する。
- Docker 反映を求められた場合は `docker compose build app`、`docker compose up -d`、`docker compose ps` を確認する。
- ユーザーが「READMEだけ」「コメントだけ」など範囲を限定した場合は、絶対にそれ以外を変更しない。

## 直近の作業傾向

- ユーザーは UI の細かな違和感を見つけて段階的に改善することが多い。
- スマホ実機での見え方を重視する。
- Docker 反映まで求めることが多い。
- ただし、明示されていない場合は勝手に push しない。
- GitHub への push はユーザーが手動で行うことがある。

## 次チャットで最初に確認するとよいもの

```powershell
git status -sb
Get-Content -Encoding utf8 -Path docs\CODEX_HANDOFF.md | Select-Object -First 80
Get-Content -Encoding utf8 -Path README.md | Select-Object -First 120
npm.cmd run lint
```

機能改修時は、対象ページ・対象コンポーネントを読んでから作業する。
