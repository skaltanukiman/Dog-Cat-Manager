# Dog & Cat Manager 設計方針

## サービスの位置づけ

このリポジトリは Hamster Manager から派生した、犬・猫専用の独立サービス `Dog & Cat Manager` である。移行期間中は既存の Hamster ドメインと新しい Pet ドメインが同じリポジトリ内に共存する。

Hamster Manager とは別DB・別Sessionで運用する。開発用Docker環境は `dog_cat_manager_dev`、`dog-cat-manager-db`、`dog_cat_manager_pgdata` を使い、Hamster ManagerのDBコンテナ・volumeを共有しない。Dog & Cat ManagerのDocker appは `http://localhost:3002` で公開し、Auth.jsのsecretとCookie名もサービス専用にする。現在選択中HouseholdにはDog-Cat専用の `dog_cat_manager_current_household` Cookieだけを使用し、Hamster ManagerのHousehold選択Cookieには干渉しない。SessionはDog-Cat専用DBへ保存し、現時点では共通認証、Session共有、Cookie共有、SSO、Household同期を実装しない。Google OAuth Clientは当面共有し、Hamster側とDog-Cat側のredirect URIを両方登録する。将来は環境変数で各サービスのURLを設定する `ServiceSwitcher` により、Hamster Manager と Dog & Cat Manager を相互移動できるようにする。

## Petドメイン

- 犬と猫は共通の `Pet` モデルで扱い、DOG用・CAT用の別テーブルには分けない。
- 種別は `PetSpecies.DOG` と `PetSpecies.CAT` だけを許可する。
- `Pet.species` は新規登録時に確定し、登録後は変更不可とする。将来のDOG/CAT固有データとの整合性を守るためである。
- 性別は `PetSex.MALE`、`PetSex.FEMALE`、`PetSex.UNKNOWN` を使用する。
- 既存のHousehold構造を継承し、すべてのPetは必ず1つのHouseholdに属する。
- Pet名の一意性はHousehold内に限定し、別Householdでは同名を許可する。
- 通常の管理終了は物理削除ではなく `isActive` で表し、Pet本体と将来の履歴を保持する。
- 誕生日とお迎え日は時刻を持たない暦日として保存し、タイムゾーン変換しない。

### Petプロフィール画像

- Petプロフィール画像は `PET_IMAGE_DIR` で管理し、Dockerのデフォルト保存先は `/app/uploads/pets` とする。
- `PET_IMAGE_DIR/{householdId}/{uuid}.webp` の非公開ディレクトリへ保存し、認証済みのPet画像API経由でのみ配信する。`Pet.profileImageFileName` にはUUID形式のWebPファイル名だけを保持する。
- 旧Hamster画像の `HAMSTER_IMAGE_DIR` とはコード・保存先を分離する。移行期間中は `/app/uploads/hamsters` と `/app/uploads/pets` を共存させ、Hamster機能撤去後に `HAMSTER_IMAGE_DIR` を削除する。
- 管理終了では画像を削除せず、管理中へ戻した際も同じ画像を使用する。

### Pet体重履歴

- Pet体重履歴はPet専用の `PetWeightRecord` で管理し、旧Hamsterの `WeightRecord` とは移行期間中共存する。既存モデルのリネームやカラム変更は行わない。
- 体重は犬・猫共通でkg単位とし、`Decimal(5,2)` へ0.01kg単位で保存する。PrismaのDecimalは画面・グラフ境界でnumberへ明示変換する。
- 測定日はUTC timestampではなく暦日として扱い、Petごとに1日1件だけ登録できる。
- 管理終了Petの既存履歴は保持・閲覧できるが、登録・編集・削除はできない。管理中へ戻した場合は同じ履歴を再編集できる。VIEWERも履歴とグラフの閲覧だけを許可する。
- Pet版が安定した後にHamster体重機能を段階的に撤去し、必要であれば将来 `PetWeightRecord` から `WeightRecord` への名称整理を検討する。

## 段階的な拡張予定

- `/care` は犬猫共通のPetお世話画面とし、食事・水に加えてDOGの散歩とCATの猫トイレをイベント履歴として管理する。
- `/weights` をPet向けの体重履歴・グラフとして追加する。
- `/records` にPet向けの健康・通院・投薬・ワクチン・思い出を追加する。

これらはPetを中心に関連付け、現在はPet Care・Pet体重・Pet記録とPet Dashboardまで段階的に実装済みである。Hamster固有機能はPet側の代替機能を実装・確認してから段階的に置換し、動作確認前に一括削除または一括リネームしない。

## Petダッシュボード

- 通常の`/`は現在HouseholdのPet専用Dashboardとし、名前、犬・猫、管理中・管理終了、プロフィール画像、最新体重、現在のお世話日のCare集計を表示する。
- 表示対象はユーザー・Householdごとの`AppSetting`と`DashboardPet`で管理する。`dashboardBoardCount`の1〜30件制約を再利用し、超過時は保存順を優先する。設定なし・削除済みIDの補完は管理中、登録日時、IDの安定順とする。保存済みの管理終了Petは表示できる。
- Pet Careはイベント履歴なので、Dashboardでは食事・水・DOG散歩・CATトイレの件数と最新イベントだけを集計表示する。完了booleanや直接toggleへ変換せず、登録は既存`/care?petId=...`へ委ねる。管理終了PetにはCare登録導線を表示しない。
- Care記録は`Household.careDayStartMinutes`から現在のお世話日を確定し、種類別の一括queryをPet IDとHousehold条件で絞ってサーバー側集計する。DOGはWalkだけ、CATはLitterだけを表示する。
- 最新体重は`PetWeightRecord`をPetごとに最新1件だけ取得し、kgのDecimalを表示境界まで維持する。
- 旧`DashboardHamster`、`AppSetting.dashboardHamsters`、Hamster Dashboard用Action・component・migrationはlegacyとして残す。通常Dashboard設定保存は`DashboardPet`だけを更新し、Hamster設定を削除しない。

## Petお世話履歴

- 食事はPet専用の `PetFeedingRecord`、水はPet専用の `PetWaterRecord` で管理し、旧Hamsterの `FeedingRecord` / `WaterReplacementRecord` とは移行期間中共存する。
- Pet Careは1日1回の完了状態ではなくイベント履歴型であり、同一Pet・同一お世話日に食事・水を複数件登録できる。食事は日時とmemo、水は日時・`REPLACED`（交換）/ `REFILLED`（補充）・memoを持つ。
- timestampはUTCで保存し、画面入出力はJSTへ明示変換する。`recordDate` は作成・日時更新時点の `Household.careDayStartMinutes` から算出し、設定変更後も既存履歴を再計算しない。
- VIEWERと管理終了Petは履歴閲覧だけを許可する。変更ActionはHousehold境界とtransaction内の最新membershipを再確認する。
- DOG専用の `PetWalkRecord` は `startedAt`・任意の `durationMinutes`・memoを持つ。CAT専用の `PetLitterRecord` は `occurredAt`・`PetLitterAction`（`URINATION` / `DEFECATION` / `BOTH` / `CLEANED`）・memoを持つ。どちらも同一お世話日に複数件を許可する。
- species固有記録の変更可否はDBから `Pet.species` を再取得して保証する。WalkはDOG、LitterはCATだけを変更できる。
- GPS・散歩ルート・猫トイレの健康判定・通知はPhase 3B対象外とし、1日1回完了を前提とする既存Hamster通知はPet Careへ移植しない。

## Pet記録

- `/records` はPet専用の共通タイムラインとし、`PetRecord` をbaseに `HEALTH`、`MEDICAL`、`MEDICATION`、`VACCINATION`、`MEMORY` の5種類を扱う。各種類の固有値は `PetHealthRecordDetail`、`PetMedicalVisitDetail`、`PetMedicationRecordDetail`、`PetVaccinationRecordDetail`、`PetMemoryRecordDetail` に分離する。
- 記録日はHouseholdのお世話日ではなく通常のJST暦日であり、`careDayStartMinutes`を使わない。任意時刻はUTC timestampへ変換せず、JST壁時計の0時からの分数として保存する。
- VIEWERと管理終了Petは既存記録の閲覧・検索・絞り込みだけを許可し、登録・編集・削除を拒否する。変更時はtransaction内で最新membership、Demo状態、対象PetのHousehold所属と管理状態を再確認する。
- 思い出は同一Householdの複数Pet、タグ、お気に入り、写真1枚に対応する。関連Petに管理終了Petが含まれる間は思い出全体を閲覧専用とする。
- Pet思い出画像は `PET_RECORD_IMAGE_DIR`（Docker既定 `/app/uploads/pet-records`）へHousehold別のUUID WebPとして保存し、認証付き `/api/pet-records/[id]/image` だけから配信する。旧Hamster思い出の `RECORD_IMAGE_DIR` とは相互利用せず、既存画像を移動しない。
- 旧Hamster Recordsのモデル、Action、query、component、画像保存先は移行期間中そのまま残す。投薬・ワクチン通知、Dashboard表示、複数画像UIは後続Phaseとする。
