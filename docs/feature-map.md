# 機能マップ

最終確認: 2026-08-25。現在のruntime domainは犬・猫の`Pet`のみです。修正対象を探すときは、ここに記載した画面、Action / API、データアクセスと、その直接依存先から調査を始めてください。

## 共通の起点

| 項目 | 主なファイル | 注意点 |
| --- | --- | --- |
| 認証・公開パス | `src/proxy.ts`, `src/auth.ts`, `src/lib/auth-cookies.ts`, `src/app/(app)/login/page.tsx`, `src/app/api/auth/[...nextauth]/route.ts` | 公開対象はログイン、Auth.js callback、health API、通知専用`/sw.js`。通常画面とPush購読APIは認証必須で、CookieはDog & Cat Manager専用名を使う。 |
| 現在Household・権限 | `src/lib/auth-context.ts`, `src/lib/authorization.ts`, `src/app/actions/households.ts`, `src/components/household-switcher.tsx` | `OWNER` / `ADMIN` / `MEMBER` / `VIEWER`を共通判定し、共有データ更新は最新membershipをtransaction内でも確認する。 |
| レイアウト・ナビ | `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`, `src/app/globals.css` | 主要導線はDashboard、Pets、Care、Records、Weights。設定・共有・管理・問い合わせは補助導線に置く。 |
| 初回オンボーディング・再確認ガイド | `src/components/tutorial-provider.tsx`, `src/components/tutorial-settings-entry.tsx`, `src/app/actions/tutorial.ts`, `src/lib/tutorial.ts` | 初回は実Pet登録成功後にCareまで案内し、再確認は読み取り専用。ページ間phaseは`sessionStorage`、完了versionは`User`に保存する。 |
| 日付・検索 | `src/lib/date.ts`, `src/lib/care-day.ts`, `src/lib/search.ts`, `src/lib/tags.ts` | timestampはUTC保存・JST表示。測定日・記録日は暦日を維持し、お世話日だけHousehold境界を適用する。 |
| フォーム状態 | `src/components/form-dirty-state.ts`, `dirty-submit-button.tsx`, `unsaved-changes-guard.tsx` | 保存確定時だけdirty基準を更新し、未保存入力があるときの更新・離脱を保護する。 |
| エラー・ログ | `src/lib/server-errors.ts`, `src/lib/logger.ts`, `src/lib/safe-side-effects.ts`, `src/components/status-message.tsx` | 想定外例外は内部情報を隠してerrorIdを返す。commit後の通知・画像削除失敗は業務結果を巻き戻さない。 |

## ログイン・認証

- **画面 / API:** `/login`、`/api/auth/[...nextauth]`。
- **実装:** `src/auth.ts`、`src/lib/auth-cookies.ts`、`src/proxy.ts`、`src/types/next-auth.d.ts`。
- **Prisma:** `User`、`Account`、`Session`、`VerificationToken`。`User.accessStatus`が`SUSPENDED`ならGoogle callbackとDB Session検証の両方で拒否する。
- **テスト:** `tests/auth-isolation.test.ts`、`tests/authorization.test.ts`、`tests/user-access.test.ts`。

## オンボーディング・使い方ガイド

- **初回フロー:** DashboardのPet登録導線、`/pets`の通常`PetCreateForm`、作成成功したPetのDashboardカード、`/care`の入力エリアをDriver.jsで案内する。Petだけを通常Actionで実DBへ作成し、Care記録は作成しない。
- **再確認フロー:** `/settings`から開始し、Pet管理、お世話、Records、Weightsを説明する。Petが0件または登録権限がない場合はPet固有操作を要求せず、DBを変更しない。
- **状態:** `User.onboardingVersion`をユーザー単位の完了versionとして保持する。進行中の`mode`・`phase`・作成Pet IDは`sessionStorage`にだけ置き、Household切替では完了状態を変えない。
- **実装 / テスト:** `src/components/tutorial-provider.tsx`、`src/components/tutorial-pet-created-bridge.tsx`、`src/app/actions/tutorial.ts`、`src/lib/tutorial.ts`、`tests/tutorial.test.ts`。

## Household共有・メンバー管理

- **画面:** `/settings/members`、`/settings/members/activity`、`/settings/members/leave`、`/settings/members/delete`、`/invitations/accept`。
- **Action:** `src/app/actions/households.ts`、`src/app/actions/members.ts`。
- **業務処理:** `src/lib/household-name.ts`、`household-switcher.ts`、`household-leave.ts`、`household-delete.ts`、`invitation-mutations.ts`。
- **Prisma:** `Household`、`HouseholdMember`、`HouseholdInvitation`、`AppSetting`。完全削除はHousehold起点のCascade、自己退出は本人のmembershipと設定だけを削除する。
- **安全性:** ユーザーlockの後にHousehold lockを取り、最新ロール、OWNER数、移譲先所属、招待状態を同一transaction内で再確認する。DB commit後の画像削除は`src/lib/household-delete-images.ts`がPet用2 rootを独立処理する。
- **テスト:** `tests/household-name.test.ts`、`household-leave.test.ts`、`household-delete.test.ts`、`invitations.test.ts`、`invitation-management.test.ts`。

## Household Activity

- **画面:** `/settings/members/activity`。共有設定、メンバー操作、Petの体重・Care・Recordsイベントを表示する。
- **実装:** `src/lib/household-activity.ts`、`household-activity-queries.ts`、`household-activity-cleanup.ts`、`src/components/household-activity-list.tsx`。
- **Prisma:** `HouseholdActivity`、`HouseholdActivityCategory`、`HouseholdActivityEvent`。業務更新、Activity作成、Household revision増加は同一transactionで確定する。
- **保守 / テスト:** `scripts/cleanup-household-activities.ts`、`tests/household-activity.test.ts`、`tests/household-activity-cleanup.test.ts`。

## Pet Dashboard

- **画面:** `/`。
- **取得:** `src/lib/queries.ts`の`getDashboardData`が管理中Petと当日のお世話集計を取得する。
- **設定:** `src/lib/dashboard-settings.ts`、`src/components/dashboard-settings-form.tsx`、`src/app/actions/settings.ts`。
- **Prisma:** `DashboardPet`が`AppSetting`ごとの表示対象と`sortOrder`を保持し、`AppSetting.dashboardBoardCount`が表示数を保持する。
- **テスト:** `tests/dashboard-pet.test.ts`、`tests/dashboard-settings.test.ts`、`tests/settings.test.ts`。

## Petプロフィール

- **画面:** `/pets`。新規登録は`src/components/pet-create-form.tsx`が修正可能エラー時の入力状態を保持し、プロフィールとは独立した折りたたみ式の本人用Pet通知ルールも表示する。品種は`src/components/breed-combobox.tsx`でspecies別の有効なマスタを検索・選択でき、マスタ外の名称は自由入力として保持する。管理終了済みPetだけに`src/components/pet-delete-control.tsx`の完全削除確認を表示する。
- **Action:** `src/app/actions/pets.ts`。作成、更新、管理終了、画像更新、履歴のない管理終了済みPetの完全削除を行う。完全削除は`src/lib/pet-delete.ts`がPet行をlockしてから体重・4種Care・Pet Record・思い出の多対多関連を同一transaction内で再確認し、Dashboard設定と通知ルールだけをCascade削除対象として許容する。`src/app/actions/pet-notifications.ts`はVIEWERを含む所属メンバー本人の通知ルールだけを一括保存する。
- **画像:** `src/lib/pet-image.ts`、`src/components/pet-image-field.tsx`、認証付き`/api/pets/[id]/image`。`PET_IMAGE_DIR`へHousehold別UUID WebPを保存する。
- **Prisma:** `Pet`、`Breed`、`PetSpecies`、`PetSex`、`PetNotificationRule`。speciesは作成後に変更せず、管理終了後も履歴と通知ルールを保持する。`Breed`は`isActive`で候補から外し、既存Petの参照は維持する。マスタ投入と旧自由入力の完全一致backfillは`prisma/seed-breeds.ts`が担う。
- **テスト:** `tests/pets.test.ts`、`tests/pet-delete.test.ts`、`tests/pet-image.test.tsx`、`tests/authorization.test.ts`、`tests/pet-notifications.test.ts`。

## Pet体重

- **画面:** `/weights`、`/weights/export`（CSVエクスポート）。
- **Action / query:** `src/app/actions/pet-weights.ts`、`src/lib/pet-weight-queries.ts`、`src/lib/pet-weight-rules.ts`、`src/lib/pet-weight-csv-export.ts`、`/weights/export/download` Route。
- **UI:** `src/components/pet-weight-chart.tsx`、`src/components/pet-weight-history-list.tsx`、`src/components/pet-weight-data-management-menu.tsx`、`src/components/pet-weight-csv-export-form.tsx`。
- **Prisma:** `PetWeightRecord`。Petと測定日の組み合わせは一意で、重量をg単位のDecimalで保存する。
- **テスト:** `tests/pet-weights.test.ts`、`tests/pet-weight-csv-export.test.ts`、`tests/date-validation.test.ts`。

## Pet Care

- **画面:** `/care`。全Pet共通の食事・水、DOGの散歩、CATの猫トイレを履歴として扱う。
- **UI:** `src/components/care-disclosure.tsx`が各Care種類の独立した開閉状態と本文アニメーションを管理する。`src/components/care-mutation-feedback.tsx`は成功時に画面遷移せず、同じDisclosure内で通知と再取得を行う。
- **Action:** `src/app/actions/pet-feeding.ts`、`pet-water.ts`、`pet-walk.ts`、`pet-litter.ts`。
- **query / 日付:** `src/lib/pet-care-queries.ts`、`src/lib/pet-care.ts`、`src/lib/care-day.ts`。
- **Prisma:** `PetFeedingRecord`、`PetWaterRecord`、`PetWalkRecord`、`PetLitterRecord`。DOGの任意の散歩距離は`PetWalkRecord.distanceMeters`へ整数meterで保存し、`Household.careDayStartMinutes`を全Care種別で共有する。
- **認可:** VIEWER、別Household、管理終了Pet、species不一致、未来時刻、お世話日不一致をAction側で拒否する。
- **テスト:** `tests/pet-care.test.ts`、`pet-care-validation.test.ts`、`pet-species-care.test.ts`、`care-day.test.ts`、`care-day-settings.test.ts`。

## Pet Records

- **画面:** `/records`。健康、通院、投薬、ワクチン、思い出をPetまたはHousehold scopeで検索・ページングする。URLにscopeがなければ現在のユーザー・Householdの設定を使い、設定未作成・不正値では共有グループ全体を初期表示する。URL指定は設定より優先する。
- **Action:** `src/app/actions/pet-health-records.ts`、`pet-medical-records.ts`、`pet-medication-records.ts`、`pet-vaccination-records.ts`、`pet-memory-records.ts`、共通`pet-records.ts`。
- **query / schema:** `src/lib/pet-record-queries.ts`、`pet-record-mutations.ts`、`pet-record-schemas.ts`、`pet-records.ts`。
- **UI:** `src/components/pet-record-create-forms.tsx`、`pet-record-timeline.tsx`、`src/lib/pet-record-style.ts`、`memory-pet-selector.tsx`、`memory-tag-input.tsx`、`record-image-field.tsx`。
- **Prisma:** `PetRecord`を親に5種類のdetail、`PetMemoryRecordPet`、`PetMemoryRecordImage`を持つ。`SavedMemoryTag`と4種類のHealth enumはPet Memory / Healthが使用する。検索は`pg_trgm`を使う。
- **画像:** `src/lib/pet-record-image.ts`、認証付き`/api/pet-records/[id]/image`。`PET_RECORD_IMAGE_DIR`へHousehold別UUID WebPを保存する。
- **テスト:** `tests/records.test.ts`、`tests/authorization.test.ts`、`tests/pet-image.test.tsx`。

## 設定

- **画面:** `/settings`。プロフィール、記録画面の初期表示（選択中のPet / 共有グループ全体）、Pet Dashboard表示数・対象・順序、お世話日の切り替え時刻、通知端末・本人用通知本文、iPhoneホーム画面追加ガイド、問い合わせ・アカウント削除導線を持つ。PWAガイドは`/settings/pwa`で、画像は`public/help/pwa/iphone/`に置く。
- **Action:** `src/app/actions/settings.ts`、`src/app/actions/care-day-settings.ts`。
- **状態管理:** `src/lib/settings-diff.ts`、`settings-save-state.ts`、`src/components/dashboard-settings-form.tsx`、`display-settings-section.tsx`、`care-day-settings-form.tsx`。記録画面scopeだけの変更は`DashboardPet`を再作成しない。
- **Prisma:** `AppSetting.dashboardBoardCount`、`AppSetting.recordTimelineDefaultScope`（DB default・アプリfallbackとも`household`）、`AppSetting.careNotificationCompactBody`、`DashboardPet`、`Household.careDayStartMinutes`。
- **テスト:** `tests/settings.test.ts`、`settings-save-behavior.test.ts`、`dashboard-settings.test.ts`、`care-day-settings.test.ts`、`pwa-install-guide.test.ts`。

## アカウント削除

- **画面:** `/settings/account/delete`。
- **Action / 業務処理:** `src/app/actions/account.ts`、`src/lib/account-delete.ts`、`account-delete-shared.ts`。
- **安全性:** ユーザーlock、SUPER_ADMIN全体lock、Household ID順lockを取り、移譲・退出・単独Household削除・User削除を1 transactionで実行する。最後の利用中SUPER_ADMINは削除しない。
- **テスト:** `tests/account-delete.test.ts`、`tests/audit-log.test.ts`。

## サポート・お問い合わせ

- **画面:** `/contact`、`/contact/[publicId]`、`/admin/inquiries`、`/admin/inquiries/[publicId]`。
- **Action / query:** `src/app/actions/contact.ts`、`src/lib/contact-inquiry-core.ts`、`contact-inquiry-mutations.ts`、`contact-inquiry-queries.ts`。
- **Prisma:** `ContactInquiry`、`ContactInquiryMessage`と関連enum。新規公開番号は`DCM-YYYYMMDD-XXXXXXXXXX`。既存リンクを壊さないため、旧`HMB-...`形式は読み取り時だけ互換受理する。
- **リアルタイム / 保守:** `src/lib/contact-realtime*.ts`、`/api/realtime/contact*`、`scripts/close-resolved-contact-inquiries.ts`。
- **テスト:** `tests/contact-inquiries.test.ts`、`tests/contact-inquiry-auto-close.test.ts`。

## アプリ全体管理

- **画面:** `/admin`、`/admin/users`、`/admin/households`、`/admin/inquiries`。
- **Action / query:** `src/app/actions/admin.ts`、`src/lib/admin-users.ts`、`admin-households.ts`、`admin-invitations.ts`、`user-access.ts`。
- **Prisma:** `AppRole`、`UserAccessStatus`、`UserAccessAction`。停止はデータを削除せず全Sessionを無効化し、履歴を保存する。
- **補助 / テスト:** `prisma/admin-role.ts`、`prisma/seed-admin-pagination.ts`、`tests/admin-overview.test.ts`、`admin-users.test.ts`、`admin-households.test.ts`、`admin-invitations.test.ts`、`user-access.test.ts`。
- **UI fixture:** `prisma/seed-ui-fixtures.ts`、`prisma/ui-fixture-logic.ts`、`tests/ui-fixtures.test.ts`。development DB限定の全画面確認データをpreview・投入・cleanupする。

## リアルタイム同期

- **API:** `/api/realtime/household`、`/api/realtime/household/revision`、`/api/realtime/contact`、`/api/realtime/contact/revision`。
- **実装:** `src/lib/realtime.ts`、`realtime-client-id.ts`、`realtime-health.ts`、`src/components/realtime-refresh-listener.tsx`。
- **source:** Petプロフィール、Pet体重、4種類のPet Care、Pet RecordsとHousehold / member / settingsの共通更新だけを扱う。
- **整合性:** 業務データ、Activity、revisionを同じtransactionで更新し、commit後にSSEをpublishする。SSE不達時はrevision pollingが補完する。
- **テスト:** `tests/csv-and-realtime.test.ts`、`tests/dashboard-pet.test.ts`、`tests/household-activity.test.ts`。

## Petお世話通知 / Web Push

- **設定:** `/settings`の`src/components/notification-settings-form.tsx`が端末購読と通常・簡略本文を管理し、`/pets`の`pet-notification-rules-form.tsx`がPet別ルールをプロフィールとは別フォームで管理する。
- **判定:** `src/lib/pet-notifications.ts`がcare-day順序、JST実予定時刻、ルールごとの半開区間、本文安全化をpure functionとして扱う。Litterは`CLEANED`だけを完了とする。
- **Push:** `/api/push/subscriptions`、`/status`、`src/lib/web-push.ts`、`public/sw.js`、`service-worker-registration.tsx`。mutation APIは認証・same-origin・本文サイズ・endpoint所有者を検証する。
- **配信:** `src/lib/care-notification-dispatch.ts`、`scripts/dispatch-care-notifications.ts`。実予定時刻単位のDB claim、lease、最大3回retry、端末別成功履歴、失効購読削除を行う。
- **Prisma:** `PetNotificationRule`、`WebPushSubscription`、`CareNotificationDispatch`、`CareNotificationDelivery`と関連enum。
- **テスト:** `tests/pet-notifications.test.ts`、`tests/pet-notification-rules-form.test.tsx`。

## インフラ・永続化

- **対象:** `prisma/schema.prisma`、`prisma/migrations/`、`src/lib/prisma.ts`、`src/lib/health.ts`、`src/app/api/health/route.ts`、`Dockerfile`、`docker-compose.yml`、`.env*.example`、`package.json`。
- **画像root:** `PET_IMAGE_DIR`と`PET_RECORD_IMAGE_DIR`。共有の入力制約・変換は`src/lib/image-constraints.ts`と`src/lib/image-processing.ts`。
- **ログ:** `src/lib/logger.ts`、`scripts/log-smoke.ts`。JSON Linesを標準出力と`LOG_DIR`へ出力する。
- **migration履歴:** `20260814090000_remove_hamster_legacy`より前のmigrationには派生元のHamster schemaが履歴として残る。過去migrationは変更せず、新migrationが空データpreflight後に旧table・enum・設定列を撤去する。現行`schema.prisma`とruntime codeはPet専用である。
- **検証:** `prisma format`、`prisma validate`、`prisma generate`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`git diff --check`。
