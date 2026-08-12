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

- `/care` に犬猫共通の食事・水管理を追加する。
- DOGには散歩、CATには猫トイレの管理を追加する。
- `/weights` をPet向けの体重履歴・グラフとして追加する。
- `/records` にPet向けの健康・通院・投薬・ワクチン・思い出を追加する。

これらはPetを中心に関連付けるが、基本プロフィール機能の段階では先行実装しない。Hamster固有機能はPet側の代替機能を実装・確認してから段階的に置換し、動作確認前に一括削除または一括リネームしない。
