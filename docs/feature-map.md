# 機能マップ

最終確認: 2026-08-14。現在のruntime domainは犬・猫の`Pet`のみです。修正対象を探すときは、ここに記載した画面、Action / API、データアクセスと、その直接依存先から調査を始めてください。

## 共通の起点

| 項目 | 主なファイル | 注意点 |
| --- | --- | --- |
| 認証・公開パス | `src/proxy.ts`, `src/auth.ts`, `src/lib/auth-cookies.ts`, `src/app/(app)/login/page.tsx`, `src/app/api/auth/[...nextauth]/route.ts` | 公開対象はログイン、Auth.js callback、health API。通常画面は認証必須で、CookieはDog & Cat Manager専用名を使う。 |
| 現在Household・権限 | `src/lib/auth-context.ts`, `src/lib/authorization.ts`, `src/app/actions/households.ts`, `src/components/household-switcher.tsx` | `OWNER` / `ADMIN` / `MEMBER` / `VIEWER`を共通判定し、共有データ更新は最新membershipをtransaction内でも確認する。 |
| レイアウト・ナビ | `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`, `src/app/globals.css` | 主要導線はDashboard、Pets、Care、Records、Weights。設定・共有・管理・問い合わせは補助導線に置く。 |
| 日付・検索 | `src/lib/date.ts`, `src/lib/care-day.ts`, `src/lib/search.ts`, `src/lib/tags.ts` | timestampはUTC保存・JST表示。測定日・記録日は暦日を維持し、お世話日だけHousehold境界を適用する。 |
| フォーム状態 | `src/components/form-dirty-state.ts`, `dirty-submit-button.tsx`, `unsaved-changes-guard.tsx` | 保存確定時だけdirty基準を更新し、未保存入力があるときの更新・離脱を保護する。 |
| エラー・ログ | `src/lib/server-errors.ts`, `src/lib/logger.ts`, `src/lib/safe-side-effects.ts`, `src/components/status-message.tsx` | 想定外例外は内部情報を隠してerrorIdを返す。commit後の通知・画像削除失敗は業務結果を巻き戻さない。 |

## ログイン・認証

- **画面 / API:** `/login`、`/api/auth/[...nextauth]`。
- **実装:** `src/auth.ts`、`src/lib/auth-cookies.ts`、`src/proxy.ts`、`src/types/next-auth.d.ts`。
- **Prisma:** `User`、`Account`、`Session`、`VerificationToken`。`User.accessStatus`が`SUSPENDED`ならGoogle callbackとDB Session検証の両方で拒否する。
- **テスト:** `tests/auth-isolation.test.ts`、`tests/authorization.test.ts`、`tests/user-access.test.ts`。

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

- **画面:** `/pets`。
- **Action:** `src/app/actions/pets.ts`。作成、更新、管理終了、画像更新を行う。
- **画像:** `src/lib/pet-image.ts`、`src/components/pet-image-field.tsx`、認証付き`/api/pets/[id]/image`。`PET_IMAGE_DIR`へHousehold別UUID WebPを保存する。
- **Prisma:** `Pet`、`PetSpecies`、`PetSex`。speciesは作成後に変更せず、管理終了後も履歴参照のためPet本体を保持する。
- **テスト:** `tests/pets.test.ts`、`tests/pet-image.test.tsx`、`tests/authorization.test.ts`。

## Pet体重

- **画面:** `/weights`。
- **Action / query:** `src/app/actions/pet-weights.ts`、`src/lib/pet-weight-queries.ts`、`src/lib/pet-weight-rules.ts`。
- **UI:** `src/components/pet-weight-chart.tsx`、`src/components/pet-weight-history-list.tsx`。
- **Prisma:** `PetWeightRecord`。Petと測定日の組み合わせは一意で、重量をg単位のDecimalで保存する。
- **テスト:** `tests/pet-weights.test.ts`、`tests/date-validation.test.ts`。

## Pet Care

- **画面:** `/care`。全Pet共通の食事・水、DOGの散歩、CATの猫トイレを履歴として扱う。
- **Action:** `src/app/actions/pet-feeding.ts`、`pet-water.ts`、`pet-walk.ts`、`pet-litter.ts`。
- **query / 日付:** `src/lib/pet-care-queries.ts`、`src/lib/pet-care.ts`、`src/lib/care-day.ts`。
- **Prisma:** `PetFeedingRecord`、`PetWaterRecord`、`PetWalkRecord`、`PetLitterRecord`。`Household.careDayStartMinutes`を全Care種別で共有する。
- **認可:** VIEWER、別Household、管理終了Pet、species不一致、未来時刻、お世話日不一致をAction側で拒否する。
- **テスト:** `tests/pet-care.test.ts`、`pet-care-validation.test.ts`、`pet-species-care.test.ts`、`care-day.test.ts`、`care-day-settings.test.ts`。

## Pet Records

- **画面:** `/records`。健康、通院、投薬、ワクチン、思い出をPetまたはHousehold scopeで検索・ページングする。
- **Action:** `src/app/actions/pet-health-records.ts`、`pet-medical-records.ts`、`pet-medication-records.ts`、`pet-vaccination-records.ts`、`pet-memory-records.ts`、共通`pet-records.ts`。
- **query / schema:** `src/lib/pet-record-queries.ts`、`pet-record-mutations.ts`、`pet-record-schemas.ts`、`pet-records.ts`。
- **UI:** `src/components/pet-record-create-forms.tsx`、`pet-record-timeline.tsx`、`memory-pet-selector.tsx`、`memory-tag-input.tsx`、`record-image-field.tsx`。
- **Prisma:** `PetRecord`を親に5種類のdetail、`PetMemoryRecordPet`、`PetMemoryRecordImage`を持つ。`SavedMemoryTag`と4種類のHealth enumはPet Memory / Healthが使用する。検索は`pg_trgm`を使う。
- **画像:** `src/lib/pet-record-image.ts`、認証付き`/api/pet-records/[id]/image`。`PET_RECORD_IMAGE_DIR`へHousehold別UUID WebPを保存する。
- **テスト:** `tests/records.test.ts`、`tests/authorization.test.ts`、`tests/pet-image.test.tsx`。

## 設定

- **画面:** `/settings`。プロフィール、Pet Dashboard表示数・対象・順序、お世話日の切り替え時刻、問い合わせ・アカウント削除導線を持つ。
- **Action:** `src/app/actions/settings.ts`、`src/app/actions/care-day-settings.ts`。
- **状態管理:** `src/lib/settings-diff.ts`、`settings-save-state.ts`、`src/components/dashboard-settings-form.tsx`、`care-day-settings-form.tsx`。
- **Prisma:** `AppSetting.dashboardBoardCount`、`DashboardPet`、`Household.careDayStartMinutes`。
- **テスト:** `tests/settings.test.ts`、`settings-save-behavior.test.ts`、`dashboard-settings.test.ts`、`care-day-settings.test.ts`。

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

## リアルタイム同期

- **API:** `/api/realtime/household`、`/api/realtime/household/revision`、`/api/realtime/contact`、`/api/realtime/contact/revision`。
- **実装:** `src/lib/realtime.ts`、`realtime-client-id.ts`、`realtime-health.ts`、`src/components/realtime-refresh-listener.tsx`。
- **source:** Petプロフィール、Pet体重、4種類のPet Care、Pet RecordsとHousehold / member / settingsの共通更新だけを扱う。
- **整合性:** 業務データ、Activity、revisionを同じtransactionで更新し、commit後にSSEをpublishする。SSE不達時はrevision pollingが補完する。
- **テスト:** `tests/csv-and-realtime.test.ts`、`tests/dashboard-pet.test.ts`、`tests/household-activity.test.ts`。

## インフラ・永続化

- **対象:** `prisma/schema.prisma`、`prisma/migrations/`、`src/lib/prisma.ts`、`src/lib/health.ts`、`src/app/api/health/route.ts`、`Dockerfile`、`docker-compose.yml`、`.env*.example`、`package.json`。
- **画像root:** `PET_IMAGE_DIR`と`PET_RECORD_IMAGE_DIR`。共有の入力制約・変換は`src/lib/image-constraints.ts`と`src/lib/image-processing.ts`。
- **ログ:** `src/lib/logger.ts`、`scripts/log-smoke.ts`。JSON Linesを標準出力と`LOG_DIR`へ出力する。
- **migration履歴:** `20260814090000_remove_hamster_legacy`より前のmigrationには派生元のHamster schemaが履歴として残る。過去migrationは変更せず、新migrationが空データpreflight後に旧table・enum・設定列を撤去する。現行`schema.prisma`とruntime codeはPet専用である。
- **検証:** `prisma format`、`prisma validate`、`prisma generate`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`git diff --check`。
