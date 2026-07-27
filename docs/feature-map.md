# 機能マップ

最終確認: 2026-07-20。Next.js App Router / Prisma / PostgreSQL 構成において、画面から Server Action・Route Handler・データアクセスまでを辿るための索引です。原則として、Household に属するデータは `getRequiredHouseholdContext()` で現在の所属を確定し、共有データ更新Actionは `getRequiredHouseholdMutationContext()` でVIEWERをDB処理前に拒否します。Action / API 側でも対象の所属・管理状態を確認します。

## 共通の起点

| 項目 | 主なファイル | 注意点 |
| --- | --- | --- |
| 認証ガード・ログイン遷移 | `src/proxy.ts`, `src/auth.ts`, `src/app/(app)/login/page.tsx`, `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/public-demo.ts` | `/login`、`/api/auth`、`/api/health`と境界一致する`/demo`配下だけが公開。通常画面は認証必須。Auth.js は DB セッションを使用し、認証・認可ポリシーは `tests/authorization.test.ts` と `tests/public-demo.test.tsx` で検証する。 |
| 現在の Household と権限 | `src/lib/authorization.ts`, `src/lib/auth-context.ts`, `src/app/actions/households.ts`, `src/components/household-switcher.tsx` | `OWNER` / `ADMIN` / `MEMBER` / `VIEWER` の閲覧・共有データ編集・招待・解除・権限変更を共通判定する。`hamster_current_household` Cookie は所属確認後にのみ更新する。 |
| レイアウト・ナビゲーション | `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/demo/layout.tsx`, `src/components/app-nav.tsx`, `src/app/globals.css` | 永続するRootLayoutは全経路共通の`html`・`body`・メタデータだけを担当する。通常URLは`(app)` Route Groupに置き、同Groupのlayoutが認証・Household切替・リアルタイム監視・通常ヘッダー・main幅を構成する。デモURLは別のlayout枝で専用ヘッダー・ナビ・main幅を構成するため、クライアント遷移や戻る操作でも両シェルが混在しない。1024px 未満では主要5画面をアイコンなしの均等幅タブで表示し、設定・共有・管理は補助メニューにまとめる。`lg` 以上では従来のボタン型ナビゲーションを1行で表示する。 |
| PWA メタデータ | `src/app/manifest.ts`, `src/app/layout.tsx`, `src/app/favicon.ico`, `src/app/apple-icon.png`, `public/icons/pwa-192.png`, `public/icons/pwa-512.png`, `public/icons/pwa-maskable-512.png` | App Router のファイル規約でブラウザー用faviconとApple用アイコンを、標準 Metadata API でインストール情報、テーマ色、通常・maskableアイコンを配信する。Service Worker、オフライン機能、プッシュ通知は持たない。`tests/manifest.test.ts` でManifestの主要項目を検証する。 |
| 日付・検索・フォーム状態 | `src/lib/date.ts`, `src/lib/search.ts`, `src/components/form-dirty-state.ts`, `src/components/unsaved-changes-guard.tsx`, `src/components/dirty-submit-button.tsx` | 測定日・掃除日などの日付のみの値は暦日を維持し、`createdAt`・`expiresAt`など時刻を持つUTC timestampは画面表示時にJSTへ変換する。形式だけでなく実在する暦日・年月とJST日付境界を `tests/date-validation.test.ts` で検証する。未保存ガードと保存ボタン活性は一覧・掃除・体重で共有する。 |
| エラー・ログ | `src/lib/server-errors.ts`, `src/lib/logger.ts`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/components/status-message.tsx`, `src/components/unexpected-error-panel.tsx` | 利用者には内部例外を出さず errorId を表示する。`tests/error-handling.test.ts`、`tests/logger.test.ts` を併せて更新する。 |
| サポート・お問い合わせ | `src/app/(app)/contact`, `src/app/(app)/admin/inquiries`, `src/app/actions/contact.ts`, `src/lib/contact-inquiry-*.ts`, `src/components/contact-*.tsx` | User単位のチケットとメッセージ履歴をDBへ保存する。利用者は自分の問い合わせだけ、ADMIN / SUPER_ADMINは全件を閲覧・返信・管理できる。 |

## ログイン・認証

- **画面または URL:** `/login`、`/api/auth/[...nextauth]`。
- **主なコンポーネント:** `src/app/(app)/login/page.tsx`（Google ログインフォーム）、`src/app/(app)/layout.tsx`（通常画面シェル・ログアウト）。
- **Server Action または API:** `signIn` / `signOut`（`src/auth.ts`。ログアウト Action は`(app)/layout.tsx`内）。Auth.js Handler は `src/app/api/auth/[...nextauth]/route.ts`。
- **データアクセス・Prismaモデル:** `PrismaAdapter(prisma)` が `User`、`Account`、`Session`、`VerificationToken` を利用。セッション callback が `User.appRole` を拡張セッションへ載せる。
- **バリデーション:** OAuth プロバイダー設定と Auth.js が担当。画面アクセス制御は `src/proxy.ts`。
- **関連テスト:** `tests/authorization.test.ts`（セッションユーザーID必須、アプリロール判定）、`tests/logger.test.ts`（例外処理）。
- **関連設定:** `.env*.example` の `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`AUTH_URL`、`src/types/next-auth.d.ts`。
- **依存関係:** ログイン後の通常データ機能は `auth-context.ts` の初期 Household 作成に依存する。アカウント削除ページ・Actionだけは所属0件で再作成しないよう `getRequiredSessionUser()` を使う。`proxy.ts` の matcher / 公開パス変更は OAuth コールバックを遮断しないよう注意する。

## 匿名・読み取り専用デモ

- **画面または URL:** `/demo`、`/demo/hamsters`、`/demo/records`、`/demo/cleaning`、`/demo/weights`。`/demonstration`などは公開対象外。
- **主なコンポーネント:** `src/app/demo/layout.tsx`、`DemoNav`、`DemoUnavailable`、更新処理を持たない`DemoHamsterCreatePreview`、`DemoRecordCreateFormsPreview`、`DemoWeightCreatePreview`と、通常画面でも使用する`HamsterList`、`HamsterImageField`、`HamsterThumbnail`、`RecordTimeline`、`CleaningMobileForm`、`WeightChart`、`WeightHistoryList`。記録プレビューは体調・通院・思い出のタブだけを操作可能とする。`HamsterImageField`の`preview`モードは各デモハムスターの静的画像、対応形式・容量、無効なファイル選択・画像削除UIを表示し、一覧カードの無効な保存ボタンとともに画像管理機能を紹介する。
- **データアクセス:** `src/lib/public-demo-queries.ts`の`getPublicDemo...`関数だけを使用する。デモHouseholdには固定IDの9体（管理中6体・管理外3体）があり、作成日時順で安定して表示する。個体ごとに異なる体重、掃除、健康・通院・思い出記録を持つ。`Household.isDemo = true`かつ固定`demoSlug = "public-sample"`の両方を満たすHouseholdを最初に取得し、見つからなければ専用準備中表示へ進む。任意Household ID、セッション、選択中Household Cookie、`getRequiredHouseholdContext()`、通常Householdへのフォールバックは使用しない。
- **読み取り専用:** デモpageと登録UIプレビューは更新Actionをimportせず、更新用`form action`、`onSubmit`、更新APIへの`fetch`を持たない。共通一覧カードの`form`はreadOnly時に`action`を設定せず、画像管理プレビューはファイル入力・画像削除にイベントハンドラやフォーム名を付けない。保存ボタンは`type="button"`かつ無効状態とし、入力・ファイル選択・保存はHTML属性でも操作不可にする。CSV・設定・共有・管理導線は描画せず、既存Action/APIの認証・Household更新ガードは変更しない。
- **画像:** `public/demo/hamsters/*.svg`（9体分）と`public/demo/records/*.svg`を固定配信し、ViewModelの`staticImagePath`で通常の認証付き画像APIと切り替える。`profileImageFileName`と`MemoryRecordImage.fileName`には公開パスを保存しない。
- **データ投入:** `prisma/seed-demo.ts` / `npm run seed:demo`。固定slugと`isDemo`をtransaction内で再検証し、ユーザー所属がないデモHouseholdだけを削除・再構築する。固定ID・作成日時を持つ9体と関連記録をJSTの実行日を基準とした相対日付で作成する。静的画像はseed対象外でリポジトリに同梱する。
- **親レイアウト:** 永続する`src/app/layout.tsx`はpathname・認証に依存しない。通常画面は`src/app/(app)/layout.tsx`、デモ画面は`src/app/demo/layout.tsx`という別のlayout枝に属する。デモ枝は`auth()`、Household切替データ、リアルタイム監視、通常ナビをimportしないため、ログイン中でも現在Household情報をデモへ混在させない。通常・デモ間のクライアント遷移と戻る操作ではlayout枝自体が切り替わる。
- **SEO:** `src/app/demo/layout.tsx`で`noindex, nofollow`、`src/app/robots.ts`で`/demo`をDisallowする。アクセス制御は`proxy.ts`と固定デモquery条件が担う。
- **通常データからの分離:** 通常membership取得・Household切替と、管理者向け共有一覧・件数・招待検索用共有候補は`isDemo: false`でデモHouseholdを除外する。
- **関連テスト:** `tests/public-demo.test.tsx`（公開パス境界、通常画面認証、固定query、フォールバック禁止、9体の固定ID・状態・日付・関連記録ID・静的画像、seed再実行・通常Household保護、登録UI・一覧カード画像管理プレビューの項目・無効属性・更新処理非参照、通常登録UI維持、ナビ、noindex、ログイン導線、永続RootLayoutのpathname非依存、Route Group layout境界での通常・デモ分離）と`tests/hamster-image.test.tsx`（静的画像優先、プレビュー分岐のイベント処理非参照、通常モードのファイル選択・Blobプレビュー・削除指定維持）。

## Household 共有・メンバー管理

- **画面または URL:** ヘッダーの操作対象切替、`/settings/members`、自己退出確認 `/settings/members/leave`、唯一OWNER用の完全削除確認 `/settings/members/delete`、`/invitations/accept#token=...`。
- **主なコンポーネント:** `HouseholdSwitcher`、共有グループ名設定フォーム、`HouseholdInvitationForm`、`HouseholdInvitationList`、`InvitationRevokeForm`、`InvitationAcceptForm`（有効な招待先の共有グループ名を強調表示）、`MemberRoleForm`、`MemberRemoveForm`、`HouseholdLeaveForm`、`HouseholdDeleteForm`、`StatusMessage`。
- **Server Action または API:** `switchCurrentHousehold`（`actions/households.ts`）、`getHouseholdInvitationPreview`、`updateCurrentHouseholdName`、`createHouseholdInvitation`、`revokeHouseholdInvitation`、`acceptHouseholdInvitation`、`removeHouseholdMember`、`updateHouseholdMemberRole`、`leaveCurrentHousehold`、`deleteCurrentHousehold`（`actions/members.ts`）。
- **データアクセス・Prismaモデル:** `getRequiredHouseholdContext` / `getCurrentHouseholdSwitcherData`、`Household`、`HouseholdMember`、`HouseholdInvitation`、参加時の `AppSetting`。
- **バリデーション:** `idSchema`、`updateHouseholdNameSchema`（trim後1〜50文字）、招待 token の SHA-256、作成間隔30秒・ユーザー単位で過去1時間5件、Household単位で有効な招待リンク10件（`src/lib/invitations.ts`、`src/lib/invitation-mutations.ts`）。共有グループ名更新は現在選択中のHouseholdだけを対象に、Household単位のadvisory transaction lock内でOWNER所属・画面表示時の旧名称・条件付き更新を再確認する。ユーザー単位レート制限はHousehold横断で、ユーザー単位のPostgreSQL advisory transaction lockにより同時作成を直列化する。有効件数上限はHousehold単位の別のadvisory transaction lockで直列化する。OWNER / ADMIN / MEMBER / VIEWER を `src/lib/authorization.ts` と Action 内トランザクションで再確認する。招待参加時の初期ロールはMEMBERのまま。
- **関連テスト:** `tests/household-name.test.ts`（表示名との分離、初回命名、OWNER限定更新、競合、revision、同名切替表示、UI）、`tests/invitations.test.ts`（tokenをクエリではなくフラグメントへ格納し、不正tokenと無効化済みtokenを拒否する）、`tests/invitation-management.test.ts`（30秒・1時間・別ユーザー・別Household・同時実行・無効化・権限）、`tests/invitation-cleanup.test.ts`（使用済み90日・未使用期限切れ30日の削除条件）、`tests/authorization.test.ts`（招待・削除・権限変更・自己退出ポリシー）、`tests/household-leave.test.ts`（退出・所有権移譲・設定削除・共有データ保持・競合・Cookie切替・UI）、`tests/household-delete.test.ts`（唯一OWNER認可、権限不整合拒否、Cascade範囲、二重実行、画像パス安全性、削除後分岐、招待受諾lock、UI）、`tests/audit-log.test.ts`（成功監査ログ）。
- **関連設定:** `src/lib/auth-context.ts` の Cookie 名・個人用 Household 名、`src/lib/invitations.ts` の有効期限、`src/lib/invitation-cleanup.ts`、`scripts/cleanup-invitations.ts`、`npm run invitations:cleanup`。
- **依存関係:** 招待の平文 token は管理画面URLへ載せず、作成直後のAction stateと受諾画面のメモリ内でのみ扱い、DBにはhashのみ保存する。共有URLはHTTPへ送信されないフラグメントを使い、未ログイン時はOAuth往復中だけ同一タブの `sessionStorage` に保持する。読み込み直後にアドレスバーから、ログイン後にstorageから削除する。共有画面はメンバー一覧の下に有効な招待だけの作成日時・期限・状態・作成者を表示し、有効な招待が0件なら一覧自体を表示しない。未使用かつ期限内だけOWNER / ADMINが無効化できる。受諾は未使用・未無効化・期限内を同一更新条件で確定し、アカウント削除と共通のユーザー単位lockを先に、Household削除と共通のHousehold単位lockを後に取る。使用済みは90日、未使用（無効化済みを含む）の期限切れは元の期限から30日保持してVPS cronから整理し、有効な招待は削除しない。自己退出は `src/lib/household-leave.ts` がHousehold単位のlock内で最新ロール・OWNER数・メンバー数・移譲先所属を再確認し、唯一OWNERなら移譲先を先にOWNERへ更新してから本人の `AppSetting` とmembershipを削除する。共有データは削除しない。唯一のメンバーかつOWNERの完全削除は `src/lib/household-delete.ts` が同じlock内で最新状態と確認名を再検証し、`Household` のCascade削除を起点にする。DB commit後だけ `HAMSTER_IMAGE_DIR/{householdId}` と `RECORD_IMAGE_DIR/{householdId}` を安全検証して削除し、失敗はwarningに留める。削除後は `auth-context.ts` の既存選択順序を再利用し、membershipが残れば切替、0件の場合だけユーザー単位lock付き初期Household作成を行ってCookieを更新する。成功監査イベントは `household_deleted`。メンバーの削除・権限変更は最後の OWNER、自分自身、操作権限の制約と、現在選択 Cookie の整合性に注意する。

## 共有グループの操作履歴

- **画面または URL:** `/settings/members` のメンバー一覧後・危険操作領域前に最新5件、全件は `/settings/members/activity`。カード型タイムラインでJST日時を表示する。全件画面ではServer Componentが自動削除と同じ `getHouseholdActivityRetentionDays` を使って保持日数を表示し、不正・未設定時はフォールバックせず「設定不明」とする。
- **主なコンポーネント:** `HouseholdActivityList`、既存 `PaginationLayout`。一覧フィルターは「すべて」「飼育記録」「メンバー」「グループ設定」で、変更時は1ページ目へ戻る。
- **Server Action または API:** `commitHouseholdMutation` の任意 `activity` を業務更新後・revision更新前に実行する。名称・招待・退出の専用Mutation Repository、招待受諾、CSV import、健康・通院・思い出記録、プロフィール画像、管理状態も各既存Prisma transaction内で `createHouseholdActivity` を実行する。別WebSocketや独自pollは追加せず既存Household revision / SSE / revision pollを利用する。期限切れ履歴は `scripts/cleanup-household-activities.ts` のCLIだけから全Householdを対象に整理し、revision更新・SSE通知・操作履歴追加は行わない。
- **データアクセス・Prismaモデル:** `HouseholdActivity`、`HouseholdActivityEvent`、`HouseholdActivityCategory`。`getCurrentHouseholdActivityPage` は `getRequiredHouseholdContext` で現在所属を確定し、Household IDと任意カテゴリーをDB条件に含め、`createdAt desc, id desc`、20件でページングする。最新表示も同じHousehold条件で5件だけ取得する。全Householdの期限切れ検索用に `createdAt` 単独indexを持つ。
- **対象イベント:** 第一段階はグループ名変更、招待作成・無効化・参加、権限変更・参加解除・退出・所有権移譲退出、ハムスター登録・削除、体重登録・更新・削除・一括削除、アプリ版/GAS版CSV import、掃除月保存。第二段階は健康・通院・思い出の作成・更新・削除、プロフィール画像の登録・差し替え・削除、管理中・管理外切り替え。第二段階も既存 `CARE_RECORD` に分類し、bulk/CSV/掃除、写真を含む思い出操作は1操作1件の要約。
- **認可・プライバシー:** 現在所属する OWNER / ADMIN / MEMBER / VIEWER のみ閲覧可能。アプリ全体 ADMIN / SUPER_ADMIN も未所属なら取得不可。操作者・対象名は操作時snapshotを保存し、未設定名は安全な固定文言を使いメールを代用しない。token/URL、メール、CSV本文・ファイル名、フォーム、掃除メモ、健康・通院・思い出の内容、画像ファイル情報等は保存しない。第二段階は記録日、画像操作種別、管理状態の変更前後だけをdetailsへ保存する。
- **削除・監査:** Household削除はCascade、User削除は参照をSetNullにして名前snapshotを残す。`HOUSEHOLD_ACTIVITY_RETENTION_DAYS`（初期設定90日）より古い履歴は日次cron向け専用CLIで削除し、基準日時と同時刻は残す。既存 `writeHouseholdAuditLog` / サーバーログは障害調査・内部監査用として維持し、利用者向けDB履歴へ置換しない。
- **関連テスト:** `tests/household-activity.test.ts`（formatter、snapshot、transaction rollback、Household分離、安定順、ページング、filter、最新5件、保持日数のServer Component表示、第二段階Mutation、機密情報の非保存、enum migration）、`tests/household-activity-cleanup.test.ts`（自動削除・画面表示で共用する環境変数検証、基準日時、`lt`境界、deleteMany、dry-run）と各既存Mutationテスト。
- **今回対象外:** ハムスタープロフィールのテキスト項目編集、思い出画像専用イベント、保存済みタグ候補、手動削除、CSV出力、通知、過去履歴生成、項目単位差分。

## ダッシュボード

- **画面または URL:** `/`。
- **主なコンポーネント:** `DashboardMemo`、`CleaningDateToggle`、`HamsterThumbnail`、`EmptyState`。画像登録済みの `HamsterThumbnail` はクリック・タップで拡大モーダルを表示し、未登録・読込失敗時は操作不可のプレースホルダーになる。
- **Server Action または API:** 直接の更新 Action はなし。設定更新は `saveSettings`。
- **データアクセス・Prismaモデル:** `getDashboardData`（`src/lib/queries.ts`）が `Hamster`、`AppSetting` / `DashboardHamster`、最新 `WeightRecord`、各種 `CleaningRecord` を Household とユーザー設定で取得。
- **バリデーション:** 表示件数・対象選択は設定の `dashboardSettingsSchema` と `dashboard-settings.ts`。
- **関連テスト:** `tests/settings.test.ts`（表示名・表示件数・選択方式・表示対象順序の差分判定）。
- **関連設定:** `src/lib/dashboard-settings.ts`（1〜30件、選択 UI の既定値）。
- **依存関係:** 表示対象はユーザー・Household ごとの設定。掃除種別を増減する場合は `getDashboardData` とカード表示を同時に変更する。

## ハムスター一覧・登録・編集・削除

- **画面または URL:** `/hamsters`。
- **主なコンポーネント:** `HamsterList`、`HamsterActiveStatusForm`、`HamsterImageField`、`HamsterThumbnail`、`SelectionActionBar`、`DirtySubmitButton`、`UnsavedChangesGuard`、`StatusMessage`。
- **Server Action または API:** `createHamster`、`updateHamster`、`updateHamsterActiveStatus`、`deleteHamster`、`deleteHamsters`（`src/app/actions/hamsters.ts`）、認証付き画像配信 `/api/hamsters/[id]/image`。
- **データアクセス・Prismaモデル:** `getHamsterManagementData`、`Hamster`。削除は関連 `CleaningRecord` / `WeightRecord` / `DashboardHamster` / `HamsterRecord` と種類別詳細が schema の Cascade により連動し、思い出画像ファイルはActionが削除後に整理する。
- **バリデーション:** `createHamsterSchema`、`updateHamsterSchema`、削除・状態変更 schema（`src/lib/schemas.ts`）。日付は未来日不可。DB の `@@unique([householdId, name])` も重複防止となる。
- **関連テスト:** 管理状態変更の非遷移更新・スクロール・両方向・ロック・二重送信・サーバー側保護は `tests/hamster-active-status.test.ts`。画像変換・保存・削除・Household分離・プレースホルダーは `tests/hamster-image.test.tsx`。Household所属判定は `tests/authorization.test.ts`、想定外 / 一意制約エラーの共通処理は `tests/error-handling.test.ts`。
- **関連設定:** `src/lib/search.ts`（名前検索の正規化）、`src/lib/hamster-image.ts`、`HAMSTER_IMAGE_DIR`、`prisma/schema.prisma`、`docker-compose.yml`。
- **依存関係:** 全更新はVIEWER共通拒否後に realtime mutation を通す。VIEWER画面は登録フォーム、削除選択、状態変更、画像変更、保存操作を描画せず、プロフィール入力を読み取り専用にする。`isActive=false` は体重・掃除・プロフィール画像の選択と削除の編集ロック条件だが、登録済み画像の拡大表示は利用できる。プロフィール画像の実変更と管理状態の切り替えは業務更新・操作履歴・revisionを同一transactionで確定し、画像の旧ファイル削除はcommit後の後処理とする。管理状態の切り替えだけはAction結果をクライアントへ返し、URL遷移を行わない`router.refresh()`で一覧データを更新する。操作前のスクロール座標はクライアントメモリへ一時保持してrefresh反映直後に復元し、検索、並び順、現在ページ、削除選択も維持する。成功時は状態・ボタン・ロックの更新だけを表示し、`StatusMessage`は失敗時だけ操作ボタン付近へ表示する。
- **レスポンシブ表示:** 新規登録・編集フォームはスマートフォンで画像選択欄を登録・保存ボタンの直前に置き、送信ボタンをカード幅に広げる。`lg` 以上では既存プロフィール項目と送信ボタンを同じ横列、画像欄を次の行に表示し、管理状態変更ボタンはカード上部の状態バッジ横へ置く。スマートフォンの管理状態変更ボタンはカード下部に維持する。

## 健康・通院・思い出記録

- **画面または URL:** `/records`、認証付き思い出画像 `/api/records/[id]/image`。
- **健康記録の任意時刻:** `RecordTimeInput` が「時間も記録する」選択時だけ `recordTime` を入力・編集し、`src/lib/record-time.ts` が `HH:mm` と0〜1439分を相互変換する。登録・編集Actionは保存時点のサーバー側JST現在時刻と比較し、当日の未来時刻を拒否する。`HamsterRecord.recordTimeMinutes` は健康記録だけが使用する任意の `SmallInt` で、migration `20260717120000_add_health_record_time` が範囲制約と並び順用索引を追加する。カードは日付、任意時刻、登録者の順に表示し、同日内は時刻ありの降順、時刻なし、作成日時、IDの順で取得する。
- **主なコンポーネント:** `RecordCreateForms`、`MemoryTagInput`、`RecordTimeline`、`RecordImageField`、`RecordKeywordInput`、`HamsterSelectorInput`、`AutoSubmitFilterForm`、`FilterClearButton`、`DirtySubmitButton`、`UnsavedChangesGuard`、`StatusMessage`。登録フォームは健康・通院・思い出で分け、閲覧は同じカード型タイムラインへ統合する。表示範囲は「選択中のハムスター」と「グループ全体」を切り替える。URLに `scope` があれば明示値、不正値なら安全側の `hamster`、未指定ならユーザー・Household別の `AppSetting.recordTimelineDefaultScope`（未設定・不正値は `hamster`）を使う。画面内の切替・フィルター・ページング・記録更新削除後は `scope=hamster` / `scope=household` を明示して現在の範囲を維持し、他画面から単純に `/records` を開く場合だけ保存済み初期値を適用する。グループ表示でもハムスター選択は新規登録先・個別表示へ戻る対象として維持する。`HamsterSelectorInput` はプルダウン・検索可能コンボボックスの両方式で外部 `selectedId` の変更を表示値と送信用IDへ同期し、props同期だけでは自動送信しない。`RecordTimeline` はカード本体を白に統一して本文・写真・編集フォームの可読性を保ち、健康・体調をグリーン、通院をブルー、思い出をローズ系の左アクセント・丸アイコン・淡い種類バッジで区別する。グループ表示では各カードに `scope=hamster` を明示したハムスター名の個別タイムラインリンクを表示する。文字ラベルとアイコンも併用し、色だけには依存しない。作成フォームはServer Actionをクライアントイベントから呼び、エラーをフォーム内へ表示して画面位置・文字・選択・チェック・画像選択を保持する。`RecordImageField` は元画像10MB上限とMIME形式を送信前に検証し、保存時に2MB以下へ自動圧縮することを案内する。`MemoryTagInput` は「、」またはカンマ区切りのタグ入力、Householdの保存済みタグと初期候補のボタン入力、思い出保存時のタグ同時保存チェックに対応する。保存済みタグは1件以上ある場合だけ件数付きの折りたたみを表示し、展開後の削除ボタンからモーダルを開いて複数候補を一括削除できる。初期候補も1件以上ある場合だけ見出しと候補一覧を表示する。削除後は入力内容とスクロール位置を保ったまま候補を更新する。対象ハムスターは常に選択済みとして空選択を表示しない。フィルターは選択・日付・チェックを即時、文字入力を短いデバウンス後に自動適用し、クリア時は入力値を初期化して再取得する。キーワードは平仮名・カタカナ等の正規化、`#` 入力時の現在の表示範囲にある使用済みタグ候補に対応する。カンマ区切りではキーワード同士・タグ同士をOR、キーワード群とタグ群をANDで検索する。いずれもスクロール位置と表示範囲を維持する。
- **Server Action または API:** `createHealthRecord`、`updateHealthRecord`、`createMedicalRecord`、`updateMedicalRecord`、`createMemoryRecord`、`updateMemoryRecord`、`deleteHamsterRecord`、`deleteSavedMemoryTags`（`src/app/actions/records.ts`）。作成Actionは期待される入力・画像エラーと安全なエラーIDを返し、画面遷移せず結果をフォームへ返す。`createMemoryRecord` はチェック時だけ入力タグを個別行へ変換し、思い出記録・Household revisionと同一トランザクションで重複を無視して保存する。`deleteSavedMemoryTags` は更新権限とHousehold所属をサーバー側で確認し、選択された保存候補だけを一括削除する。画像Routeは認証後、記録に紐づくハムスターの現在のHousehold所属を確認してWebPだけを配信する。
- **データアクセス・Prismaモデル:** `getRecordsPageData`（`src/lib/record-queries.ts`）が現在のユーザー・Householdの `AppSetting` と `Hamster` を取得し、URL指定の有無を区別して表示scopeを確定する。`Hamster.householdId` を必須条件にし、個別表示では選択中 `hamsterId` も追加、グループ表示では現在のHousehold内全ハムスターを対象にする。同じscope条件を記録件数・一覧・使用済みタグ候補へ適用し、種類、暦日期間、検索用テキスト、お気に入りをDB側で絞り込み、記録日、任意時刻（時刻なしは後）、作成日時、IDの降順で20件ページングする。各行は所属ハムスターの `id`、`name`、`isActive` を取得し、カード表示・編集削除対象・管理外判定に使用する。通常キーワードはタグを含まない `HamsterRecord.searchText` のかな表記候補、`#タグ` は小文字・NFKC正規化した `MemoryRecordDetail.searchTags` を検索し、大文字小文字・全角半角・かな表記差を吸収する。表示用の `MemoryRecordDetail.tags` は大文字小文字を保持する。複数キーワード内・複数タグ内はOR、キーワード群とタグ群はANDで結合する。思い出の `searchText` はタイトルと内容だけで生成する。検索用タグ候補は現在の表示範囲にある既存記録から、入力再利用用タグはHousehold所属の `SavedMemoryTag` から取得する。保存候補の一括削除はServer Actionで現在のHouseholdへ絞った `deleteMany` とrevision更新を同一トランザクションにし、既存の `MemoryRecordDetail.tags` は変更しない。`HamsterRecord` を親に、`HealthRecordDetail`、`MedicalVisitDetail`、`MemoryRecordDetail` を1対1、`MemoryRecordImage` を画像用の子として持つ。`SavedMemoryTag` はHouseholdと全角英数字等を半角化した名前の複合一意制約を持ち、大文字小文字は区別する。症状はenum配列、タグは自由文字列配列、検索専用タグはGIN索引、横断キーワードは親の `searchText` と `pg_trgm` GIN索引を利用する。
- **バリデーション:** `src/lib/record-schemas.ts`。健康の各enum・複数症状、通院理由、0円以上の整数診察費、思い出のタイトル・内容・最大20タグ・タグ保存チェック、保存候補削除の1件以上選択とタグ文字数、全項目の文字数上限を検証する。タグは `src/lib/tags.ts` でNFKC正規化し、全角英数字・記号等を半角へ揃えながら英字の大文字小文字を保持する。記録日は `src/lib/date.ts` の暦日変換を再利用して未来日を拒否し、次回通院予定日だけ未来日を許可する。画像は共有の `src/lib/image-constraints.ts` と `src/lib/image-processing.ts` をクライアント事前検証とサーバー検証で再利用する。元画像は10MB以内に制限し、サーバーでMIME/実体・4,000万画素上限を検証する。プロフィール画像は512px正方形、思い出画像は縦横比を維持して長辺1920px以内・拡大なしとし、WebP品質と解像度を段階調整して必ず2MB以下にしてからUUID名で原子的に保存する。
- **関連テスト:** `tests/records.test.ts`（種類別入力、診察費、enum、タグ、検索対象、表示範囲の正規化とURL/保存設定の優先順位、個別・Household全体の境界、`scope`明示URL、フィルター、カードごとのハムスター情報、編集削除後のscope維持、ページング、データモデル、画像変換/分離/後片付け、realtime構造）、`tests/settings.test.ts`（初期表示設定の差分・フォーム・保存・migration）、`tests/authorization.test.ts`（全記録ActionのVIEWER共通拒否）。
- **関連設定:** `AppSetting.recordTimelineDefaultScope`、migration `20260724090000_add_record_timeline_default_scope`、`src/lib/records.ts` の許可値・正規化・URL生成、`RECORD_IMAGE_DIR`（Dockerは `/app/uploads/records`）、`docker-compose.yml` の `./uploads:/app/uploads`、migration `20260715120000_add_hamster_records` / `20260716130000_separate_record_keyword_and_tag_search` / `20260716160000_add_saved_memory_tags` / `20260716190000_normalize_memory_tag_width_preserve_case` / `20260716210000_add_memory_record_search_tags`、`package.json` のテスト列挙。
- **依存関係:** OWNER / ADMIN / MEMBERは更新可能、VIEWERは閲覧・検索・絞り込み・ページ移動だけでActionも拒否する。全取得・更新は対象ハムスターが現在のHousehold所属であることをDB条件に含める。編集・削除フォームの `hamsterId` は各記録自身の所属を使い、`returnHamsterId` と正規化済み `viewScope` で処理後の表示範囲を維持する。管理外ハムスターの健康・通院は閲覧のみ、思い出は登録・編集・削除可能。全更新は `source: "record"` の realtime mutation を通し、業務データ・`CARE_RECORD` 操作履歴・revisionを同一トランザクションで確定する。履歴detailsは記録日だけとし、健康・通院・思い出の入力内容や画像情報は保存しない。画像差し替え・記録削除・ハムスター削除後は旧ファイルを削除し、失敗は警告ログへ残す。初回は1記録1枚だが画像別テーブルと表示順で複数枚へ拡張できる。

## 体重履歴

- **画面または URL:** `/weights`。
- **主なコンポーネント:** `WeightHistoryList`、`WeightChart`、`HamsterSelectorInput`、`AutoSubmitInput` / `AutoSubmitSelect`、`SelectionActionBar`。
- **Server Action または API:** `createWeightRecord`、`updateWeightRecord`、`deleteWeightRecord`、`deleteWeightRecords`（`src/app/actions/weights.ts`）。
- **データアクセス・Prismaモデル:** `getWeightPageData`（DB 側の履歴フィルター・ソート・ページングとグラフ専用期間フィルター）、`Hamster`、`WeightRecord`、`AppSetting`。
- **バリデーション:** `createWeightRecordSchema`、`updateWeightRecordSchema`、削除 schema、`MAX_WEIGHT_G`（1〜500g、0.1g、未来日不可）。`@@unique([hamsterId, recordDate])` が日次重複を保証する。
- **関連テスト:** `tests/weight-validation.test.ts`（通常登録・編集・CSVの0.1g単位検証）、`tests/csv-and-realtime.test.ts`（CSVの体重上限・未来日検証）、`tests/authorization.test.ts`（Household所属判定）。
- **関連設定:** `src/lib/weight-rules.ts`、`src/lib/date.ts`、`src/lib/dashboard-settings.ts`（選択 UI）。
- **依存関係:** 管理外ハムスターとVIEWERは作成・編集・削除不可。VIEWERは検索・フィルター・並び替え・ページ移動・グラフ・CSVエクスポートを利用できる。履歴一覧は 20 件ページング。「全件」表示では開始日と終了日が揃うとグラフだけを自動で絞り込み、クリア操作で全期間へ戻す。「月ごと」表示では従来どおり履歴の対象月とグラフを連動させる。

## 体重 CSV エクスポート

- **画面または URL:** `/weights/export`、ダウンロード API `/export/weights`、旧 `/export` はリダイレクト。
- **主なコンポーネント:** `WeightCsvExportForm`、`HamsterSelectorInput`、`StatusMessage`。画面全体は Server Component のまま、列選択とダウンロード可否だけを小さな Client Component で管理する。
- **Server Action または API:** `src/app/(app)/export/weights/route.ts` の GET（CSV Response）。
- **データアクセス・Prismaモデル:** `getHamsterOptions`、`getHamsterSelectorMode`、Route 内の `WeightRecord.findMany` と `Hamster` 所属条件。
- **バリデーション:** URL の `hamsterId` / `month` を Route 内で解析し、`src/lib/weight-csv-export.ts` で選択列の許可・1列以上・重複なし、UTC / JST、連携用必須列の出力有無を検証する。対象 Household の所属を `getRequiredHouseholdContext` で確定し、既定では `app_id` / `record_type` / `schema_version` / `record_id` を出力するが、閲覧用では4列をまとめて除外できる。
- **関連テスト:** `tests/weight-csv-export.test.ts`（連携用必須列の一括切り替え、列選択・順序、UTC / JST、測定日維持、CSVエスケープ、不正指定）。
- **関連設定:** `src/lib/weight-csv-export.ts`（固定識別値、列定義、日時変換、行生成）、`src/lib/csv.ts`（CSVエスケープ）、`src/lib/date.ts`（測定日の整形）。
- **依存関係:** エクスポート API だけを公開 URL にしない。画面と Route Handler の双方で Household スコープを維持する。

## 体重 CSV インポート

- **画面または URL:** `/weights/import`（種類選択）、`/weights/import/app`（アプリ版一括編集）、`/weights/import/gas`（旧版移行）。
- **主なコンポーネント:** `WeightCsvImportForm`。
- **Server Action または API:** `importAppWeightRecordsCsv`、`importGasWeightRecordsCsv`（`actions/weights.ts`、`useActionState` で実行）。
- **データアクセス・Prismaモデル:** アプリ版は `record_id` のHousehold所属と変更先重複を検証して `WeightRecord.update` / `createMany`。GAS版は名前照合と既存重複確認後に `createMany`。いずれもデータ変更と Household revision 更新は同一トランザクション。
- **バリデーション:** `parseAppWeightCsvImport`（`src/lib/weight-csv-app-import.ts`）、`parseWeightCsvImport`（`src/lib/weight-csv-import.ts`）、`weight-rules.ts`（2MB・10,000行・500g上限・0.1g単位）。アプリ版は出力元識別・スキーマバージョン・ID所属・CSV内/変更先重複を検証し、エラー時は全件未反映。両方とも管理外・未登録の名前を拒否。
- **関連テスト:** `tests/csv-and-realtime.test.ts`。
- **関連設定:** `next.config.mjs` の Server Action body size（3MB）はファイル上限以上を受け取れる必要がある。
- **依存関係:** 通常の体重登録と同じ制約を保ち、両インポートActionはVIEWERをファイル読込前に拒否する。VIEWER画面にはインポートフォームを描画しない。GAS `id` は DB ID に流用せず、アプリ版 `record_id` と区別する。

## 掃除記録

- **画面または URL:** `/cleaning`。
- **主なコンポーネント:** `CleaningMobileForm`、`CleaningMobileDayFilter`、`HamsterSelectorInput`、`DirtySubmitButton`、`MobileDirtySaveArea`、`UnsavedChangesGuard`。スマホ用日付プルダウンと入力カードは、サーバーで確定した同じ初期選択値を受け取り、その後は既存の変更イベントで選択状態を同期する。
- **Server Action または API:** `saveCleaningMonth`（`src/app/actions/cleaning.ts`）。
- **データアクセス・Prismaモデル:** `getCleaningPageData`、`Hamster`、`CleaningRecord`、`AppSetting`。月内の既存行との差分から create / update / delete を行う。`AppSetting.cleaningMobileDefaultDateFilter` はユーザー・Householdの組み合わせ単位で保存する。
- **バリデーション:** `cleaningMonthSchema`、`yearMonthSchema`、日付・未来日チェック（`src/lib/date.ts`）。スマホ初期表示設定は `today` / `all` だけを保存し、未設定・不正なDB値は `today` に正規化する。
- **関連テスト:** `tests/authorization.test.ts`（Household所属判定）、`tests/cleaning-mobile-settings.test.tsx`（設定値の正規化、今月の今日選択、過去月・日付不在時の全日付フォールバック、プルダウンとカードの初期同期、PC表の維持）。
- **関連設定:** `src/lib/dashboard-settings.ts`（Hamster 選択形式）、`src/lib/cleaning-settings.ts`（スマホ日付初期値）、`src/app/globals.css`（PC表 / モバイルカードの表示）。
- **依存関係:** `today` 設定はスマホ表示かつ対象が今月で日付一覧にJSTの今日が存在するときだけ今日のカードを初期表示し、それ以外は存在しない日付を選ばず全日付へフォールバックする。`all` は常に全日付を初期表示する。画面内の手動選択は初期値で上書きせず、PC用の `lg` 月間テーブルには適用しない。記録が全て空なら行を削除する。VIEWERは表・モバイルカードとも入力と保存を無効化し、ActionでもDB処理前に拒否する。掃除種別・メモのフィールドを変える場合、schema、Action 差分判定、`getCleaningPageData`、ダッシュボード最新掃除表示、Prisma migration をまとめて変更する。

## 設定（プロフィール・ダッシュボード・記録画面）

- **画面または URL:** `/settings`。最下部の「アカウントの削除」から、赤枠の「削除内容を確認する」でアカウント削除確認 `/settings/account/delete` へ移動する。
- **主なコンポーネント:** `ProfileSettingsFields`、`DashboardSettingsForm`、`DisplaySettingsSection`、`DirtySubmitButton`、`UnsavedChangesGuard`、`HamsterCombobox`、`MobileDirtySaveArea`、`AccountDeleteEntryForm`、`AccountDeleteForm`。プロフィール、ダッシュボード設定、記録画面の初期表示範囲、衛生管理画面のスマホ日付初期表示を1フォーム・1保存ボタンで扱い、アカウント削除の入口は別フォームに分離する。スマホでは3つの画面表示設定を現在値の日本語要約付きディスクロージャーへまとめ、展開時は同じラジオ入力を2列セグメントとして表示して選択中の説明だけを示す。`md`以上ではディスクロージャー見出しを隠し、従来の説明付きカード表示を常時表示する。
- **Server Action または API:** `saveSettings`（`src/app/actions/settings.ts`）。表示名、ダッシュボード設定、記録画面の初期表示範囲、衛生管理画面のスマホ日付初期表示をまとめて差分比較し、変更がなければ `unchanged` を返す。各初期表示だけの変更も現在のユーザー・Householdの `AppSetting` へupsertし、関連画面と `/settings` を再検証する。
- **データアクセス・Prismaモデル:** `getDashboardSettingsPageData`、`User`、`Household`、`HouseholdMember`、`AppSetting`、`DashboardHamster`、`Hamster`。
- **バリデーション:** `updateUserProfileSchema`（表示名）、`dashboardSettingsSchema`、`normalizeDashboardBoardCount` / `normalizeHamsterSelectorMode` / `normalizeRecordScope` / `normalizeCleaningMobileDefaultDateFilter`。記録画面の初期表示は `hamster` / `household`、衛生管理画面のスマホ日付初期表示は `today` / `all` だけを保存し、DBの未設定・不正値はそれぞれ `hamster` / `today` として扱う。
- **関連テスト:** `tests/settings.test.ts`（表示名・表示件数・選択方式・表示対象順序・各初期表示の差分判定、フォーム、保存、migration）、`tests/display-settings-section.test.tsx`（スマホ用ディスクロージャー、現在値要約、入力DOM保持、説明切替、`md`以上の常時表示、dirty監視フォーム接続）、`tests/cleaning-mobile-settings.test.tsx`（衛生管理スマホ初期表示）、`tests/account-delete.test.ts`（アカウント削除の確認導線と確認UI）。
- **関連設定:** `src/lib/dashboard-settings.ts`、`src/lib/records.ts`、`src/lib/cleaning-settings.ts`、`src/lib/search.ts`、`AppSetting.recordTimelineDefaultScope`、`AppSetting.cleaningMobileDefaultDateFilter`。
- **依存関係:** 表示名とユーザー・Household別のダッシュボード設定・各画面の初期表示は個人設定のためVIEWERにも更新を許可し、共有グループの操作履歴には記録しない。スマホ用ディスクロージャーは閉じてもラジオ入力をアンマウント・無効化せずCSS表示だけを切り替えるため、フォーム送信値と未保存変更検知を維持する。表示名変更は `User.name` だけを更新し、初回作成後の共有グループ名や所有権移譲後の名前とは連動させない。初回Household名だけは `defaultHouseholdName()` で生成する。ダッシュボード対象に変更がある場合だけ全 `DashboardHamster` を削除して作り直すため、初期表示だけの変更では対象を作り直さない。順序と上限を Action と UI で一致させ、未保存変更がある間は他画面への移動確認を表示する。

## アカウント削除

- **画面または URL:** `/settings/account/delete`。削除されるグループ数、退出するグループ数、オーナー移譲が必要なグループ数を先に要約し、各グループは状態バッジ・説明・権限・メンバー数を表示する。対応必要（`transferOwnership`、`blocked`）と対応不要のグループが混在する場合は、ローカルstateのチェックボックスで対応必要なカードだけに絞り込める。唯一OWNERの共有グループだけ移譲先を選び、確認文字列 `アカウントを削除` の完全一致を必須にする。
- **主なコンポーネント:** `AccountDeleteEntryForm`、`AccountDeleteForm`、`StatusMessage`。通常設定フォームとは分離し、確認ページには `/settings` へ戻る「削除をやめる」導線を置く。送信中、確認未完了、最後の`SUPER_ADMIN`、処理不能グループがある場合は削除ボタンを無効化する。最後の`SUPER_ADMIN`の理由はページ内の案内だけに表示する。
- **Server Action または API:** `deleteCurrentUserAccount`（`src/app/actions/account.ts`）。フォームのUser IDは受け取らず `getRequiredSessionUser()` から現在ユーザーを確定し、初期Householdを作成しない。
- **データアクセス・Prismaモデル:** `src/lib/account-delete.ts` がユーザー単位lock、`SUPER_ADMIN`全体lock、ID昇順の全Household lockを同一Prisma transactionで取得し、最新状態と画面state tokenを再確認する。単独OWNERグループは `deleteSoleOwnerHousehold`、共有グループは `leaveHouseholdMembership` を同一transactionのRepositoryで再利用し、全処理成功後に `User` を削除する。`Account`、`Session`、`HouseholdMember`、`AppSetting` はUser Cascade、`DashboardHamster` はAppSetting Cascade。共有記録・招待・保存タグの作成者は既存の `SetNull` を維持する。
- **バリデーション:** 単独削除はメンバー1・対象OWNER・OWNER1の完全一致だけ。共有で別OWNERがいれば退出し、唯一OWNERなら同じグループの自分以外を明示選択してOWNER昇格後に退出する。画面後の状態変更、移譲先退出、二重削除、最後の`SUPER_ADMIN`を拒否してtransaction全体をロールバックする。招待受諾もユーザーlock→Household lock順に統一する。
- **ファイル・ログアウト・監査:** DB commit後に、削除結果へ含まれる単独Household IDだけ `deleteHouseholdImageDirectoriesSafely` へ渡す。パス安全性は既存画像処理を再利用し、失敗はwarning。`hamster_current_household` とAuth.js Session cookieを消し、DB SessionのCascade削除後に `/login?status=accountDeleted` へ遷移する。成功監査イベントは `account_deleted` で、削除User IDとグループ件数だけをファイルログへ残す。
- **関連テスト:** `tests/account-delete.test.ts`（単独Cascade、共有保持、所有権移譲、複数グループ、確認文字列、状態変更、移譲先消失、SUPER_ADMIN、二重送信、画像、SetNull、排他順序、UI）、`tests/audit-log.test.ts`（`account_deleted`）。

## サポート・お問い合わせ

- **画面または URL:** 利用者の作成・履歴 `/contact`、利用者詳細 `/contact/[publicId]`、管理一覧 `/admin/inquiries`、管理詳細 `/admin/inquiries/[publicId]`。`/settings` は危険操作領域の前に導線を置き、予期しないエラーパネルは検証可能なerrorIdを `/contact?errorId=...` へ引き継ぐ。管理トップ `/admin` は未対応・確認中・回答待ち件数だけを表示し、問い合わせ内容の一覧・詳細は `/admin/inquiries` で確認する。
- **主なコンポーネント:** `ContactInquiryForm`、`ContactInquiryList` / `AdminContactInquiryList`、`ContactStatusBadge` / `ContactCategoryBadge`、`ContactMessageThread`、`UserContactReplyForm` / `AdminContactReplyForm`、`ContactRealtimeRefreshListener`、`ContactSupportEntry`、既存 `PaginationLayout`、`AutoSubmitFilterForm`、`StatusMessage`。一覧は`lg`以上でテーブル、未満でカードへ切り替え、長い番号・件名・メール・errorIdは折り返す。
- **Server Action:** `submitContactInquiry`、`replyToContactInquiry`、`updateContactInquiryAdmin`（`src/app/actions/contact.ts`）。フォームのUser IDは受け取らず、セッションから操作者を確定する。バリデーション結果はフォーム付近へ返し、想定外例外だけ既存errorId方式へ変換する。利用者向け新規問い合わせフォームは5項目をReact stateで一貫して管理し、Server Actionのバリデーション・送信制限・権限拒否では入力を保持し、作成成功時だけ件名・本文・種類を初期化してerrorId・発生画面をURL由来の初期値へ戻す。
- **データアクセス・Prismaモデル:** `ContactInquiry` と `ContactInquiryMessage`、`ContactInquiryCategory` / `ContactInquiryStatus` / `ContactSenderType`。`src/lib/contact-inquiry-queries.ts` が利用者のUser条件、管理者の状態・種類・正規化済み検索条件をDBへ含め、`updatedAt desc, id desc`、20件でページングする。公開番号はJST日付と暗号学的ランダム値の `HMB-YYYYMMDD-XXXXXXXXXX` で、内部IDを公開しない。
- **認可・状態遷移:** 利用者詳細・返信は `publicId + session userId` で所有者を再確認し、他人の番号はnot found相当とする。管理画面・Actionは `getRequiredAppAdminUser` を使い、transaction内でも最新の `ADMIN` / `SUPER_ADMIN` と利用状態を再確認する。状態遷移は `contact-inquiry-core.ts` に集約し、`CLOSED`への返信、`RESOLVED`から`WAITING_FOR_USER`などの不正遷移を拒否する。利用者が`WAITING_FOR_USER` / `RESOLVED`へ返信すると`IN_PROGRESS`へ戻す。
- **バリデーション・レート制限:** 件名trim後1〜100文字、初回本文10〜2,000文字、返信1〜2,000文字、errorId最大128文字、発生画面最大300文字。発生画面は単一`/`で始まり外部origin・`//`・バックスラッシュ・制御文字を含まないアプリ内パスだけを許可する。作成は同一Userで30秒間隔、1時間5件、未終了10件、利用者返信は同一問い合わせで10秒間隔とし、PostgreSQL advisory transaction lockで同時送信を直列化する。
- **transaction:** 作成は最新User確認・レート再確認・問い合わせ・初回メッセージ・snapshotを同一transactionで保存する。利用者返信と管理者更新は問い合わせ単位lock内で所有者または管理者権限、最新状態、担当者権限を再確認し、条件付き状態更新・メッセージ作成・問い合わせ単位realtime revision増加を同一transactionで確定する。管理者返信時に担当者未設定なら返信者を自動設定する。commit後にだけ問い合わせ専用SSEイベントを安全にpublishし、通知失敗は保存結果へ影響させない。
- **リアルタイム同期:** 問い合わせ詳細はSSE `/api/realtime/contact?publicId=...` とDB revision `/api/realtime/contact/revision?publicId=...` を併用する。一般利用者は所有する問い合わせだけ、`ADMIN` / `SUPER_ADMIN` は管理画面で閲覧可能な問い合わせだけを購読できる。タブ単位の`realtimeActorId`で自己更新だけを抑止し、別タブは同じUserでも更新する。返信成功時は入力欄をクリアして`router.refresh()`し、リモート更新時に`data-dirty-watch`対象フォームが入力中なら既存dirty判定で自動更新を保留する。
- **アカウント削除:** 問い合わせ作成者・担当管理者・メッセージ送信者のUser参照は`SetNull`、利用者ID・名前・メールと送信者ID・名前のsnapshotは保持する。User削除で問い合わせ・本文・返信は削除せず、問い合わせを削除した場合だけメッセージをCascadeする。担当者が後から降格・削除されてもsnapshotで表示を維持する。
- **機密情報・ログ:** 本文はReactの通常エスケープと`whitespace-pre-wrap`で表示し、`dangerouslySetInnerHTML`を使わない。問い合わせ本文とメールを通常ログまたは想定外例外のcontextへ渡さない。利用者画面には管理者向け利用者ID・担当者操作を返さない。
- **関連テスト:** `tests/contact-inquiries.test.ts`（入力、内部パス、公開番号、snapshot、作成制限と同時送信、所有者分離、返信、状態遷移、担当者権限、transaction境界、revision増加とrollback、SSE通知失敗、問い合わせ購読認可、クライアントID判定、DBページング・検索・安定順、SetNull / Cascade migration、認可・レスポンシブUI・二重送信・ログ非出力）。
- **今回対象外:** 添付、メール・プッシュ通知、FAQ、AI回答、評価、SLA、匿名・ログイン前受付、優先度、CSV、一括・物理削除、Household共有、メッセージ単位既読。未読バッジは初回の認可・transaction実装を小さく保つため対象外とし、将来は問い合わせ単位の最終閲覧日時で追加する。

## アプリ全体管理

- **画面または URL:** 管理トップ `/admin`、ユーザー管理 `/admin/users`、共有管理 `/admin/households`。管理トップは新しいユーザー・共有を最大5件ずつプレビューし、招待一覧は引き続き `/admin` に置く。
- **主なコンポーネント:** `AdminUserList`、`AdminUserAccessControls`、`AdminHouseholdList`、`AdminPagination`、`AdminInvitationPagination`、`AutoSubmitFilterForm`、`AdminInvitationHouseholdCombobox`、`InvitationStatusBadge`、`StatusMessage`。ユーザー一覧は `lg` 以上でユーザー・アプリ権限・利用状態・利用状況・登録日・操作の6列テーブル、`lg` 未満で全項目名を明示したカードとして表示する。PCでは停止日時を状態セルへまとめ、内部理由・実行者は縦三点メニューの詳細ダイアログで確認する。`SUPER_ADMIN` の停止・解除も同じメニューから既存の確認ダイアログを開き、停止確認では対象名・メール、データ非削除、全Session無効化、必須理由を明示する。共有一覧は共通カードを使う。招待フィルターは選択を即時、共有名入力を短いデバウンス後に自動適用し、スクロール位置を維持する。招待ページングは件数サマリー直下と一覧末尾に表示する。
- **Server Action または API:** `updateUserAppRole`、`suspendUserAccess`、`restoreUserAccess`（`src/app/actions/admin.ts`）。停止・解除の業務処理は `src/lib/user-access.ts` に集約する。
- **データアクセス・Prismaモデル:** 全画面で `getRequiredAppAdminUser` を通す。利用状態は `User.accessStatus` と現在の停止情報、永続履歴は `UserAccessAction` に保存する。解除時は現在の停止情報をクリアするが、停止・解除履歴と操作時snapshotは残す。`src/lib/admin-users.ts` と `src/lib/admin-households.ts` が `count` 後に補正したページへ `skip` / `take: 20` を適用し、作成日時・IDの降順で1ページ分だけ取得する。共有件数・5件プレビュー・一覧・招待検索用の共有候補は`isDemo: false`で公開デモHouseholdを除外する。管理トップの各全件数、5件プレビュー、招待検索用の全共有ID・名前、招待有無を別クエリに分離する。`src/lib/admin-invitations.ts` は `HouseholdInvitation.findMany` / `count` により従来どおり20件ずつDB側ページングする。
- **バリデーション:** `src/lib/admin-pagination.ts` が不正・0以下・範囲外の `page` を安全に補正する。Action 内で `AppRole` を許可値として確認し、戻り先も `/admin` と `/admin/users` のホワイトリストに限定する。利用停止理由はtrim後3〜500文字、解除備考は任意で最大500文字とし、定数を `src/lib/user-access-constants.ts` に集約する。停止・解除は画面とActionの両方を `SUPER_ADMIN` に限定し、同じ全体advisory transaction lock内で操作者権限・対象状態・最後の利用中SUPER_ADMINを再確認して条件付き更新する。自己停止、最後の利用中SUPER_ADMIN停止、重複停止・解除を拒否し、停止時は全Session削除と履歴作成まで同一transactionに含める。`SUPER_ADMIN` の自己降格と最後の利用中 `SUPER_ADMIN` 降格も禁止する。招待一覧の状態・共有名・並び順・ページは `admin-invitations.ts` でホワイトリスト検証・正規化し、共有名は `normalizeSearchText` により平仮名・カタカナ・大文字小文字・全角半角の差を吸収する。
- **関連テスト:** `tests/user-access.test.ts`（停止・解除、Session削除、共有・飼育データ保持、永続履歴、認可、入力、重複、Googleログイン、セッション検証、同時停止・解除、最後の利用中SUPER_ADMIN）、`tests/admin-overview.test.ts`（5件プレビュー、独立count、招待検索用共有一覧）、`tests/admin-users.test.ts` / `tests/admin-households.test.ts`（DB側20件ページング、ページ補正、認可、レスポンシブ・表示項目）、`tests/authorization.test.ts`（SUPER_ADMINのみ許可、自己降格・最後のSUPER_ADMIN降格禁止）、`tests/admin-invitations.test.ts`（招待のDBフィルター・ソート・ページング・URL・作成者表示・独立した有効件数、レスポンシブ切り替えと全項目維持）。
- **関連設定:** `prisma/schema.prisma` の `AppRole`、`UserAccessStatus`、`UserAccessActionType`。初期付与は `prisma/admin-role.ts`。ページング目視確認用の追加専用・再実行可能なサンプル投入は `prisma/seed-admin-pagination.ts` と `npm run seed:admin-pagination` を使う。
- **依存関係:** `User.appRole` は Household 内ロールとは別物で、利用停止は `AppRole` ではなく `User.accessStatus` で表す。Auth.jsのGoogleログインcallbackはGoogleアカウントIDとメールで停止ユーザーを照合し、Prisma AdapterのDB Session取得と `getRequiredSessionUser` でも停止状態を拒否する。停止ユーザー向け画面には一般化した案内だけを表示し、内部理由は渡さない。ナビ表示だけでなく各 page / Action の両方でアプリ管理者を確認する。権限変更と利用停止・解除は `/admin/users` に集約する。ユーザー・共有の作成日はJST日付、停止・招待の各timestampはJST日時で表示する。招待状態の判定とバッジは共有・メンバー管理画面と共通化し、管理トップの共有プレビュー件数から独立させる。

## リアルタイム同期

- **画面または URL:** ログイン後の全画面（`src/app/(app)/layout.tsx`の通常画面シェル）、家庭SSE `/api/realtime/household`、家庭revision API `/api/realtime/household/revision`、問い合わせSSE `/api/realtime/contact`、問い合わせrevision API `/api/realtime/contact/revision`。
- **主なコンポーネント:** `RealtimeRefreshListener`、`ContactRealtimeRefreshListener`、`AutoSubmitInput`、`AutoSubmitSelect`、`DirtySubmitButton`、`form-dirty-state.ts`。
- **Server Action または API:** 更新系 Action は `commitHouseholdMutation` / `publishHouseholdChangeSafely`（`src/lib/realtime.ts`）を利用。SSE Route はメモリ内 subscribe、revision Route は DB read。
- **データアクセス・Prismaモデル:** 家庭同期は `Household.realtimeRevision`、`realtimeActorClientId`、`realtimeActorUserId` と `HouseholdMember`、問い合わせ同期は `ContactInquiry` の同名3列と問い合わせ所有者またはApp管理者権限でAPI認可する。いずれも業務データ更新と revision 増加は同一 transaction。家庭と問い合わせは別イベントバスとし、更新対象scopeを混在させない。
- **バリデーション:** API はログイン・`householdId`・所属を確認。クライアントは `realtimeActorId`、現在ユーザー、未保存フォームを照合する。
- **関連テスト:** `tests/csv-and-realtime.test.ts`、`tests/error-handling.test.ts`。
- **関連設定:** `src/lib/realtime-constants.ts`、`src/lib/realtime-health.ts`。SSE は Node runtime / force-dynamic 指定。
- **依存関係:** SSE はプロセス内配信なので複数インスタンスでは単独では届かない。revision poll がフォールバック。自己更新を SSE と poll の双方で抑止し、保存後の `revalidatePath`、revision、配信の順序を壊さない。

## インフラ・永続化

- **対象:** `prisma/schema.prisma`、`prisma/migrations/`、`prisma/seed-demo.ts`、`src/lib/prisma.ts`、`src/lib/health.ts`、`src/app/api/health/route.ts`、`docker-compose.yml`、`Dockerfile`、`next.config.mjs`、`.env*.example`、`package.json`。
- **役割:** PostgreSQL 接続と Prisma Client、migration、Docker の app / db 分離、standalone build、環境変数・依存ライブラリを定義する。app のホスト側ポートは `127.0.0.1:3001` に限定し、本番アクセスは Nginx / HTTPS を経由させる。`/api/health` とapp healthcheckでNext.js応答・DB接続を確認し、`next.config.mjs` で最低限のセキュリティヘッダーと `X-Powered-By` 無効化を設定する。
- **関連テスト:** `tests/logger.test.ts`（ログ出力）、`tests/audit-log.test.ts`（Household管理操作の成功監査ログ）、`tests/health.test.ts`（DBヘルス判定）、`tests/security-headers.test.ts`（セキュリティヘッダー設定）、`scripts/log-smoke.ts`。変更内容に応じて `npm.cmd run lint`、`npm.cmd run build`、`npm.cmd test` を実行する。
- **依存関係:** Prismaモデル変更は migration・生成 Client・関連 Action / query / schema の更新が必要。`Dockerfile` は Prisma generate と migrate deploy を行う。デプロイは `docker compose up -d --wait --wait-timeout 120` でDB・app双方のhealthyを確認する。プロフィール画像は `HAMSTER_IMAGE_DIR`、思い出画像は `RECORD_IMAGE_DIR` を使い、どちらもComposeの `./uploads:/app/uploads` で永続化する。CSV 上限を変更する際は `next.config.mjs` の Action body size と整合させる。
