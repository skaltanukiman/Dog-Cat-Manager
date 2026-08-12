# Hamster Manager Browser

Google スプレッドシートと GAS で管理していたハムスターの衛生管理・体重管理に、健康・通院・思い出の時系列記録を加え、VPS 上で運用しやすい Web アプリとして作り直したものです。

Next.js アプリと PostgreSQL を Docker Compose で分離して動かします。Google アカウントでログインし、ユーザーが所属する Household 単位でハムスター、衛生記録、体重記録、健康・通院・思い出記録を管理します。招待されたユーザーは招待リンクから同じ Household に参加できます。VPS ホスト側の Nginx から Next.js コンテナへリバースプロキシする運用、または Tailscale などの VPN 経由で利用する運用を想定しています。既存の PM2 管理アプリとは別管理にします。

## 主な機能

### 認証・共有

- Auth.js / NextAuth と Google OAuth によるログイン
- 未ログイン時は `/login` へリダイレクト
- 初回ログイン時に個人用 Household を自動作成。同時アクセス時も同じユーザーに個人用 Household が重複作成されないよう直列化
- 複数の Household に所属している場合は、ヘッダーの「操作対象」で現在の共有を切り替え
- ハムスター、衛生記録、体重記録、健康・通院・思い出記録、ダッシュボード設定を Household / ユーザー単位で分離
- `/settings/members` で現在の Household のメンバー一覧を表示
- OWNER / ADMIN は招待リンクを作成可能
- 招待リンクを開いたユーザーは Google ログイン後に同じ Household へ MEMBER として参加
- OWNER は VIEWER / MEMBER / ADMIN の権限切り替えが可能
- ADMIN は VIEWER / MEMBER の共有参加を解除可能
- OWNER は自分自身と最後の OWNER を除き、共有メンバーの参加を解除可能
- 設定画面から自分のアカウントを完全削除可能。単独所有グループはデータ・画像ごと削除し、共有グループは必要に応じて所有権を明示移譲して退出

Household単位の権限は次のとおりです。`User.appRole` のアプリ全体権限とは別に判定し、アプリ全体の管理者でもHousehold内では所属ロールに従います。

| Household権限 | 共有データ閲覧 | ハムスター・衛生・体重・記録の登録／更新／削除 | 体重CSV | 招待リンク | メンバー解除 | メンバー権限変更 | 自分のプロフィール／ダッシュボード設定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OWNER（オーナー） | 可 | 可 | エクスポート／インポート可 | 作成可 | 自分自身・最後のOWNERを除き可 | VIEWER／MEMBER／ADMIN間で可 | 可 |
| ADMIN（管理者） | 可 | 可 | エクスポート／インポート可 | 作成可 | VIEWER／MEMBERのみ可 | 不可 | 可 |
| MEMBER（メンバー） | 可 | 可 | エクスポート／インポート可 | 不可 | 不可 | 不可 | 可 |
| VIEWER（閲覧者） | 可 | 不可 | エクスポートのみ可 | 不可 | 不可 | 不可 | 可 |

### アプリ全体管理

- `User.appRole` でアプリ全体権限を管理
- `ADMIN` / `SUPER_ADMIN` は `/admin` からユーザー、共有、招待状態を確認可能
- `SUPER_ADMIN` は `/admin` からユーザーのアプリ全体権限を変更可能
- `SUPER_ADMIN` は `/admin/users` からユーザーを利用停止・利用停止解除可能。停止してもアカウント、共有グループ、ハムスター、飼育記録は削除しない
- 自分自身の降格と最後の `SUPER_ADMIN` の降格は不可
- 初期管理者は Google ログイン後に CLI スクリプトで付与

### 共有グループの操作履歴

共有グループでは、現在所属している `OWNER` / `ADMIN` / `MEMBER` / `VIEWER` が「誰が・いつ・何を操作したか」を確認できます。`/settings/members` には最新5件だけを表示し、「すべての履歴を見る」から `/settings/members/activity` へ移動できます。一覧は新しい順の20件ページングで、「すべて」「飼育記録」「メンバー」「グループ設定」をDB側で絞り込みます。

第一段階の対象は、共有グループ名、招待リンク作成・無効化・参加、権限変更・参加解除・退出・所有権移譲を伴う退出、ハムスター登録・削除、体重登録・更新・削除・一括削除・アプリ版/GAS版CSVインポート、衛生管理の月保存です。体重一括削除、CSVインポート、衛生管理は1操作につき1件の要約だけを保存します。

第二段階では、健康記録・通院記録・思い出記録の作成・更新・削除、プロフィール画像の登録・差し替え・削除、ハムスターの管理中・管理外切り替えを追加しました。すべて既存の `CARE_RECORD`（飼育記録）カテゴリーへ表示します。健康・通院・思い出は対象レコードID、ハムスター名snapshot、記録日だけを保存し、入力内容・タイトル・本文・タグ・医療情報は複製しません。プロフィール画像は追加・差し替え・削除の種別だけを保存し、ファイル名・パス・MIME・サイズ等は保存しません。思い出の写真操作は思い出記録の作成または更新1件へまとめ、画像専用履歴は作りません。

表示文章そのものではなく、イベント種別、カテゴリー、操作時点の操作者名・対象名、表示に必要な最小限の詳細を `HouseholdActivity` に保存します。名前未設定時は「名前未設定」とし、メールアドレスは代用しません。招待token/URL、Cookie、Session、OAuth token、Authorization header、CSV本文・ファイル名、フォーム全体、掃除メモ、ハムスターメモ、健康・通院・思い出の内容、画像ファイル情報は保存しません。業務更新・操作履歴・Household revisionは同一transactionで確定し、変更なし・検証失敗・権限不足・競合・DB失敗時には履歴を作りません。画像ファイルの旧参照削除は既存どおりDB commit後に実行し、失敗時は確定済みのDB更新・履歴・revisionを成功として警告ログへ残します。

ハムスタープロフィールの名前・メモ・誕生日・お迎え日の編集、思い出画像専用イベント、保存済みタグ候補の操作、項目単位の詳細差分、履歴の手動削除・CSV出力・通知・過去履歴生成は引き続き対象外です。

Household削除時は履歴もCascade削除されます。アカウント削除時は `actorUserId` を `SetNull` にし、当時の `actorNameSnapshot` は残ります。既存の `writeHouseholdAuditLog` とサーバーログは障害調査・内部監査・errorId追跡用として維持し、利用者向け操作履歴とは役割を分けています。

### 共通 UI

- 登録、保存、更新などの通常メッセージは数秒後にアニメーションして自然に非表示
- エラーメッセージは自動で消さず、右端の閉じるボタンで非表示
- 想定外例外は内部情報を表示せず、日本語の汎用メッセージとログ照合用エラーIDを表示
- Server Action のDB更新と Household revision 更新は同一トランザクションで確定し、SSE配信失敗は保存結果へ影響させない
- 変更がない保存・更新は DB 更新を行わず、「変更はありません。」を表示
- ハムスター一覧、衛生管理、体重履歴の保存ボタンは、編集が入るまで非活性
- 同じ Household のデータが他の画面で更新された場合は SSE 通知または 4 秒ごとの revision チェックで検知し、未保存の入力がなければ画面を自動再取得
- 未保存の入力がある場合は自動再取得せず、「他のユーザーが更新しました。」通知から手動で再読み込み可能
- 更新 revision と更新元のタブ・ユーザーを DB に保持し、更新した画面自身には他ユーザー更新通知を表示しない
- SSEとrevision確認が連続して失敗し、一定時間同期できない場合だけ同期停止警告を表示し、回復時に自動解除

### ダッシュボード

- 設定画面で選択したハムスターのカードを表示
- 表示ボード数は 1〜30 件で設定可能
- 表示対象数を超えるハムスターがいる場合は、表示するハムスターを選択可能
- 現在のお世話日の食事（未実施 / 実施済み）と水替え（未交換 / 交換済み）をカード全体の操作で切り替え
- 最新体重を表示
- トイレ掃除、砂場掃除、床材全交換、ハウス掃除ごとの最新状態を表示
- 掃除日は「経過日数」と「日付」をクリックまたはタッチで切り替え可能
- 管理中 / 管理外の状態をカード上に表示
- 長いメモは省略表示し、クリックまたはタッチで全文をモーダル表示
- メモや未記録の有無でカード高さが大きく崩れないように調整
- プロフィール画像を名前・メモと最新情報の間へサムネイル表示。未登録・読込失敗時は同じ大きさのプレースホルダーを表示

### ハムスター管理

- ハムスターの登録、編集、削除
- 名前、メモ、誕生日、お迎え日を管理
- JPEG / PNG / WebP のプロフィール画像を登録・差し替え・削除（元画像10MB以内、512px正方形のWebPへ変換し、保存画像は2MB以下）
- 名前は 15 文字以内
- メモは 2000 文字以内
- 誕生日、お迎え日は未来日入力不可
- 同名登録時はハムスター登録用のエラーメッセージを表示
- 管理中 / 管理外を切り替え可能
- 管理外のハムスターはプロフィール編集、衛生記録、体重記録をロック
- 管理外でもハムスター自体の削除と、管理中への復活は可能
- 一覧は表示対象を「登録順」「名前」から選択可能
- 並び順は「昇順」「降順」から選択可能
- 登録時は反映が分かりやすいよう、登録順 / 降順へ切り替え
- ハムスター名のリアルタイム検索に対応
- 検索は NFKC 正規化、小文字化、カタカナをひらがなへ寄せて比較
  - 例: `しろ` で `シロ` がヒット
  - 例: `シロ` で `しろ` がヒット
- 一覧は 20 件ごとにページング
- ページ移動は「最初へ」「前へ」「次へ」「最後へ」に対応
- 削除対象のチェックボックスは常時表示
- 1 件以上選択すると、選択アクションバーに「全選択」「全解除」「削除」を表示
- 削除前に確認ダイアログを表示
- 編集保存は変更がある場合のみ実行
- 未保存の編集がある状態で他画面へ移動しようとすると確認モーダルを表示

### 健康・通院・思い出記録

- `/records` で最初に対象ハムスターを選び、設定済みのコンボボックス式／プルダウン式を利用
- 「体調を記録」「通院を記録」「思い出を追加」の種類別フォームを用意し、不要な項目を同時表示しない
- 体調記録は総合状態、食欲、活動量、便、尿、複数症状、メモに加え、チェックした場合だけ任意時刻を保存・編集。当日の時刻は保存ボタン押下後のサーバー側JST現在時刻と比較し、未来時刻を拒否
- 通院記録は通院理由だけを内容必須とし、病院名、診断、検査、治療、処方薬、投薬方法、次回予定日、診察費、メモは任意。診察費は0円以上の整数
- 思い出記録はタイトル、内容、自由タグ、お気に入り、写真1枚を保存。タグは「、」またはカンマ区切りで最大20件。保存時は全角英数字・記号等を半角へ正規化し、英字の大文字小文字は別タグとして保持する。「入力したタグを保存して再利用する」を選ぶと、各タグをHousehold共通の候補として個別保存し、次回以降は候補ボタンから入力可能。保存候補は選択モーダルから複数件をまとめて削除でき、削除しても登録済みの思い出記録に付いたタグは残る
- 複数ハムスターへの関連付けは思い出記録だけが対応する。1件の思い出を同じHouseholdの1〜100匹へ関連付け、管理外ハムスターも対象にできる。体調・通院記録は従来どおり1匹だけに所属する
- 思い出の新規登録ではページ上部で選択中のハムスターを対象かつ代表として固定し、同じHouseholdの対象を追加する。編集では対象を追加・解除でき、旧代表を解除した場合は選択中の先頭を新しい代表にする。代表は互換性維持用の `hamster_records.hamster_id` に保存し、対象一覧にも必ず含める
- 対象選択は `MemoryHamsterSelector` の `details` / `summary` で表示する。選択名は最大2匹、残りは「ほかN匹」、合計件数と代表を閉じた状態でも要約する。新規2〜4匹は初期展開、5匹以上と編集時は初期折りたたみ、候補が1匹だけなら固定表示とする。対象エラー時は自動展開し、スマートフォンの一覧は約256pxを上限に内部スクロールする
- `summary` の三角は独自の `ChevronRight` を使用し、閉状態は右向き、開状態は下向きにする。639px以下は三角と本文の2列にして、本文列内で見出しと要約を2段表示する。640px以上は見出しと要約を自然な横並びに戻す。標準マーカーは `list-none` とWebKit向け指定で非表示にし、開閉は `summary` 行全体のネイティブ操作を利用する
- 思い出Actionは `FormData.getAll("hamsterIds")` で複数値を取得し、空選択、空ID、過剰件数を拒否する。重複IDは安全に正規化し、保存直前のtransaction内で全対象が現在のHousehold所属であることを再確認する。思い出本体、対象関連、タグ、画像メタデータ、操作履歴、Household revisionは同じtransactionで確定する
- 体調・通院・思い出の作成エラーはフォーム内へ表示し、画面位置と入力内容を保持。思い出写真の元画像10MB上限とMIME形式は送信前にも検証する
- JPEG / PNG / WebP の思い出写真を元画像10MB以内で受け付け、縦横比を維持した長辺1920px以内のWebPへ変換。品質・解像度を段階調整して保存画像を2MB以下にし、認証と現在のHousehold所属を確認する `/api/records/[id]/image` だけから配信
- 3種類を記録日の新しい順で同じタイムラインへ表示。同日内は時刻ありを時刻の降順、次に時刻なし、同条件は作成日時とIDの降順で安定ソート。個別表示では体調・通院を `hamster_records.hamster_id`、思い出を対象中間テーブルで判定し、共有思い出を各対象ハムスターのタイムラインへ表示する。グループ全体表示では対象数にかかわらず1件だけ表示し、カードには全対象ハムスター名を折り返して表示する
- 種類、期間、キーワード、お気に入りでDB側絞り込み。通常キーワードはタイトル、メモ、症状、通院内容、薬、思い出本文を、`#タグ` は思い出タグだけを対象とし、20件ずつページング。検索時は通常キーワード・`#タグ`とも大文字小文字と全角半角の差を吸収する
- 健康・通院・思い出の日付は暦日として保存し、未来日は不可。次回通院予定日だけ未来日を許可
- OWNER / ADMIN / MEMBER は登録・編集・削除可能。VIEWER は閲覧、検索、絞り込み、ページ移動のみ可能で、Server Actionでも更新を拒否
- 管理外ハムスターの健康・通院記録は既存記録の閲覧だけ可能。思い出記録は管理状態に関係なく登録・編集・削除可能
- 更新とHousehold revisionを同一トランザクションで確定し、既存のSSE・revision poll・未保存変更ガードを利用
- 思い出削除、画像差し替え、ハムスター削除では不要になった画像を削除。共有思い出の対象ハムスターを削除する場合、削除対象外のハムスターが残れば思い出と画像を保持し、代表が削除対象なら残る対象へ先に付け替える。対象が全員削除される思い出だけを削除し、一括削除でも同じ判定をtransaction内で行う。DB更新後のファイル削除失敗は警告ログへ残す

### 衛生管理

- ハムスターと年月を選択して、月別の掃除記録を入力
- 掃除項目のチェックボックスとメモは、変更後に「保存」を押した時点でまとめて反映し、同じ共有を開いている画面へ通知
- ハムスターまたは年月を変更すると即時切り替え
- 管理外ハムスターは通常プルダウンに表示せず、「管理外も含む」チェック時のみ候補に表示
- ハムスター選択 UI は設定画面で以下を切り替え可能
  - コンボボックス式
  - プルダウン式
- 初期表示ではハムスターを自動選択せず、選択後に入力表を表示
- 日別に以下を保存
  - トイレ掃除
  - 砂場掃除
  - 床材一部交換
  - 床材全交換
  - ハウス掃除
  - メモ
- PC / タブレット幅では表形式で入力
- スマホ幅では日別カード形式で入力
- スマホ幅では年月項目の下に日付フィルターを表示し、該当日だけに絞り込み可能
- 今日の日付は背景色で強調
  - 表形式では「今日」文言は表示しない
  - スマホのカード形式では「今日」バッジを表示
- 未来日は入力不可
- 管理外のハムスターは入力・保存不可
- スマホ幅ではチェックボックスまたはメモの変更後に画面右下へ固定保存ボタンを表示
- 保存は変更がある場合のみ実行
- 未保存の編集がある状態で他画面へ移動しようとすると確認モーダルを表示

### 体重管理

- ハムスターを選択して体重を登録
- 管理外ハムスターは通常プルダウンに表示せず、「管理外も含む」チェック時のみ候補に表示
- 日付と体重(g)を保存
- 未来日は入力不可
- 体重は 1〜500g、0.1g 単位で入力可能
- 同じハムスター・同じ測定日の体重登録は、重複エラーとして表示
- 管理外のハムスターは登録・編集・削除不可
- 折れ線グラフで体重推移を表示
- 履歴は DB 側で絞り込み・ソート・ページング
- 履歴は 20 件ごとにページング
- グラフは現在の表示条件に一致する全体の体重推移を表示し、ページング中の一覧ページだけには限定しない
- 表示フィルター
  - 全件
  - 月ごと
- 月ごとの候補は体重記録日に存在する年月から自動作成
- 「全件」表示時は対象月の選択を非表示
- ソート対象
  - 登録順
  - 日付
  - 体重
- 並び順
  - 昇順
  - 降順
- 初期表示は日付 / 降順
- 体重登録後は反映が分かりやすいよう、登録順 / 降順へ切り替え
- ページ移動は「最初へ」「前へ」「次へ」「最後へ」に対応
- 削除対象のチェックボックスは常時表示
- 1 件以上選択すると、選択アクションバーに「全選択」「全解除」「削除」を表示
- 削除前に確認ダイアログを表示
- 履歴編集の保存は変更がある場合のみ実行
- 未保存の編集がある状態で他画面へ移動しようとすると確認モーダルを表示

### 体重 CSV エクスポート

- `/weights/export` から体重記録を CSV ダウンロード
- ハムスター指定、年月指定で絞り込み可能
- 既定ではデータ行の先頭へ、連携用識別列 `app_id`（`hamster-manager-browser`）、`record_type`（`weight_record`）、`schema_version`（`1`）、既存更新用の `record_id` を出力。閲覧用では4列をまとめて除外可能
- `date`（測定日）、`hamster`（ハムスター名）、`weight_g`（体重）、`created_at`（登録日時）、`updated_at`（更新日時）から出力列を選択可能（初期値は全列）
- 登録日時・更新日時は UTC（初期値）または JST（日本標準時・UTC+09:00）の ISO 8601 形式を選択可能
- 測定日は時刻を持たないためタイムゾーン変換せず、UTC／JSTを変更しても日付を維持
- 既存URLのように列・タイムゾーン指定がない場合は、互換性のため全データ列・UTCとして出力
- 旧 `/export` は `/weights/export` へリダイレクト
- 体重管理画面から CSV エクスポート画面へ移動可能

### 体重 CSV インポート

- `/weights/import` でアプリ版CSVの一括編集とGAS版からのデータ移行を選択
- `/weights/import/app`
  - このアプリが出力したCSV専用
  - `record_id` がある行は既存記録を更新し、空欄の行は新規登録
  - `date`、`hamster`、`weight_g` を一括編集可能。Excelの `YYYY/MM/DD` 形式も受け付ける
  - 出力元識別、スキーマバージョン、`record_id` のHousehold所属をサーバー側で検証
  - エラーが1件でもある場合は全件未反映。新規・更新とrevision更新は同一トランザクションで確定
  - CSVによる削除には対応しない
- `/weights/import/gas`
  - GAS 版で出力した体重管理 CSV を新規移行
  - 同じハムスター・同じ測定日の既存記録は更新せずスキップ
- UTF-8、ヘッダー行あり、カンマ区切り CSV に対応
- GAS版の必須列
  - `date`
  - `hamster`
  - `weight`
- 想定列
  - `id`
  - `date`
  - `hamster`
  - `weight`
  - `unit`
  - `create_date`
  - `update_date`
- `id` は GAS 側の管理 ID として扱い、アプリ側 DB の ID には使わない
- `hamster` は既存ハムスター名と照合
- 未登録のハムスター名、管理外ハムスター、日付不正、体重不正はエラーとして表示
- CSVは2MB・10,000行まで。体重は通常登録と同じく0より大きく500g以下、未来日は不可
- 取り込み後に新規登録件数、更新件数、スキップ件数、エラー件数、エラー詳細を表示
- 体重管理画面へ戻るボタンあり

### 設定

- ログイン中ユーザーの表示名を変更
  - 自動生成された個人用 Household 名にも反映
  - 表示名は 50 文字以内
- ダッシュボードの表示ボード数を設定
- 表示ボード数の上限は 30 件
- ダッシュボードに表示するハムスターを選択
- 表示対象ハムスターの検索に対応
- 検索はハムスター一覧と同様に、ひらがな / カタカナを相互に一致
- ハムスター選択方式を切り替え
  - コンボボックス式
  - プルダウン式（新規ユーザーの初期値）
- 表示・ダッシュボード設定と通知設定の間に、Household共有の「お世話日の設定」を独立表示
- お世話日の切り替え時刻は`type="time"`で分単位に設定し、OWNER / ADMINだけが変更可能
- MEMBER / VIEWERには現在値を表示するが、入力と保存は無効化
- 保存ボタンまでスクロールする固定ボタンあり
- 狭い画面でもメイン UI と固定ボタンが被りにくいように余白を調整

### お世話日の切り替え時刻

食事と水替えで使用する日付境界は、通常のJST 0:00固定ではなく、現在のHouseholdごとに設定できます。設定値はJSTの0:00からの経過分数として`households.care_day_start_minutes`へ保存し、範囲は0〜1439です。初期値は0で、既存Householdと公開デモは従来どおり0:00境界で動作します。個人設定の`app_settings`には保存しません。

例として切り替え時刻を8:00（480分）にした場合、2026-08-01のお世話日は2026-08-01 08:00 JSTから2026-08-02 07:59:59.999 JSTまでです。2026-08-02 07:59 JSTは2026-08-01、08:00 JSTは2026-08-02のお世話日として扱います。

お世話日は定期処理で状態をリセットせず、判定時点の現在時刻と最新の`careDayStartMinutes`から毎回算出します。`src/lib/care-day.ts`で、既定値、不正値の0時への正規化、`HH:mm`と分数の相互変換、JSTのお世話日文字列、`@db.Date`検索用のUTC 00:00 `Date`への変換を共通化しています。計算は「現在時刻をJSTへ移動し、切り替え時刻の分数を差し引いた後のUTC暦日」を使用するため、サーバーOSのローカルタイムゾーンには依存しません。

`src/lib/date.ts`の`todayInputJst()`は通常のカレンダー日付として意味を変更していません。未来日判定、年月表示、体重、衛生記録、誕生日、お迎え日、健康・通院・思い出などには、お世話日の切り替え時刻を適用しません。

適用範囲は次のとおりです。

- ダッシュボードの食事・水替えの検索対象日
- 食事・水替えを実施済みにしたときの`recordDate`
- 未実施・未交換へ戻すときの削除対象日
- 食事・水替えのHousehold Activityへ保存する`recordDate`
- 食事・水替え通知が未実施記録を確認する`CareNotificationDispatch.targetDate`

`fedAt`と`replacedAt`には操作した実時刻をそのまま保存し、切り替え時刻分をずらしません。ダッシュボードは1リクエスト内で1つの`now`と1つの`careDayStartMinutes`から共通の対象日を算出し、表示対象ハムスターIDを指定して食事・水替えをそれぞれ一括取得します。ハムスターごとのN+1 queryは行いません。

設定画面では「切り替え時刻：08:00」のように現在値を閉じた状態でも確認できます。保存権限はHouseholdのOWNER / ADMINだけです。Server ActionはHousehold単位のtransaction lockを取得し、保存直前に現在の所属・権限・デモHouseholdでないこと・最新設定値を再確認します。変更時はHousehold更新、未完了通知dispatchの無効化、realtime revision更新を同じtransactionで確定し、commit後に既存の安全なpublishとダッシュボード・設定画面のrevalidateを実行します。

設定は保存完了後から即時反映します。現在時刻と変更前後の境界によっては、ダッシュボードの食事・水替えが実施済みから未実施、または未実施から実施済みに変わります。既存の`feeding_records`と`water_replacement_records`の`record_date`は更新・再分類しません。適用予定日時、過去データ再分類バッチ、次回境界からの予約適用も持ちません。

切り替え時刻を変更した場合、そのHouseholdの`CLAIMED`または`RETRYABLE`状態の通知dispatchは同じtransactionで`SKIPPED`へ変更します。`SENT`履歴は変更しません。通知送信処理側でも、送信直前に最新の所属、ユーザー利用状態、デモ判定、通知設定、`careDayStartMinutes`、対象お世話日、食事・水替え記録を再取得し、dispatchの`targetDate`が最新のお世話日と一致しなければ送信せず`SKIPPED`にします。期限切れ候補と再試行候補も全Household共通の日付ではなく、各dispatchに関連するHouseholdの最新境界で検証します。

DB列はmigration `20260801150000_add_care_day_start_minutes`で追加します。既存行には0が設定され、DBにも`BETWEEN 0 AND 1439`のCHECK制約があります。反映後はOWNER / ADMIN、MEMBER / VIEWER、0時・8時境界、月末・年末・うるう年、食事・水替え・Activityの対象日、異なる境界を持つ複数Householdの通知、古いdispatchのskipを確認してください。自動検証には`tests/care-day.test.ts`、`tests/care-day-settings.test.ts`、`tests/feeding.test.tsx`、`tests/water-replacement.test.tsx`、`tests/care-notifications.test.ts`が含まれます。

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

## 画面構成

- `/`
  - ダッシュボード
- `/login`
  - Google ログイン
- `/hamsters`
  - ハムスター管理
- `/records`
  - 健康・通院・思い出の登録と共通タイムライン
- `/cleaning`
  - 衛生管理
- `/weights`
  - 体重管理
- `/weights/export`
  - 体重 CSV エクスポート
- `/weights/import`
  - 体重 CSV インポート
- `/export`
  - `/weights/export` へリダイレクト
- `/settings`
  - 設定
- `/settings/members`
  - 共有・メンバー管理、招待リンク作成、メンバー参加解除
- `/invitations/accept`
  - 招待リンク承認
- `/admin`
  - アプリ全体管理者向けのユーザー、共有、招待状態確認

## DB 設計

### `hamsters`

- `id`
- `householdId`
- `name`
- `memo`
- `profileImageFileName`
- `birthDate`
- `adoptionDate`
- `isActive`
- `createdAt`
- `updatedAt`

`householdId` は所属 Household です。ログイン中ユーザーが所属していない Household のハムスターは参照・編集できません。

`name` は Household 内でユニークです。別 Household であれば同じ名前のハムスターを登録できます。

`isActive` は管理状態です。`false` のハムスターは管理外として扱い、プロフィール編集、衛生記録、体重記録をロックします。ハムスター自体の削除と、管理中への復活は可能です。

### `cleaning_records`

- `id`
- `hamsterId`
- `recordDate`
- `toiletCleaned`
- `bathCleaned`
- `flooringPartCleaned`
- `flooringAllCleaned`
- `houseCleaned`
- `memo`
- `createdAt`
- `updatedAt`

`hamsterId` と `recordDate` の組み合わせはユニークです。衛生管理表は、ハムスターごとに 1 日 1 行として保存します。

### `feeding_records` / `water_replacement_records`

- 共通: `id`、`hamsterId`、`recordDate`、`createdByUserId`、`createdAt`、`updatedAt`
- `feeding_records`: `fedAt`
- `water_replacement_records`: `replacedAt`

どちらも `hamsterId` と `recordDate` の組み合わせはユニークです。ダッシュボードで未実施へ戻した場合は当日レコードを削除し、JSTの日付が変わると新しい日の未実施状態になります。ハムスター削除時はCascade、操作者削除時は参照だけをSetNullにします。

### `weight_records`

- `id`
- `hamsterId`
- `recordDate`
- `weightG`
- `createdAt`
- `updatedAt`

`hamsterId` と `recordDate` の組み合わせはユニークです。体重履歴は、ハムスターごとに 1 日 1 件として保存します。

### `hamster_records` / 種類別詳細 / `memory_record_hamsters` / `memory_record_images`

- `hamster_records`: `hamsterId`、`recordType`、`recordDate`、健康記録だけが使用する任意の `recordTimeMinutes`、`title`、`memo`、`searchText`、`createdByUserId`、作成・更新日時を持つ共通タイムライン親
- `health_record_details`: 総合状態、食欲、活動量、便、尿、複数症状
- `medical_visit_details`: 病院名、理由、診断、検査、治療、薬、投薬方法、次回予定日、診察費
- `memory_record_details`: 大文字小文字を保持する表示用の自由タグ、大文字小文字・全角半角を吸収する検索専用タグ、お気に入り
- `memory_record_hamsters`: 思い出と対象ハムスターの中間テーブル。`hamster_record_id`と`hamster_id`の複合主キー、表示順を保持する`sort_order`、個別タイムライン検索用の`hamster_id`インデックスを持つ
- `memory_record_images`: 思い出画像のサーバー生成ファイル名と表示順。初回実装は1記録1枚だが、別テーブルのため複数画像へ拡張可能
- `saved_memory_tags`: Household内で再利用する思い出タグ。全角英数字・記号等を半角へ正規化した名前で重複を防止し、大文字小文字は区別

思い出でも `hamster_records.hamster_id` は代表ハムスターとして残し、`memory_record_hamsters`の対象一覧に同じIDを必ず含めます。対象関連は思い出詳細またはハムスターの削除時にCascadeで整理し、同じ思い出・ハムスターの重複行は複合主キーで防止します。親記録と詳細・画像メタデータもCascadeで削除します。`searchText` は入力項目から生成した検索専用テキストで、PostgreSQL `pg_trgm` のGINインデックスを使用します。別HouseholdのハムスターIDを指定した取得・更新はサーバー側の所属条件で拒否します。

Migration `20260802120000_add_memory_record_hamsters` は中間テーブル、複合主キー、外部キー、検索用インデックスを作成し、既存の全思い出について当時の `hamster_records.hamster_id` を `sort_order = 0` の対象としてバックフィルします。`ON CONFLICT DO NOTHING`で重複を避け、バックフィル後に対象が0匹の既存思い出があればmigrationを失敗させます。既存の思い出本体・画像は削除または複製しません。

### `app_settings`

- `id`
- `userId`
- `householdId`
- `dashboardBoardCount`
- `hamsterSelectorMode`
- `createdAt`
- `updatedAt`

設定は `userId` と `householdId` の組み合わせで 1 レコードです。同じ Household を共有していても、ダッシュボード表示数、ハムスター選択方式、表示対象ハムスターはユーザーごとに保存します。

`dashboardBoardCount` はダッシュボードの表示ボード数です。

`hamsterSelectorMode` は、ハムスター選択 UI をコンボボックス式にするか、プルダウン式にするかを保存します。新規ユーザーの初期値はプルダウン式です。

### `dashboard_hamsters`

- `id`
- `settingId`
- `hamsterId`
- `sortOrder`
- `createdAt`
- `updatedAt`

ダッシュボードの表示対象ハムスターと表示順を保存します。

### `users` / `accounts` / `sessions` / `verification_tokens`

Auth.js / NextAuth の Prisma Adapter が使用する認証テーブルです。Google OAuth のユーザー、アカウント連携、DB セッションを PostgreSQL に保存します。

`users.appRole` はアプリ全体権限です。`USER`、`ADMIN`、`SUPER_ADMIN` を持ちます。共有単位の `OWNER` / `ADMIN` / `MEMBER` / `VIEWER` とは別の権限です。

`users.accessStatus` はアプリの利用状態で、`ACTIVE` / `SUSPENDED` を持ちます。停止中は停止日時・実行者・内部向け理由を現在状態として保持し、既存Sessionをすべて削除します。停止・解除は `user_access_actions` に別途保存するため、解除時に現在の停止情報をクリアしても操作履歴は残ります。履歴のユーザー参照はアカウント削除時に `SetNull` となり、操作時のID・表示名snapshotを維持します。

Auth.js のGoogleログイン callbackは既存のGoogleアカウントIDとメールを照合して停止中ユーザーのログインを拒否し、同じGoogleアカウントから別ユーザーとして再作成されることを防ぎます。DB Session取得時と共通認証コンテキストでも利用状態を確認します。ユーザー向けには一般化した停止案内だけを表示し、内部向け理由は表示しません。

### アカウント削除

`/settings` の「アカウントの削除」から「削除内容を確認する」で `/settings/account/delete` へ進むと、処理件数の要約と所属グループごとの扱いを確認して自分のアカウントを削除できます。メンバー1人・対象ユーザーがOWNER・OWNER数1人のグループはHouseholdのCascadeで全データを削除し、DB commit後にハムスター画像と思い出画像のHouseholdディレクトリを削除します。ほかのメンバーがいるグループは共有データを残して本人のmembershipと個人設定だけを削除し、本人が唯一OWNERの場合は同じグループの別メンバーを移譲先として明示選択する必要があります。

削除処理はユーザー単位lockの後、Household ID順にHousehold単位lockを取得し、画面表示後の状態変更と移譲先所属をDBで再確認します。全グループの処理とUser削除は1 transactionで行い、`Account`、`Session`、`HouseholdMember`、`AppSetting`、`DashboardHamster`はCascadeで削除します。共有グループ内の記録・招待・保存タグは残し、削除ユーザーの作成者参照は既存の`SetNull`に従います。最後の`SUPER_ADMIN`は削除できません。成功後はHousehold CookieとAuth.js Session Cookieを削除してログイン画面へ移動し、`account_deleted`監査ログを記録します。

### `households`

- `id`
- `name`
- `careDayStartMinutes`（DB列: `care_day_start_minutes`、0〜1439、初期値0）
- `createdAt`
- `updatedAt`
- `realtimeRevision`
- `realtimeActorClientId`
- `realtimeActorUserId`

共有の単位です。新規ログインユーザーに Household がない場合は、`{ユーザー名}のハムスター管理` という個人用 Household を自動作成します。初回表示の並行処理で同じ個人用 Household が二重作成されないよう、ユーザー単位で作成処理を直列化します。

`realtimeRevision` は Household 単位の更新ごとに増える revision です。ポーリング時も更新元を正しく判定できるよう、最新更新の `realtimeActorClientId` と `realtimeActorUserId` も同じ行に保存します。

`careDayStartMinutes`は食事と水替えに適用するJSTのお世話日境界です。Household全体へ即時反映され、個人用の`app_settings`とは分離されています。

### `household_members`

- `id`
- `householdId`
- `userId`
- `role`
- `createdAt`
- `updatedAt`

ユーザーと Household の参加関係です。`role` は `OWNER`、`ADMIN`、`MEMBER`、`VIEWER` です。招待参加時は従来どおり `MEMBER` で作成し、必要な場合だけ参加後に OWNER が `VIEWER` へ変更します。

### `household_activities`

- `HouseholdActivityEvent` と `HouseholdActivityCategory` による型安全なイベント・カテゴリー
- `actorNameSnapshot` / `targetNameSnapshot` で、ユーザー名変更やユーザー・ハムスター削除後も当時の表示名を保持
- `details` は日付、体重、件数、権限変更前後など表示に必要な最小限だけをJSON保存
- `(householdId, createdAt, id)` と `(householdId, category, createdAt, id)` の索引で安定順ページングとカテゴリー絞り込みを支援
- Household参照は `onDelete: Cascade`、User参照は `onDelete: SetNull`

### `household_invitations`

- `id`
- `householdId`
- `tokenHash`
- `expiresAt`
- `acceptedAt`
- `createdAt`

招待リンクの管理テーブルです。招待トークンは作成直後のAction stateと受諾画面のメモリ内でのみ平文として扱い、DB には SHA-256 ハッシュを保存します。共有URLではトークンを `#token=...` のフラグメントへ格納するため、HTTPリクエストやアクセスログのクエリには含まれません。未ログイン時はGoogle OAuthの往復中だけ同じタブの `sessionStorage` に保持し、ログイン後に読み出して削除します。

## 環境変数ファイル

実際に使う `.env` 系ファイルは Git 管理しません。用途に応じて example ファイルをコピーして作成します。

```text
.env.example
.env.development.example
.env.production.example
```

Docker Compose は `ENV_FILE` で読み込む env ファイルを切り替えられます。指定しない場合は `.env` を読み込みます。

```bash
ENV_FILE=.env.development docker compose up -d
ENV_FILE=.env.production docker compose up -d
```

PowerShell の場合:

```powershell
$env:ENV_FILE=".env.development"
docker compose up -d
```

`$env:ENV_FILE` は PowerShell の現在のセッションだけに効きます。毎回指定したくない場合は、開発 PC では `.env.development.example` を `.env` にコピーして使うのが簡単です。

```powershell
Copy-Item .env.development.example .env
```

VPS 本番では `.env.production.example` を `.env` にコピーして、本番用の強いパスワードへ変更する運用でも構いません。

```bash
cp .env.production.example .env
```

## env の値の考え方

Docker Compose 内で Next.js コンテナから PostgreSQL コンテナへ接続する場合、`DATABASE_URL` のホスト名は `db` です。

```env
DATABASE_URL="postgresql://dog_cat_user:dev_password@db:5432/dog_cat_manager_dev?schema=public"

POSTGRES_DB="dog_cat_manager_dev"
POSTGRES_USER="dog_cat_user"
POSTGRES_PASSWORD="dev_password"
```

対応関係:

```text
DATABASE_URL のユーザー名 = POSTGRES_USER
DATABASE_URL のパスワード = POSTGRES_PASSWORD
DATABASE_URL のDB名       = POSTGRES_DB
DATABASE_URL のホスト     = db
DATABASE_URL のポート     = 5432
```

ホスト PC 上で `npm run dev` を実行し、DB だけ Docker Compose で動かす場合は、`DATABASE_URL` のホストを `localhost`、ポートを `5433` にします。`docker-compose.yml` では PostgreSQL を `127.0.0.1:5433` に公開しています。

```env
DATABASE_URL="postgresql://dog_cat_user:dev_password@localhost:5434/dog_cat_manager_dev?schema=public"

POSTGRES_DB="dog_cat_manager_dev"
POSTGRES_USER="dog_cat_user"
POSTGRES_PASSWORD="dev_password"
```

Auth.js / Google OAuth 用の環境変数も設定します。秘密情報は `.env.example` では空欄のままにし、実際の `.env` 系ファイルだけに値を入れます。`AUTH_URL` は秘密情報ではないため、example ファイルには用途ごとの例を記載しています。

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

HOUSEHOLD_ACTIVITY_RETENTION_DAYS=90

HAMSTER_IMAGE_DIR=/app/uploads/hamsters
RECORD_IMAGE_DIR=/app/uploads/records
```

`HAMSTER_IMAGE_DIR` は変換済みプロフィール画像の保存ルートです。Docker Composeでは `/app/uploads/hamsters` を使用します。ホストPCで直接 `npm run dev` を実行する場合は `HAMSTER_IMAGE_DIR=./uploads/hamsters` に変更できます。DBには絶対パスや画像本体ではなく、サーバー生成のUUID形式ファイル名だけを保存します。

`RECORD_IMAGE_DIR` は変換済み思い出画像の保存ルートです。Docker Composeの既存 `./uploads:/app/uploads` バインドマウント内に `/app/uploads/records` として保存します。ホストPCで直接起動する場合は `RECORD_IMAGE_DIR=./uploads/records` に変更できます。DBには画像本体や絶対パスを保存しません。

`AUTH_SECRET` は 32 文字以上の十分にランダムな文字列にしてください。Auth.js v5 では `AUTH_URL` は多くの場合リクエストヘッダーから推定されますが、このアプリでは OAuth の戻り先と招待URLの生成元を固定するため、開発・本番とも実際にブラウザから開くURLを明示します。旧 NextAuth の `NEXTAUTH_URL` ではなく、現行の Auth.js 仕様に合わせて `AUTH_URL` を使います。

Google Cloud Console の OAuth クライアントには、利用するURLごとに承認済みリダイレクト URI を登録します。

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3002/api/auth/callback/google
https://your-domain.example/api/auth/callback/google
```

ホスト PC の `npm run dev` は通常 `http://localhost:3000`、Dog & Cat Manager の Docker Compose はホスト側 `http://localhost:3002` です。本番では実際の HTTPS ドメインを登録してください。同じGoogle OAuth ClientをHamster Managerと共有する開発環境では、Hamster側の `http://localhost:3001/api/auth/callback/google` も削除せず、両方のURIを登録します。

## ローカル開発

Windows の PowerShell 例です。

### 1. 依存関係をインストール

```powershell
npm install
```

### 2. 開発用 `.env` を作成

ホスト PC で `npm run dev` する場合:

```powershell
Copy-Item .env.development.example .env
```

その後、`.env` の `DATABASE_URL` を `localhost:5434` に変更します。

```env
DATABASE_URL="postgresql://dog_cat_user:dev_password@localhost:5434/dog_cat_manager_dev?schema=public"
```

Google ログインを使うため、同じ `.env` に `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、必要に応じて `AUTH_URL` を設定します。ホスト PC で `npm run dev` する場合の `AUTH_URL` 例は次の通りです。

```env
AUTH_URL="http://localhost:3000"
```

### 3. PostgreSQL コンテナだけ起動

```powershell
docker compose up -d db
```

### 4. Prisma migrate を実行

開発中は `migrate dev` を使います。

```powershell
npx prisma migrate dev
```

サンプルデータを入れる場合:

```powershell
npx prisma db seed
```

管理画面のページング確認用に、既存データを削除せずユーザー・共有を25件ずつ追加する場合:

```powershell
npm run seed:admin-pagination
```

このseedは再実行可能です。各共有にメンバーとハムスターを1件、奇数番の共有には有効な招待、偶数番のユーザーにはセッションを作成します。

### 5. Next.js を起動

```powershell
npm run dev
```

ブラウザで開きます。

```text
http://localhost:3000
```

## Docker Compose で app と db をまとめて起動

Docker コンテナだけで動作確認したい場合の手順です。この場合、`DATABASE_URL` のホストは `db:5432` のままで使います。

```powershell
Copy-Item .env.development.example .env
docker compose build
docker compose up -d
docker compose exec app npx prisma db seed
docker compose logs -f app
```

app コンテナは起動時に `prisma migrate deploy` を実行し、成功してから Next.js を起動します。未適用 migration がある状態で新しい app だけが起動し、DB 列不足で画面が壊れることを防ぎます。

Docker Compose でブラウザから `http://localhost:3002` を開く場合は、`.env` の `AUTH_URL` も必要に応じて次の値にします。

```env
AUTH_URL="http://localhost:3002"
```

ブラウザで開きます。

```text
http://localhost:3002
```

app のホスト側ポートは `127.0.0.1` のみに公開します。そのため、このPC自身のブラウザからはアクセスできますが、同じLANのスマートフォンや別PCから `PCのIPアドレス:3002` へ直接アクセスすることはできません。スマートフォン実機確認が必要な場合は、信頼できる開発ネットワーク内に限って開発用Compose設定で一時的に公開し、確認後はループバック限定へ戻してください。

ポートは次の対応です。

```text
Next.js ホスト側:     127.0.0.1:3002
Next.js コンテナ側:   3000
PostgreSQL ホスト側:  127.0.0.1:5433
PostgreSQL コンテナ側: 5432
```

PostgreSQL は Docker volume に永続化されます。

```text
dog_cat_manager_pgdata
```

通常の停止では DB データは消えません。

プロフィール画像と思い出画像は `./uploads:/app/uploads` のバインドマウントへ保存されます。`docker compose down`、再ビルド、再作成後もホスト側の `uploads` を削除しない限り残ります。`uploads` は `.dockerignore` に含め、既存画像をDockerビルドコンテキストへ送信しません。

```powershell
docker compose down
```

DB データも削除したい場合だけ `-v` を付けます。開発 DB を初期化したい時以外は使わないでください。

```powershell
docker compose down -v
```

## サーバーログ

想定外例外やリアルタイム通知失敗など、開発者が原因調査に必要とするサーバーログを JSON Lines 形式で記録します。利用者の画面に表示された `errorId` は、Dockerログとファイルログの両方に同じ値で記録されます。

出力先は次の2か所です。

- Docker標準出力・標準エラー: `debug` / `info` は標準出力、`warn` / `error` は標準エラー
- ログファイル: VPS側 `./logs`、コンテナ側 `/app/logs`

Docker Composeでは次のバインドマウントを使用します。

```text
./logs:/app/logs
```

ログファイル名は `application-YYYY-MM-DD.log` です。同じ日に最大サイズへ達した場合は連番ファイルへローテーションします。デフォルトは1ファイル20MB、保存期間14日で、コンテナ再起動・再作成・`docker compose down` 後もVPS側のファイルは残ります。

設定可能な環境変数:

```env
LOG_LEVEL=info
LOG_DIR=/app/logs
LOG_RETENTION_DAYS=14
LOG_MAX_FILE_SIZE_MB=20
```

- 開発環境の `LOG_LEVEL` 推奨値は `debug`、本番環境は `info`
- `LOG_DIR` のDocker向け既定値は `/app/logs`
- 保存日数と最大サイズが不正な場合は、安全な既定値へ戻して警告を標準エラーへ出力
- ホストPCで直接 `npm run dev` する場合は、必要に応じて `LOG_DIR=./logs` を指定

### ログディレクトリの作成と権限

Windows開発環境:

```powershell
New-Item -ItemType Directory -Force logs
```

VPSではappコンテナの非rootユーザー（UID/GID 1001）が書き込めるよう、初回起動前に次を実行します。

```bash
mkdir -p logs
sudo chown 1001:1001 logs
chmod 750 logs
```

`chmod 777`は使用しません。ディレクトリが存在しない場合はDocker Composeが作成することがありますが、root所有になってファイル出力できない可能性があるため、VPSでは事前作成を推奨します。権限不備やファイル出力障害があってもアプリは停止せず、ファイルtransportを無効化して標準エラーへ警告します。

### Docker標準出力の確認

```bash
docker compose logs app
docker compose logs -f app
docker compose logs --tail=100 app
```

### VPS上のログファイル確認

```bash
ls -lh logs
tail -n 100 logs/application-$(date +%Y-%m-%d).log
```

### コンテナ内からの確認

```bash
docker compose exec app sh -lc 'ls -lh /app/logs'
docker compose exec app sh -lc 'tail -n 100 /app/logs/application-$(date +%Y-%m-%d).log'
```

### errorIdによる検索

```bash
grep "対象のerrorId" logs/*.log
grep "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" logs/*.log
```

`jq`が利用できる場合:

```bash
grep "対象のerrorId" logs/*.log | jq
```

ログ動作の確認用CLIは、意図的なテスト例外を1件だけ記録し、マスキングと二重出力を確認します。

```bash
docker compose exec app npm run log:smoke
```

ログには内部IDだけを限定的に記録し、氏名、メールアドレス、Cookie、セッション、Authorizationヘッダー、OAuthトークン、招待トークン、APIキー、DBパスワード、環境変数、CSV本文、フォーム全体は記録しません。ログファイルは `.gitignore` の `logs/` と `*.log` によりGit管理対象外です。

### 開発環境の自動起動スクリプト

Windows 開発環境では、開発用の Docker Compose 起動フローをまとめたスクリプトを使えます。

基本的には `start-dev.bat` から起動する想定です。

```bat
start-dev.bat
```

`start-dev.bat` は文字コードを UTF-8 に切り替えたうえで、同じフォルダにある `start-dev.ps1` を PowerShell で実行します。

```bat
powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
```

主な指定の意味:

- `-ExecutionPolicy Bypass`: `.ps1` や `npm.ps1` などが実行ポリシーでブロックされる環境向けに、この起動中だけ制限を回避します。
- `-File`: 実行する PowerShell スクリプトファイルを指定します。
- `%~dp0start-dev.ps1`: `.bat` と同じフォルダにある `start-dev.ps1` を指定します。
- `-NoExit`: 実行後も PowerShell ウィンドウを閉じず、エラー内容を確認しやすくします。

`-ExecutionPolicy Bypass` はスクリプト実行制限への対策です。Docker Desktop が未インストール、`.env.development` が存在しない、ポートが使用中、`docker-compose.yml` が不正といったエラーを回避するものではありません。自分で管理している開発用スクリプトに対して使ってください。

PowerShell から直接起動したい場合:

```powershell
.\start-dev.ps1
```

`start-dev.ps1` は次の処理をまとめて行います。

- スクリプトがあるリポジトリルートへ移動
- Docker Desktop を起動
- Docker が利用可能になるまで待機
- `ENV_FILE` に `.env.development` を設定
- `docker compose up -d app` で app と依存するコンテナを起動
- `http://localhost:3002` をブラウザで開く

初回起動前に `.env.development.example` をコピーして `.env.development` を作成してください。Prisma migrate や seed は自動実行しないため、初回セットアップ時やスキーマ変更時は必要に応じて別途実行します。

## Prisma コマンド

`package.json` には次のスクリプトがあります。

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run migrate:assign-owner -- --email example@gmail.com
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:generate
npm run prisma:seed
```

使い分け:

```text
開発中のスキーマ変更: npm run prisma:migrate
本番反映:             npm run prisma:deploy
Prisma Client生成:    npm run prisma:generate
seed投入:             npm run prisma:seed
既存データ割り当て:    npm run migrate:assign-owner -- --email example@gmail.com
```

Docker Compose 上で実行する例:

```bash
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed
```

## 匿名サンプル閲覧モード

Googleログインなしで、架空のサンプルデータだけを読み取り専用で確認できます。

デモHouseholdには9体（管理中6体・管理外3体）のハムスターを用意しています。個体ごとに異なる体重推移、衛生管理、健康・通院・思い出記録に加え、複数ハムスターを対象にした共有思い出を1件用意しています。一覧の検索・並び替え・状態絞り込み、各画面のハムスター切り替え、共有思い出が各対象の個別タイムラインとグループ全体へ重複なく表示されることを確認できます。

- `/demo`: ダッシュボード
- `/demo/hamsters`: ハムスター一覧、新規登録UI、各プロフィールの画像登録・変更・削除UIプレビュー
- `/demo/records`: 健康・通院・思い出記録とタブ切り替え可能な登録UIプレビュー
- `/demo/cleaning`: 衛生管理
- `/demo/weights`: 体重登録UIプレビュー・グラフ・履歴

登録UIプレビューは通常利用時の入力項目を紹介するための表示です。思い出の対象ハムスターは通常画面と同じ `MemoryHamsterSelector` を読み取り専用で使用し、選択要約と折りたたみの見た目を共通化しています。ハムスター一覧では、各デモ用静的画像とともに、対応形式・容量、ファイル選択、登録済み画像の削除、保存の流れを操作不可で確認できます。タブ切り替え、対象要約の開閉、画像の拡大などの閲覧操作を除き、入力欄、画像選択、削除、登録・保存ボタンは無効化されています。デモ画面およびプレビューは更新用Server Actionや更新APIを参照しないため、匿名状態からデータを変更することはできません。CSV入出力、設定・共有・管理・問い合わせ・アカウント操作は表示せず、通常画面と既存の更新Action/APIは引き続きGoogleログインとHousehold権限を必要とします。

### デモデータの投入・更新

デモ専用seedは、通常の`prisma db seed`とは独立しています。

```bash
npm run seed:demo
```

`Household.isDemo = true`かつ固定`demoSlug = "public-sample"`のHouseholdだけをtransaction内で再構築します。固定IDを持つ9体のハムスターと関連記録を同じ順序で再作成し、名称だけで対象を選びません。通常Household、User、Account、Session、HouseholdMemberには触れず、同じコマンドを複数回実行してもデモデータは重複しません。日付は実行時のJST暦日を基準に生成されるため、再実行すると最近のサンプル記録へ更新されます。

デモ用プロフィール・記録画像はアップロード領域を使わず、次に配置します。

```text
public/demo/hamsters/
public/demo/records/
```

画像を更新する場合は、`src/lib/public-demo.ts`の固定IDと静的パスの対応を維持しながら、上記ファイルを差し替えて再ビルドしてください。画像の差し替えだけならseedの再実行は不要です。

### Docker Compose本番環境への反映

現在のDockerfileはappコンテナ起動時に`npx prisma migrate deploy`を実行し、`prisma/`、`package.json`、`node_modules`、`public/`、seedが参照する`src/lib/`をrunnerへコピーします。そのため、既存DBと通常利用データを保持したまま次の順で反映できます。

```bash
git pull
docker compose build
docker compose up -d --wait --wait-timeout 120
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run seed:demo
docker compose logs --tail=100 app
```

`docker compose up`時にもmigrationは適用されますが、上の明示コマンドは適用済み確認として安全に再実行できます。Docker外で実行する場合は、`DATABASE_URL`が実際のPostgreSQLへ到達できる環境で次を実行します。

```bash
npx prisma migrate deploy
npm run seed:demo
```

デモHouseholdが未投入または見つからない場合、匿名画面は通常Householdへフォールバックせず「現在、サンプルデータを準備中です。」と表示します。

開発中に DB コンテナだけ起動してホスト側から実行する場合:

```bash
npx prisma migrate dev
npx prisma db seed
```

## 継続的インテグレーション（GitHub Actions）

`.github/workflows/ci.yml` は、`main` 向けPull Request、`main` へのpush、手動実行で、Prisma Client生成、スキーマ検証、空のPostgreSQL 16への既存migration適用、ESLint、TypeScript型チェック、自動テスト、Next.js本番ビルドを順に実行します。CIでは固定のダミー認証情報と一時ディレクトリを使用し、本番のSecretsや外部OAuth接続は必要ありません。

ローカルで同等の検証を行う場合は、検証用PostgreSQLへ `DATABASE_URL` を設定して次を実行します。

```bash
npm ci
npm run prisma:generate
npx prisma validate
npm run prisma:deploy
npm run lint
npm run typecheck
npm run test
npm run build
```

CIが失敗した場合は、GitHub Actionsの `Quality, Tests, Build & Migrations` ジョブで最初に失敗したstepを確認し、同じコマンドをローカルで再実行してください。migrationの失敗時は、空のPostgreSQL 16へ全migrationを順に適用できるかも確認します。

## アプリとして追加する

本番環境のアプリへ HTTPS でアクセスし、Google ログインを完了してから、利用する端末で次の操作を行います。ブラウザやOSのバージョンによってメニュー名が多少異なる場合があります。

### Android

1. Chromeでアプリを開きます。
2. 右上のメニューから「ホーム画面に追加」または「アプリをインストール」を選びます。
3. 表示名を確認して追加します。

### iPhone / iPad

1. Safariでアプリを開きます。
2. 共有ボタンを押し、「ホーム画面に追加」を選びます。
3. 表示名を確認して「追加」を押します。

### PC

1. ChromeまたはMicrosoft Edgeでアプリを開きます。
2. アドレスバーのインストールアイコン、またはブラウザのメニューにある「アプリをインストール」を選びます。
3. 確認画面でインストールを実行します。

追加後は独立したアプリウィンドウまたはホーム画面のアイコンから起動できます。今回はService Workerとオフラインキャッシュを実装していないため、起動と利用にはネットワーク接続が必要です。オフライン編集とプッシュ通知にも対応していません。

## 初回ログインと共有

初回 Google ログイン時に、そのユーザーがどの Household にも所属していなければ個人用 Household を自動作成します。以降のハムスター登録、衛生記録、体重記録は現在の Household に紐づきます。

複数の Household に所属している場合は、ヘッダーの「操作対象」で現在の Household を切り替えます。選択結果はDog-Cat専用の `dog_cat_manager_current_household` cookie に保存します。cookie がない場合は、招待参加した共有中 Household を優先し、それもなければ最初の membership を操作対象にします。Hamster ManagerのHousehold選択cookieは読み取り・書き込み・削除の対象にしません。

共有メンバーを招待する手順:

1. OWNER または ADMIN のユーザーでログインします。
2. `/settings/members` を開きます。
3. 「招待リンクを作成」を押します。
4. 表示されたリンクを招待相手へ共有します。
5. 招待相手がリンクを開き、Google ログイン後に「この共有に参加する」を押すと MEMBER として参加します。

招待リンクは作成から 7 日間有効です。一度承認されたリンクは再利用できません。メール送信は行わず、画面に表示されたリンクを手動で共有します。

### 招待データの定期整理

使用済みの招待は受諾から90日後、未使用の期限切れ招待は期限から30日後に削除します。有効な招待は削除しません。手動実行は次のコマンドです。

```powershell
docker compose exec -T app npm run invitations:cleanup
```

正常終了時は削除件数を標準出力とアプリケーションログへ記録します。失敗時は `errorId` 付きでログへ記録し、コマンドを失敗終了します。

削除せず対象件数だけ確認する場合は、先に次を実行します。

```powershell
docker compose exec -T app npm run invitations:cleanup -- --dry-run
```

VPSでは、リポジトリの実際の配置先へ読み替えたうえで、`crontab -e` に次のような日次実行を登録します。時刻はVPSのタイムゾーン基準です。

```cron
0 3 * * * cd /home/USER/apps/hamster-manager-browser && /usr/bin/docker compose exec -T app npm run invitations:cleanup
```

登録後は次で内容を確認できます。

```bash
crontab -l
```

クリーンアップはアプリコンテナが起動している場合に実行できます。cron登録前に、まず `--dry-run` で対象件数とログを確認してください。

### 対応済み問い合わせの自動終了

`RESOLVED`になった問い合わせは、最後の`resolvedAt`から7日間、利用者の追加返信がなければ`CLOSED`へ自動終了します。利用者が期間内に返信すると既存の状態遷移で`IN_PROGRESS`へ戻り、`resolvedAt`はnullになります。その後に管理者が再度`RESOLVED`へ変更した場合は、新しい`resolvedAt`から7日間を数え直します。判定に`createdAt`や`updatedAt`は使用せず、`RESOLVED`でも`resolvedAt`がnullのデータは自動終了しません。

手動実行:

```powershell
docker compose exec -T app npm run contact-inquiries:auto-close
```

DBを変更せず対象件数だけ確認する場合:

```powershell
docker compose exec -T app npm run contact-inquiries:auto-close -- --dry-run
```

通常実行では対象件数と実際の終了件数を標準出力・アプリケーションログへ記録します。対象取得後に利用者返信や管理者更新が競合しても、更新時に`status = RESOLVED`と`resolvedAt`の閾値を再確認するため、状態が変わった問い合わせは終了しません。自動終了時は問い合わせのrealtime revisionを増分しますが、利用者・管理者の操作として記録しないようactor列はnullにします。

この実装をデプロイしただけでは定期実行されません。7日単位の判定なので、VPSの`crontab -e`へ1日1回の実行を登録します。次は毎日3時30分に実行する例です。時刻はVPSのタイムゾーン基準で、アプリ仕様として固定ではありません。

```cron
30 3 * * * cd /home/USER/apps/hamster-manager-browser && /usr/bin/docker compose exec -T app npm run contact-inquiries:auto-close
```

配置先とDockerコマンドの絶対パスを実環境へ読み替え、登録前に`--dry-run`でDB接続、対象件数、ログを確認してください。

### 共有グループ操作履歴の定期整理

`HouseholdActivity` の初期保持期間は90日です。保持日数は `.env` の次の環境変数を正の整数へ変更するだけで調整できます。未設定、空文字、0、負数、小数、数値以外の場合、クリーンアップはエラー内容と `errorId` をサーバーログ・標準エラーへ出力して異常終了し、暗黙的な90日への置き換えは行いません。この検証はクリーンアップ実行時だけ行うため、値が不正でもアプリケーション本体の起動には影響しません。

```env
HOUSEHOLD_ACTIVITY_RETENTION_DAYS=90
```

Docker Composeの `env_file` はコンテナ作成時に反映されます。`.env` を変更した後は、次のようにappコンテナを再作成してからクリーンアップを実行してください。

```bash
docker compose up -d --force-recreate app
```

通常実行では対象件数を確認してから、実行時刻から保持日数を引いた基準日時より古い全Householdの履歴を削除します。`createdAt` が基準日時と完全に一致する履歴は削除しません。対象件数、実削除件数、保持日数、基準日時は標準出力とサーバーログへ記録します。この内部保守処理自体は操作履歴へ追加せず、Household revisionの更新やSSE通知も行いません。

```bash
docker compose exec -T app npm run household-activities:cleanup
```

DBを変更せず対象件数だけ確認する場合:

```bash
docker compose exec -T app npm run household-activities:cleanup -- --dry-run
```

この実装をデプロイしただけでは定期実行されません。本番VPSで `crontab -e` を開き、リポジトリの配置先とDockerコマンドのパスを実環境へ読み替えて、毎日深夜0時に1回実行するcronを登録してください。

```cron
0 0 * * * cd /home/USER/apps/hamster-manager-browser && /usr/bin/docker compose exec -T app npm run household-activities:cleanup
```

cronには対話用TTYを割り当てない `-T` が必要です。またcronの `PATH` はログインシェルより狭いため、`command -v docker` で確認した `/usr/bin/docker` などの絶対パスを使うことを推奨します。Compose v1を使用する環境では、同様に確認した `/usr/local/bin/docker-compose` などの絶対パスで `docker-compose exec -T` を指定してください。登録後は `crontab -l` で確認し、最初に `--dry-run` を手動実行して環境変数、対象件数、ログを確認してください。

OWNER は `/settings/members` から VIEWER / MEMBER / ADMIN の権限を切り替えられます。ADMIN は招待リンク作成と VIEWER / MEMBER の共有参加解除ができます。OWNER は自分自身と最後の OWNER を除き、共有メンバーの参加を解除できます。VIEWER はメンバー一覧を閲覧できますが、招待・解除・権限変更はできません。

## アプリ全体管理者

初期管理者を作る場合は、管理者にしたい Google アカウントで一度ログインし、`users` レコードを作成してから CLI で権限を付与します。

```powershell
npm run admin:grant -- --email example@gmail.com --role SUPER_ADMIN
```

`--role` は `ADMIN` または `SUPER_ADMIN` を指定できます。省略時は `SUPER_ADMIN` です。権限を外す場合は次を使います。

```powershell
npm run admin:revoke -- --email example@gmail.com
```

管理画面は次のURLに分かれています。いずれも `ADMIN` または `SUPER_ADMIN` だけがアクセスできます。

- `/admin`: 全体件数、新しいユーザー・共有のプレビュー、招待リンクの状態
- `/admin/users`: ユーザー一覧、利用状態、利用停止・解除、アプリ全体権限（1ページ20件のDB側ページング）
- `/admin/households`: Household / 共有、メンバー状態（1ページ20件のDB側ページング）

`SUPER_ADMIN` は `/admin/users` から他ユーザーの `appRole` を変更し、理由を記録して利用停止・解除できます。停止処理は対象状態の再確認、最後の利用中 `SUPER_ADMIN` の判定、状態更新、全Session削除、操作履歴作成を同一transactionで行います。権限変更と停止・解除は同じPostgreSQL advisory transaction lockで直列化します。自分自身の降格・利用停止と、最後の利用中 `SUPER_ADMIN` の降格・利用停止はできません。

## 既存データ移行

認証導入前の既存ハムスターは `householdId` が未設定のまま残る可能性があります。開発 DB や本番 DB をリセットせずに移行する場合は、まず管理者にしたい Google アカウントで一度ログインして `users` レコードを作成します。その後、次のコマンドで未割り当てハムスターと旧ダッシュボード設定を、そのユーザーの最初の Household に割り当てます。

```powershell
npm run migrate:assign-owner -- --email example@gmail.com
```

ホスト PC から実行する場合は、`DATABASE_URL` が `localhost:5434` を向くようにしてから実行してください。Docker Compose の app コンテナ内で実行する場合は、`DATABASE_URL` は `db:5432` のままで構いません。

## VPS デプロイ手順

前提:

- Ubuntu
- Docker
- Docker Compose
- Nginx は必要に応じて VPS ホスト側に配置
- このアプリは PM2 では管理しない
- 既存の Node.js / PM2 アプリとはポートとプロセス管理を分ける

### 1. 専用ユーザーでリポジトリを clone

アプリごとに Linux ユーザーを分けたい場合の例です。

```bash
sudo adduser hamster
sudo usermod -aG docker hamster
```

一度ログアウトして、`hamster` ユーザーで入り直します。

```bash
ssh hamster@your-vps-host
```

配置例:

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/skaltanukiman/Hamster-Manager-Browser.git hamster-manager-browser
cd hamster-manager-browser
```

### 2. 本番用 `.env` を作成

```bash
cp .env.production.example .env
nano .env
```

`POSTGRES_PASSWORD` は必ず強い値に変更します。`DATABASE_URL` 側のユーザー名、パスワード、DB 名は `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` と合わせます。

```env
DATABASE_URL="postgresql://dog_cat_user:change_me_to_a_strong_password@db:5432/dog_cat_manager?schema=public"

POSTGRES_DB="dog_cat_manager"
POSTGRES_USER="dog_cat_user"
POSTGRES_PASSWORD="change_me_to_a_strong_password"
```

Docker Compose 内では app から db へ接続するため、VPS 本番でも `DATABASE_URL` のホストは `db` のままです。

`.env` の `AUTH_URL` は `.env.production.example` の例示値から、実際のHTTPSドメインへ必ず変更します。

### 3. ビルドと起動

```bash
mkdir -p logs uploads/hamsters uploads/records
sudo chown -R 1001:1001 logs uploads
chmod 750 logs uploads uploads/hamsters uploads/records
docker compose build
docker compose up -d --wait --wait-timeout 120
```

### 4. Prisma migrate を反映

本番では `migrate deploy` を使います。

```bash
docker compose exec app npx prisma migrate deploy
```

プロフィール画像列は migration `20260712090000_add_hamster_profile_image`、健康・通院・思い出記録は migration `20260715120000_add_hamster_records`、保存済み思い出タグは migration `20260716160000_add_saved_memory_tags`、既存タグの幅正規化と大小文字を区別する保存キーへの移行は migration `20260716190000_normalize_memory_tag_width_preserve_case`、大小文字を吸収するタグ検索配列は migration `20260716210000_add_memory_record_search_tags`、健康記録の任意時刻は migration `20260717120000_add_health_record_time`、操作履歴の全Household向け日時検索インデックスは migration `20260722090000_add_household_activity_created_at_index`、思い出と複数ハムスターの中間テーブルおよび既存思い出の対象バックフィルは migration `20260802120000_add_memory_record_hamsters` で追加されます。appコンテナ起動時にも `prisma migrate deploy` が実行されるため、更新時はログで適用成功を確認してください。

このmigrationを含む更新では、適用前にPostgreSQLと`uploads/records`をバックアップしてください。適用後はmigrationログにバックフィル例外がないことを確認し、既存思い出が従来の代表ハムスターの個別タイムラインへ表示されること、共有思い出が各対象の個別タイムラインへ表示されること、グループ全体では1件だけ表示されることを確認します。ハムスター削除は、共有思い出の代表付け替えと画像保持を含むため、単体削除と一括削除の両方をステージングまたはテスト用Householdで確認してください。

必要なら seed を投入します。

```bash
docker compose exec app npx prisma db seed
```

### 5. ログ確認

```bash
docker compose logs app
docker compose logs -f app
docker compose logs --tail=100 app
docker compose logs -f db
tail -n 100 logs/application-$(date +%Y-%m-%d).log
```

### 6. 再起動・停止

```bash
docker compose restart app
docker compose down
```

`docker compose down` では PostgreSQL の volume とホスト側 `uploads` は残ります。`docker compose down -v` は DB データを削除するため、本番では使わないでください。`uploads` を手動削除すると画像は復元できません。

## アプリ更新手順

VPS 上で更新する例です。

```bash
cd ~/apps/hamster-manager-browser
git pull
docker compose build
docker compose up -d --wait --wait-timeout 120
docker compose logs -f app
```

`--wait` はDBとappが `healthy` になるまで待機し、120秒以内に正常化しなければコマンドを失敗させます。デプロイ後は次でも状態を確認できます。

```bash
curl --fail http://127.0.0.1:3002/api/health
```

Docker Compose v1 の `docker-compose` で `KeyError: 'ContainerConfig'` が出る場合は、壊れた作成途中コンテナを削除するか、可能なら Compose v2 の `docker compose` を使ってください。

## Nginx リバースプロキシ設定例

Nginx は VPS ホスト側に置き、`127.0.0.1:3002` で待ち受ける Docker 上の Next.js アプリへ転送します。app ポートは外部インターフェースへ公開しないため、インターネットからは Nginx と HTTPS を経由してアクセスします。

```nginx
server {
    server_name hamster.example.com;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

設定反映:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS 化する場合は Certbot などで証明書を発行します。

## Tailscale 経由で個人利用する場合

個人用で外出先のスマホから使うだけなら、アプリをインターネット全体へ公開せず、Tailscale 経由で VPS にアクセスする運用もできます。

標準のCompose設定ではappを `127.0.0.1:3002` のみに公開するため、Tailscale IP とポート `3002` へ直接アクセスはできません。Tailscale経由で利用する場合も、VPS上のNginxを経由させるか、開発・個人利用専用のCompose設定で公開先をTailscale IPへ限定してください。

```text
https://<tailscaleで到達できるホスト名>
```

Tailscale側のアクセス制御に加えて、OSのファイアウォールでも不要なインターフェースから `3002` へ到達できないようにしてください。

## 既存アプリとの同居時の注意

- このアプリは Docker Compose で管理し、PM2 には登録しません。
- App コンテナ名は `dog-cat-manager-web` です。
- DB コンテナ名は `dog-cat-manager-db` です。
- App のホスト側ポートはDog & Cat Manager専用の `127.0.0.1:3002` に限定しています。
- PostgreSQL の DB 名、ユーザー名、パスワードはこのアプリ専用にします。
- `.env` はこのアプリ専用にします。
- Docker コンテナ内の Node.js を使うため、VPS ホスト側の Node.js バージョンには依存しません。
- PostgreSQL のホスト公開は `127.0.0.1:5433` に限定しています。

## DB・プロフィール画像・思い出画像のバックアップ

PostgreSQL のデータは Docker volume `dog_cat_manager_pgdata` に永続化されます。VPS 本番では、定期バックアップと VPS 外への退避を検討してください。

プロフィール画像と思い出画像はDBではなくホスト側 `uploads/hamsters`、`uploads/records` にあります。DBバックアップだけでは画像を復元できないため、DBダンプと同じ世代の `uploads` ディレクトリも必ずバックアップしてください。

バックアップ例:

```bash
docker compose exec db pg_dump -U dog_cat_user dog_cat_manager > backup.sql
tar czf hamster-uploads.tar.gz uploads
```

リストア例:

```bash
docker compose exec -T db psql -U dog_cat_user dog_cat_manager < backup.sql
```

`.env` で DB 名やユーザー名を変更している場合は、コマンド内の `dog_cat_user` と `dog_cat_manager` も実際の値に合わせてください。

## 食事・水替えのWebプッシュ通知

通知はWeb標準のService Worker、Push API、Notifications API、VAPIDを使用します。HTTPS（開発用localhostを除く）が必須です。アプリ全体のオフラインキャッシュは行いません。

### VAPID鍵と環境変数

秘密鍵をGitへ追加せず、本番VPSの`.env`だけに保存してください。鍵は次で生成できます。

```bash
npx web-push generate-vapid-keys
```

生成結果を次の環境変数へ設定します。`WEB_PUSH_SUBJECT`には運用者が管理する`mailto:` URIまたはHTTPS URLを指定します。実在値をREADMEやexampleファイルへ書かないでください。

```env
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_SUBJECT=
```

鍵を変更すると既存購読を利用できなくなるため、原則として同じ鍵を継続利用します。変更時は利用者が各端末で一度解除し、再度有効にしてください。

### 利用者の操作

1. PWAへログインし、対象の共有グループへ切り替えて`設定`を開きます。
2. 食事・水替えそれぞれの通知ON/OFF、完了期限、何分前に通知するかを保存します。初期値は食事22:00、水替え21:00、各30分前で、既存ユーザーはOFFです。
3. 通知を受け取る端末ごとに`この端末で通知を有効にする`を押し、ブラウザーの許可を選びます。ページ表示だけで許可ダイアログが出ることはありません。

AndroidではChrome系ブラウザーでPWAをインストールして操作します。iPhone/iPadではSafariの共有メニューからホーム画面へ追加し、追加したPWAを起動してから有効化してください。通常のSafariタブからはiOSのWebプッシュを有効化できません。拒否後は自動再要求しないため、OSまたはブラウザー設定から通知を許可してから再操作します。

停止する場合は、対象共有グループの食事・水替え通知をOFFにします。特定端末だけ止める場合は、その端末で`この端末の通知を解除する`を押します。同じUserのPCとスマートフォンは別購読として管理されます。

### VPS cron

本番イメージには`src/lib`、`scripts`、`tsconfig.json`、実行時依存をコピーするため、CLIをappコンテナ内で実行できます。VPSのcrontabへ次を追加します。`/path/to/Hamster-Manager-Browser`は実際の配置先へ必ず書き換えてください。

```cron
* * * * * cd /path/to/Hamster-Manager-Browser && docker compose exec -T app npm run notifications:dispatch
```

手動実行と終了コードの確認例:

```bash
docker compose exec -T app npm run notifications:dispatch
echo $?
docker compose logs --since=10m app
```

予定時刻との完全一致ではなく、予定時刻から60分以内の未送信分を処理します。同じUser・Household・対象お世話日・予定時刻はDB一意制約で1件だけ予約し、2分リース後にクラッシュ回復できます。一時失敗は5分後に最大3回再試行します。404/410を返した無効な購読だけ自動削除し、その他の一時失敗では削除しません。一部端末が成功した場合、成功端末への重複を防ぐため配信全体は成功扱いです。

通知設定の取得時に関連Householdの`isDemo`と`careDayStartMinutes`も取得し、Householdごとに対象お世話日を算出して`CareNotificationDispatch.targetDate`へ保存します。再試行・期限切れ判定と送信直前確認でも同じ共通お世話日計算を使用します。通知期限と事前通知分数の既存バリデーションは維持し、通知時刻が日付をまたいで前日へ回り込む新しい指定方法はありません。

### 動作確認とトラブルシュート

実端末では、テスト用Householdの管理中ハムスターについて現在のお世話日の食事または水替えを未実施にし、期限と事前分数から算出される予定時刻を現在時刻の直前に設定してCLIを実行します。通知が届いたこと、タップで既存PWAが`/`へ移動して前面化すること、実施済みへ変更してからCLIを実行すると送信されないことを確認してください。本番の個人データや鍵をテストログへ貼り付けないでください。

届かない場合は次を確認します。

- HTTPS証明書、PWAインストール、端末・ブラウザーの通知許可
- 設定画面の端末状態が`通知有効`で、対象Householdの通知がONか
- 対象が管理中で、Householdの切り替え時刻から算出した現在のお世話日の`FeedingRecord` / `WaterReplacementRecord`が本当に未登録か
- `CareNotificationDispatch.targetDate`がHouseholdの最新`careDayStartMinutes`から算出した対象お世話日と一致するか
- VAPID 3環境変数、cron、appコンテナの時刻、`docker compose logs`の件数・errorId
- iOSではホーム画面から起動したPWAか、省電力・集中モードなどOS側制限がないか

Service Worker更新後はブラウザーの更新検出に時間差があるため、PWAを完全に閉じて再起動し、必要ならブラウザーのサイトデータまたはService Worker登録状態を確認します。サイトデータ消去は端末購読も失うため、その後は設定画面から再登録してください。

### デプロイとロールバック

通常どおりDBとuploadsをバックアップし、環境変数を設定してからイメージを再構築します。起動時の`prisma migrate deploy`で通知設定、端末購読、配信履歴に加えて`20260801150000_add_care_day_start_minutes`が適用されます。起動後にhealthcheck、設定画面の初期値0:00、ダッシュボード、CLI手動実行、cronの順で確認します。

```bash
docker compose build app
docker compose up -d --wait --wait-timeout 120
docker compose exec -T app npm run notifications:dispatch
```

アプリだけを旧版へ戻しても追加テーブル・列は旧版から参照されないため、まずcronを停止して旧イメージへ戻せます。DBまで戻す場合は、先にバックアップを確保し、通知cronを停止し、旧アプリへ切り替えてから通知テーブル・enum・AppSetting追加列を慎重に削除してください。購読・配信履歴は失われ、再デプロイ後に端末の再登録が必要になる可能性があります。
