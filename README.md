# Dmidex

**ディーエムアイデックス** — サーバーパーツ在庫管理ツール

手持ちのサーバー関連パーツ（CPU・メモリ・ストレージ等）を登録し、どのサーバーに
何が組み込まれているかを管理します。`dmidecode` で拾った実機の構成と台帳を突き合わせ
られるのが特徴で、名前もそこから取っています（DMI + index）。

Node.js 単体で動作し、外部DBやネイティブモジュールのビルドを必要としません
（データは `data/db.json`、写真は `data/uploads/` に保存されます）。

## 機能

- ログイン認証（アカウント管理・APIトークン）
- 実機構成の送信と差分確認（構成同期・Proxmox / Linux / Windows 対応）
- ゴミ箱（削除したパーツ・サーバーの復元）と操作履歴（監査ログ）
- ダッシュボード（在庫サマリ・カテゴリ別内訳・保証期限アラート・最近の変更）
- パーツ一覧の登録・編集・削除（カテゴリ／型番／スペック／シリアル番号／購入日／保証期限／ステータス／写真）
- 列ソート・ページング・CSVエクスポート
- CSVを貼り付け／アップロードしての一括登録（AI等でまとめたリストを一括で取り込み）
- パーツのステータス管理（正常／故障／廃棄）
- サーバー一覧の登録・編集・削除
- パーツをサーバーへ割り当て・取り外し・別サーバーへの移動
- サーバーごとの「現在の構成」表示
- パーツ／サーバーそれぞれの割り当て履歴（過去にどこにあったか）

## バージョン

`メジャー.マイナー.バグ修正` の順で管理しています（互換性が壊れる変更・機能追加・不具合修正）。
現在のバージョンは画面右上とログイン画面に表示され、`GET /api/version` でも取得できます。
変更内容は [CHANGELOG.md](CHANGELOG.md) を参照してください。

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

> Cookieに`Secure`属性は付けていません（PterodactylではHTTPで公開されることが多く、
> 付けるとHTTP経由でログインできなくなるため）。インターネットに公開する場合は、
> リバースプロキシでHTTPS化してください。
>
> 運用中のURL: `https://dmidex.nuids.duckdns.org/`（DuckDNS + HTTPS）

**ログインできなくなった場合**: `data/db.json` をパネルのファイルマネージャーで開き、
`"users": [...]` の中身を `"users": []` にして保存・再起動すると、初期設定画面からやり直せます
（パーツやサーバーのデータはそのまま残ります）。

## 実機からパーツ情報を取得する

対象マシンでスクリプトを実行すると、搭載パーツを検出してCSVを出力します。
OSごとに使うスクリプトが違うだけで、出力するCSVの形式と使い方は共通です。

| OS | スクリプト | 必要なもの |
| --- | --- | --- |
| Proxmox / Linux | [scripts/hw_to_csv.py](scripts/hw_to_csv.py) | Python3・dmidecode・lsblk・lspci（いずれもProxmox/Debianに標準搭載） |
| Windows | [scripts/hw_to_csv.ps1](scripts/hw_to_csv.ps1) | PowerShell（Windows標準搭載） |

### Proxmox / Linux

`dmidecode` / `lsblk` / `lspci` から CPU・メモリ（DIMM単位）・ストレージ・マザーボード・
GPU/NIC/RAIDカード・（対応機種のみ）電源を検出します。
dmidecodeの読み取りにroot権限が必要なため `sudo`（または root ユーザー）で実行してください。

```bash
# スクリプトを取得して実行する
curl -O https://raw.githubusercontent.com/mesamaru/server-parts-inventory/main/scripts/hw_to_csv.py
sudo python3 hw_to_csv.py > parts.csv
cat parts.csv   # 内容を確認してコピーし、「CSVから一括登録」に貼り付け
```

### Windows

CIM/WMI から CPU・メモリ（スロット単位）・ストレージ・マザーボード・GPU・NIC を検出します。
シリアル番号の一部は管理者権限がないと取得できないため、**管理者としてPowerShellを開いて**
実行してください。

```powershell
# スクリプトを取得する
curl.exe -O https://raw.githubusercontent.com/mesamaru/server-parts-inventory/main/scripts/hw_to_csv.ps1

# 画面にCSVを表示する（そのままコピーして「CSVから一括登録」に貼り付け）
powershell -ExecutionPolicy Bypass -File .\hw_to_csv.ps1

# ファイルに保存する場合（Excelで開けるUTF-8 BOM付き）
powershell -ExecutionPolicy Bypass -File .\hw_to_csv.ps1 -OutFile parts.csv
```

GPUは仮想ディスプレイドライバを除外し、PCI接続の実デバイスのみを対象にします。
ノートPCのようにメモリがオンボード実装の機種では、DIMMスロットではなくメモリコントローラ
単位（Controller0-ChannelA 等）で列挙されます。

### 共通の注意

CPU・メモリ・電源のシリアル番号がBIOS/ファームウェア側で設定されていない機体
（家庭用PCの流用等）では、シリアル番号欄が空、または `00000000` になることがあります。
この場合、構成同期の同一判定はカテゴリ・名称・スペックで行われます。

## 構成同期（実機と台帳の差分確認）

同じスクリプトに `--push`（Windowsは `-Push`）を付けると、CSVを経由せず実機の構成を
Dmidex へ送信できます。**送信しただけでは台帳は変わりません。**
「構成同期」タブで差分を確認し、反映する項目を選んで適用します。

```bash
# Proxmox / Linux
sudo python3 hw_to_csv.py --push \
  --url https://dmidex.nuids.duckdns.org \
  --token <設定タブで発行したAPIトークン> \
  --server prox04          # 省略時はこのホストのhostname
```

```powershell
# Windows（管理者として実行）
powershell -ExecutionPolicy Bypass -File .\hw_to_csv.ps1 -Push `
  -Url https://dmidex.nuids.duckdns.org `
  -Token <設定タブで発行したAPIトークン> `
  -Server win01            # 省略時はこのPCのコンピューター名
```

送信すると差分が4つに分類されます。

| 分類 | 内容 | 既定 |
| --- | --- | --- |
| 実機に見つからない | 台帳では割り当て済みだが実機に無い → 取り外す | 選択済み |
| 在庫に一致するものがある | 実機にあり、在庫の登録済みパーツと一致 → 割り当てる | 選択済み |
| 未登録 | 実機にあるが台帳に無い → 内容を確認して新規登録＋割り当て | **未選択**（目視確認が必要） |
| 台帳と一致 | 差分なし | 操作不要 |

同一判定は、双方にシリアル番号があればシリアル番号のみで行い（別個体を同一視しないため）、
無ければカテゴリ・名称・スペックで行います。同じサーバーの未処理レポートは最新のものだけ保持されます。

事前に、対象サーバーを「サーバー一覧」に登録しておく必要があります（未登録の場合はエラーになります）。

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
- `maker`（メーカー）、`warranty_until`（保証期限）列も任意で指定できます。
- 「CSVで書き出し」で出力したファイルは、そのまま取り込みに再利用できます（Excel対応のBOM付き）。
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
| GET | /api/trash | ゴミ箱の一覧（削除済みパーツ・サーバー） |
| POST | /api/trash/:type/:id/restore | 復元（type は parts / servers） |
| DELETE | /api/trash/:type/:id | 完全削除（管理者のみ・取り消し不可） |
| GET | /api/audit | 操作履歴（`?limit=` で件数指定、既定100・最大500） |
| POST | /api/sync/report | 実機構成の送信（APIトークン可）。差分を作るだけで台帳は変更しない |
| GET | /api/sync/reports | 未処理の構成レポートと差分 |
| POST | /api/sync/reports/:id/apply | 選択した差分を反映 |
| DELETE | /api/sync/reports/:id | 構成レポートを破棄 |
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
