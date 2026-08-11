# New Chat Prompt

```text
Hamster Manager Browser の続きの作業をお願いします。

リポジトリ:
C:\Users\sound\source\repos\Hamster-Manager-Browser

まず以下を読んでから作業してください。
- README.md
- docs/CODEX_HANDOFF.md
- 今回依頼する機能に関係する実装ファイル

重要:
- 既存のユーザー変更を勝手に戻さないでください。
- push はこちらが明示するまで行わないでください。
- READMEだけ、コメントだけ、特定ファイルだけ、など範囲指定がある場合は、その範囲以外を変更しないでください。
- Codexのcwdが別パスを示すことがあります。実体は通常 C:\Users\sound\source\repos\Hamster-Manager-Browser です。作業前にファイル実体と git status を確認してください。
- UI文言は日本語にしてください。
- スマホ実機での見え方、レスポンシブ崩れ、横はみ出し、固定ボタンの被りに注意してください。
- 認証・認可やデータ取得を触る場合は、必ず現在の Household で絞り込み、Server Action / Route Handler 側でも権限確認してください。
- 変更後は原則 npm.cmd run lint と npm.cmd run build を確認してください。
- Docker反映を依頼した場合は、ENV_FILE=.env.development 相当で docker compose build app → docker compose up -d → docker compose ps まで確認してください。

アプリ概要:
- GAS / Googleスプレッドシートで管理していたハムスターの衛生管理・体重管理をWebアプリ化したものです。
- Next.js / TypeScript / Prisma / PostgreSQL / Auth.js / Tailwind CSS / Recharts / Docker Compose 構成です。
- SQLiteではなくPostgreSQL前提です。
- Docker Composeのappコンテナは dog-cat-manager-web、dbコンテナは dog-cat-manager-db です。
- appはホスト3001→コンテナ3000、dbは127.0.0.1:5434→コンテナ5432です。
- 既存PM2アプリとは分離し、このアプリではPM2を使いません。

現在の主な仕様:
- Google OAuthログイン必須です。未ログイン時は /login へリダイレクトします。
- データは Household 単位で分離します。初回ログイン時に個人用 Household を自動作成します。
- 複数 Household に所属している場合はヘッダーの「操作対象」で現在の共有を切り替えます。cookie がなければ招待参加した共有中 Household を優先します。
- /settings/members でメンバー一覧、招待リンク作成、メンバー参加解除ができます。招待リンク作成は OWNER / ADMIN、参加解除は OWNER のみです。自分自身と最後の OWNER は解除できません。
- /invitations/accept で共有への参加ができます。招待リンクは7日間有効で、一度承認されたリンクは再利用不可です。
- /admin はアプリ全体管理者用です。User.appRole が ADMIN / SUPER_ADMIN のユーザーのみアクセスできます。
- SUPER_ADMIN は /admin から他ユーザーの appRole を変更できます。自分自身の降格と最後の SUPER_ADMIN の降格はできません。
- 初期管理者は Googleログイン後に npm run admin:grant -- --email example@gmail.com --role SUPER_ADMIN で付与します。
- 既存データ移行が必要な場合は、Googleログイン後に npm run migrate:assign-owner -- --email example@gmail.com を使います。
- 同じ Household の別タブ/別ユーザー更新は SSE と 4秒ごとの revision API 確認で検知します。未保存変更がなければ自動再取得し、入力中なら通知から手動再読み込みします。
- 自分自身や同一タブ由来の更新は realtimeActorId で自動再読み込みを抑制します。
- ダッシュボードは設定画面で選んだハムスターカードを表示します。
- 表示ボード数は1〜30件です。
- 掃除項目はトイレ掃除、砂場掃除、床材全交換、ハウス掃除をカードに表示します。
- 掃除日は経過日数と日付をクリック/タッチで切り替えます。
- ハムスター管理は名前15文字以内、メモ2000文字以内、誕生日/お迎え日未来日不可です。
- 管理外ハムスターはプロフィール編集、衛生記録、体重記録をロックします。ただし削除と管理中への復活は可能です。
- ハムスター一覧は検索、登録順/名前、昇順/降順、20件ページング、複数選択削除があります。
- 検索はNFKC正規化、小文字化、カタカナをひらがなに寄せて比較します。
- 設定画面では表示名を変更できます。表示名は50文字以内で、自動生成された個人用 Household 名にも反映します。
- 衛生管理はPCでは表、スマホでは日別カードです。
- 衛生管理のスマホ画面では編集後、現在スクリーン右下に固定保存ボタンが出ます。
- 体重管理はDB側フィルター/ソート/ページングです。20件ページングです。
- 体重グラフは現在条件に一致する全体を表示し、現在ページだけに限定しません。
- 体重履歴は登録順/日付/体重、昇順/降順でソートできます。初期表示は日付降順です。
- 体重登録後は登録順/降順に切り替えます。
- 体重CSVは /weights/export でエクスポート、/weights/import でGAS版CSVインポートです。
- /export は /weights/export へリダイレクトします。
- 設定画面でハムスター選択方式をコンボボックス式/プルダウン式に切り替えできます。
- 未保存変更がある状態で他画面へ移動しようとすると確認モーダルを表示します。

まず git status -sb で現在の状態を確認してから、こちらの依頼内容に進んでください。
```
