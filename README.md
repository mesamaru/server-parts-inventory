# サーバーパーツ在庫管理

手持ちのサーバー関連パーツ（CPU・メモリ・ストレージ等）を登録し、どのサーバーに
何が組み込まれているかを管理するツールです。Node.js 単体で動作し、外部DBやネイティブ
モジュールのビルドを必要としません（データは `data/db.json` に保存されます）。

## 機能

- パーツ一覧の登録・編集・削除（カテゴリ／型番／スペック／シリアル番号／購入日／ステータス）
- パーツのステータス管理（正常／故障／廃棄）
- サーバー一覧の登録・編集・削除
- パーツをサーバーへ割り当て・取り外し・別サーバーへの移動
- サーバーごとの「現在の構成」表示
- パーツ／サーバーそれぞれの割り当て履歴（過去にどこにあったか）

## ローカルでの起動

```bash
npm install
npm start
```

既定では `http://localhost:3000` で起動します。ポートは環境変数 `PORT` で変更できます。

## Pterodactyl（Node.js Generic Egg）での運用

1. Pterodactyl パネルで **Node.js Generic** Egg を使ってサーバーを作成します。
   （Nest: `Generic` / Egg: `Node.js Generic` などパネルの構成に合わせてください）
2. このプロジェクト一式をサーバーのファイルにアップロード（SFTP または Git 連携）します。
3. **Startup Command** を以下のいずれかに設定します。
   - `node server.js`
   - もしくは `npm start`（package.json の `start` スクリプトを実行）
4. Egg の起動時に自動で `npm install` が実行される設定になっているか確認してください
   （されない場合は Install Script で `npm install --production` を実行します）。
5. 本アプリは `process.env.SERVER_PORT`（Pterodactylが渡す環境変数）を優先的に使用し、
   無ければ `PORT`、それも無ければ `3000` にフォールバックします。パネルの
   Primary Allocation のポートと一致していれば追加設定は不要です。
6. データは `data/db.json` に保存されます。Pterodactyl のサーバーディレクトリは
   永続化されるため、サーバー再起動後もデータは保持されます。バックアップする場合は
   `data/db.json` をコピーしてください。

## データモデル

- **parts（パーツ）**: カテゴリ・名称・スペック・シリアル番号・ステータス（正常/故障/廃棄）
- **servers（サーバー）**: サーバー名・設置場所・ステータス
- **assignments（割り当て）**: パーツとサーバーの紐付け。`removed_at` が `null` なら
  現在使用中、値が入っていれば過去の割り当て（履歴）として保持されます。

## API 概要

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | /api/parts | パーツ一覧（検索・フィルタ可） |
| POST | /api/parts | パーツ新規登録 |
| GET | /api/parts/:id | パーツ詳細＋履歴 |
| PUT | /api/parts/:id | パーツ更新 |
| DELETE | /api/parts/:id | パーツ削除（割り当て中は不可） |
| GET | /api/servers | サーバー一覧 |
| POST | /api/servers | サーバー新規登録 |
| GET | /api/servers/:id | サーバー詳細（現在の構成＋履歴） |
| PUT | /api/servers/:id | サーバー更新 |
| DELETE | /api/servers/:id | サーバー削除（割り当てがあると不可） |
| POST | /api/assignments | パーツをサーバーに割り当て |
| POST | /api/assignments/:id/remove | 取り外し（在庫に戻す） |
| POST | /api/assignments/:id/move | 別サーバーへ移動 |
