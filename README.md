# Dmidex

**ディーエムアイデックス** — サーバーパーツ在庫管理ツール

手持ちのサーバー関連パーツ（CPU・メモリ・ストレージ等）を登録し、どのサーバーに
何が組み込まれているかを管理します。`dmidecode` で拾った実機の構成と台帳を突き合わせ
られるのが特徴で、名前もそこから取っています（DMI + index）。

Node.js単体で動作し、外部DBを必要としません（データは `data/db.json`、写真は
`data/uploads/` に保存されます）。依存パッケージはExpressとSSH接続用のssh2のみで、
どちらもネイティブビルドが無くても動作します。

## 機能

- ダークモード／スマホ対応レイアウト
- ログイン認証（アカウント管理・APIトークン）
- 実機構成の送信と差分確認（構成同期・Proxmox / Linux / Windows 対応）
- サーバーにSSH接続情報を登録し、ボタン一つで構成を取得（実機への手動アクセス不要）
- ゴミ箱（削除したパーツ・サーバーの復元）と操作履歴（監査ログ）
- ダッシュボード（在庫サマリ・カテゴリ別内訳・保証期限アラート・最近の変更）
- パーツ一覧の登録・編集・削除（カテゴリ／型番／スペック／シリアル番号／購入日／保証期限／ステータス／写真）
- 列ソート・ページング・CSVエクスポート
- CSVを貼り付け／アップロードしての一括登録（AI等でまとめたリストを一括で取り込み）
- パーツのステータス管理（正常／故障／廃棄）
- サーバー一覧の登録・編集・削除
- サーバー一覧は簡易表示／詳細表示を切り替え可能。詳細表示では現在の割り当てパーツから
  CPU（名称・コア数/スレッド数・動作クロック）／メモリ（合計容量と内訳）／ストレージ構成を自動集計して表示
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

## SSHによる遠隔取得（ボタン一つで構成取得）

対象サーバーにスクリプトを手動で置きに行かなくても、Dmidex側からSSH接続して検出・取得できます。
「サーバー一覧」→ 対象サーバーの編集 →「高度な設定（SSH接続）」から設定します（管理者のみ）。

- ホスト・ポート・ユーザー名・認証方式（パスワード／秘密鍵）・OS（Linux/Windows）を登録
- 保存後、サーバー一覧に「SSHで構成を取得」アイコンが表示され、クリックするとその場で
  スクリプトをSFTP転送→実行→結果を回収→実行したスクリプトを削除、まで自動で行います
- 取得結果は構成同期タブに差分として届きます（送信しただけでは台帳は変わりません）

**セキュリティ**: パスワード・秘密鍵は `data/secret.key`（初回起動時に自動生成、`.gitignore`済み）
を鍵にAES-256-GCMで暗号化して保存します。APIやUIに平文で返すことは一切ありません。
`data/secret.key` を紛失すると保存済みの認証情報は復号できなくなるため、SSH設定を登録し直す
必要があります（パーツ・サーバーのデータには影響しません）。

**sudoについて**: Linuxでsudoを使う設定（既定でON）の場合、SSH接続したユーザーは
**パスワード入力なしでsudoできる必要があります**（`visudo`で対象ユーザーに`NOPASSWD:`を設定するか、
rootで直接SSHしてください）。満たせない場合は「sudoを使う」のチェックを外せば、
接続ユーザーの権限のまま実行します（一部情報が取得できないことがあります）。

**Windows**: OpenSSH Serverが有効で、SFTPサブシステムが使える必要があります
（Windows標準のOpenSSHサーバーは既定で対応しています）。

## 構成同期（実機と台帳の差分確認）

同じスクリプトに `--push`（Windowsは `-Push`）を付けると、CSVを経由せず実機の構成を
Dmidex へ送信できます。**送信しただけでは台帳は変わりません。**
「構成同期」タブで差分を確認し、反映する項目を選んで適用します。

URL・APIトークンは `--url`/`--token`（Windowsは `-Url`/`-Token`）を省略すると、実行時に
その場で入力を求められます（トークンは画面に表示されず、シェル履歴にも残りません）。
「構成同期」タブのコマンド生成フォームでコマンドを作れば、URLは自動で入り、APIトークンは
実行時入力（既定）かコマンドへの埋め込みかを選べます。

```bash
# Proxmox / Linux（URL・トークンを省略した場合は実行時に入力を求められる）
sudo python3 hw_to_csv.py --push
```

```powershell
# Windows（管理者として実行）
powershell -ExecutionPolicy Bypass -File .\hw_to_csv.ps1 -Push
```

**対象サーバーを送信前に指定する必要はありません。** 送られてきたデータは、送信元ホスト名と
共に「構成同期」タブの「未割り当てのレポート」に届きます。受信したパーツを一覧から選び
（初期状態は全選択、チェックを外して除外も可）、対象サーバーをプルダウンで選ぶか、
その場で新規サーバーを登録してから「選択したパーツを割り当てる」を押すと、
通常の差分確認（下表）に進みます。

送信すると、対象サーバーが決まった時点で差分が4つに分類されます。

| 分類 | 内容 | 既定 |
| --- | --- | --- |
| 実機に見つからない | 台帳では割り当て済みだが実機に無い → 取り外す | 選択済み |
| 在庫に一致するものがある | 実機にあり、在庫の登録済みパーツと一致 → 割り当てる | 選択済み |
| 未登録 | 実機にあるが台帳に無い → 内容を確認して新規登録＋割り当て | **未選択**（目視確認が必要） |
| 台帳と一致 | 差分なし | 操作不要 |

各分類にはグループ単位の「全て選択」チェックボックスがあり、一括でチェックの付け外しができます。

同一判定は、双方にシリアル番号があればシリアル番号のみで行い（別個体を同一視しないため）、
無ければカテゴリ・名称・スペックで行います。同じサーバーの未処理レポートは最新のものだけ保持されます。

事前に対象サーバーを登録しておく必要はありません。「＋新しいサーバーを登録する」を選べば、
未割り当てレポートの画面からその場で登録できます。

引き続き `--server`（Windowsは `-Server`）で既存サーバー名を明示することもできます。
名前が完全一致すれば送信時点で自動的にそのサーバーへ割り当てられます（省略可・任意）。

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
| POST | /api/sync/report | 実機構成の送信（APIトークン可）。`server_name` 省略時は未割り当てとして保持し、差分は作らない |
| GET | /api/sync/reports | 構成レポートの一覧（未割り当て分・差分計算済み分の両方） |
| POST | /api/sync/reports/:id/assign-server | 未割り当てレポートに対象サーバーを割り当て、差分を作る（`part_indices` で対象パーツを絞り込み可） |
| POST | /api/sync/reports/:id/apply | 選択した差分を反映 |
| DELETE | /api/sync/reports/:id | 構成レポートを破棄（未割り当て・割り当て済みどちらも可） |
| PUT | /api/servers/:id/ssh | SSH接続情報を保存（管理者のみ。暗号化して保存） |
| DELETE | /api/servers/:id/ssh | SSH接続情報を削除（管理者のみ） |
| POST | /api/servers/:id/ssh-fetch | SSH接続して構成を取得し、構成同期の差分にする（管理者のみ） |
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
