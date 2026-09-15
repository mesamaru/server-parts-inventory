# サーバーパーツ在庫管理

手持ちのサーバー関連パーツ（CPU・メモリ・ストレージ等）を登録し、どのサーバーに
何が組み込まれているかを管理するツールです。Node.js 単体で動作し、外部DBやネイティブ
モジュールのビルドを必要としません（データは `data/db.json` に保存されます）。

## 機能

- ログイン認証（アカウント管理・APIトークン）
- パーツ一覧の登録・編集・削除（カテゴリ／型番／スペック／シリアル番号／購入日／ステータス）
- CSVを貼り付け／アップロードしての一括登録（AI等でまとめたリストを一括で取り込み）
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

## 認証

初回アクセス時に管理者アカウントの作成画面が表示されます。作成後はログインが必要になり、
すべてのデータAPIは認証必須になります。

- **アカウント管理**: 「設定」タブから追加・削除できます（管理者のみ）。権限は管理者／一般の2種類です。
- **パスワード**: Node標準の`scrypt`でハッシュ化して保存します。8文字以上が必要です。
- **セッション**: HttpOnlyのCookieで30日間保持されます。パスワード変更時は他のセッションを無効化します。
- **APIトークン**: ブラウザ以外（Proxmoxホストからの構成送信など）から使うトークンを「設定」タブで
  発行できます。発行時に一度だけ表示されるので控えてください。
  リクエストには `Authorization: Bearer <トークン>` を付けます。

> Cookieに`Secure`属性は付けていません（PterodactylではHTTPで公開されることが多いため）。
> インターネットに直接公開する場合は、リバースプロキシでHTTPS化することを推奨します。

**ログインできなくなった場合**: `data/db.json` をパネルのファイルマネージャーで開き、
`"users": [...]` の中身を `"users": []` にして保存・再起動すると、初期設定画面からやり直せます
（パーツやサーバーのデータはそのまま残ります）。

## Proxmox等の実機からパーツ情報を自動取得する

[scripts/hw_to_csv.py](scripts/hw_to_csv.py) を対象サーバー（Proxmoxホスト等）で実行すると、
`dmidecode` / `lsblk` / `lspci` から CPU・メモリ（DIMM単位）・ストレージ・マザーボード・
GPU/NIC/RAIDカード・（対応機種のみ）電源を検出し、下記のCSV一括登録フォーマットで
標準出力に書き出します。Python3 と dmidecode/lsblk/lspci はProxmox/Debianに標準で
入っているため追加インストールは不要です。

```bash
scp scripts/hw_to_csv.py root@対象サーバー:/root/
ssh root@対象サーバー
sudo python3 hw_to_csv.py > parts.csv
cat parts.csv   # 内容を確認してコピーし、CSVから一括登録に貼り付け
```

dmidecodeの読み取りにroot権限が必要なため `sudo`（または root ユーザー）で実行してください。
CPU・メモリ・電源のシリアル番号がBIOS/ファームウェア側で設定されていない機体
（家庭用PCの流用等）では、シリアル番号欄が空になることがあります。

## CSV一括登録

パーツ一覧画面の「CSVから一括登録」から、AIなどでまとめたパーツリストをそのまま取り込めます。
1行目はヘッダー行にしてください。

```csv
category,name,spec,serial_number,status,purchase_date,notes
CPU,Intel Xeon E5-2680 v4,14core/28thread 2.4GHz,ABC123,正常,2024-05-01,
メモリ,32GB DDR4 ECC,32GB DDR4 3200MHz,,正常,,
```

- ヘッダーは英語（`category,name,spec,serial_number,status,purchase_date,notes`）でも
  日本語（`カテゴリ,名称,スペック,シリアル番号,ステータス,購入日,備考`）でも認識されます。
- `maker`（メーカー）列も任意で指定できます。
- 必須は `category`（カテゴリ）と `name`（名称）のみ。他は空欄可。
- `status`（ステータス）は 正常/故障/廃棄（英語表記 normal/broken/retired も可）。空欄なら正常。
- 行ごとにプレビューで検証され、エラーのある行だけ除外して残りを登録できます。

## API 概要

データAPI（`/api/parts`, `/api/servers`, `/api/assignments`）はすべて認証必須です。

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | /api/auth/state | 初期設定の要否とログイン中ユーザー（認証不要） |
| POST | /api/auth/setup | 最初の管理者を作成（ユーザーが居ない時のみ） |
| POST | /api/auth/login / logout | ログイン・ログアウト |
| POST | /api/auth/password | 自分のパスワード変更 |
| GET/POST/DELETE | /api/auth/users | ユーザー管理（管理者のみ） |
| GET/POST/DELETE | /api/auth/tokens | APIトークン管理（管理者のみ） |
| GET | /api/parts | パーツ一覧（検索・フィルタ可） |
| POST | /api/parts | パーツ新規登録 |
| POST | /api/parts/bulk | CSV等からの一括登録（`{ parts: [...] }`、行単位で成功/失敗を返す） |
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
