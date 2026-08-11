# Dog & Cat Manager 設計方針

## サービスの位置づけ

このリポジトリは Hamster Manager から派生した、犬・猫専用の独立サービス `Dog & Cat Manager` である。移行期間中は既存の Hamster ドメインと新しい Pet ドメインが同じリポジトリ内に共存する。

Hamster Manager とは別DB・別Sessionで運用する。開発用Docker環境は `dog_cat_manager_dev`、`dog-cat-manager-db`、`dog_cat_manager_pgdata` を使い、Hamster ManagerのDBコンテナ・volumeを共有しない。現時点では共通認証、Session共有、Cookie共有、SSO、Household同期を実装しない。将来は環境変数で各サービスのURLを設定する `ServiceSwitcher` により、Hamster Manager と Dog & Cat Manager を相互移動できるようにする。

## Petドメイン

- 犬と猫は共通の `Pet` モデルで扱い、DOG用・CAT用の別テーブルには分けない。
- 種別は `PetSpecies.DOG` と `PetSpecies.CAT` だけを許可する。
- 性別は `PetSex.MALE`、`PetSex.FEMALE`、`PetSex.UNKNOWN` を使用する。
- 既存のHousehold構造を継承し、すべてのPetは必ず1つのHouseholdに属する。
- Pet名の一意性はHousehold内に限定し、別Householdでは同名を許可する。
- 通常の管理終了は物理削除ではなく `isActive` で表し、Pet本体と将来の履歴を保持する。
- 誕生日とお迎え日は時刻を持たない暦日として保存し、タイムゾーン変換しない。

## 段階的な拡張予定

- `/care` に犬猫共通の食事・水管理を追加する。
- DOGには散歩、CATには猫トイレの管理を追加する。
- `/weights` をPet向けの体重履歴・グラフとして追加する。
- `/records` にPet向けの健康・通院・投薬・ワクチン・思い出を追加する。

これらはPetを中心に関連付けるが、基本プロフィール機能の段階では先行実装しない。Hamster固有機能はPet側の代替機能を実装・確認してから段階的に置換し、動作確認前に一括削除または一括リネームしない。
