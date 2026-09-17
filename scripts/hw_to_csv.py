#!/usr/bin/env python3
"""
Dmidex 用のハードウェア検出スクリプト。

Proxmox（や一般のLinuxホスト）に搭載されているパーツを検出し、
Dmidex の「CSVから一括登録」でそのまま使える CSV形式で
標準出力に書き出す。

使い方:
    # CSVとして出力する
    sudo python3 hw_to_csv.py > parts.csv

    # Dmidex へ構成を送信して差分を作る（自動では反映されない）。
    # --token を省略すると、実行時に入力を求められる（画面に表示されず、
    # シェル履歴にも残らない）。
    sudo python3 hw_to_csv.py --push --url http://192.168.1.10:3000

送信した内容は「構成同期」画面に「未割り当て」として届きます。パーツを
確認し、割り当てるものを選んで対象サーバーを選ぶところまでWeb画面で行います
（送信しただけで台帳が書き換わることはありません）。事前に対象サーバー名が
分かっていれば --server で指定でき、その場合は名前が完全一致すれば
自動で割り当てられます。

追加インストール不要（Python3 / dmidecode / lsblk / lspci は
Proxmox / Debian に標準で入っている）。dmidecode の読み取りに
root権限が必要なため sudo で実行すること。
"""
import argparse
import csv
import getpass
import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request


parser = argparse.ArgumentParser(description="搭載パーツを検出してCSV出力、または Dmidex へ送信する")
parser.add_argument("--push", action="store_true", help="CSVを出さずに Dmidex へ構成を送信する")
parser.add_argument("--url", help="Dmidex のURL 例: http://192.168.1.10:3000")
parser.add_argument("--token", help="設定画面で発行したAPIトークン（省略すると実行時に入力を求める）")
parser.add_argument("--server", help="既存サーバー名と完全一致すれば自動で割り当てる（省略可・任意）")
args = parser.parse_args()

if args.push:
    if not args.url:
        try:
            args.url = input("Dmidex のURL（例: http://192.168.1.10:3000）: ").strip()
        except (EOFError, KeyboardInterrupt):
            args.url = ""
    if not args.token:
        try:
            args.token = getpass.getpass("APIトークン: ").strip()
        except (EOFError, KeyboardInterrupt):
            args.token = ""
    if not args.url or not args.token:
        parser.error("--push には URL とAPIトークンが必要です")

if os.geteuid() != 0:
    print(
        "# 警告: root権限で実行していません。CPU/メモリ等の情報が取得できていない可能性があります。"
        " sudo を付けて再実行してください。",
        file=sys.stderr,
    )


def run(cmd):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        return result.stdout
    except FileNotFoundError:
        return ""


def clean(value):
    if value is None:
        return ""
    v = value.strip()
    if not v or v in ("Not Specified", "Not Present", "None", "No Module Installed"):
        return ""
    # dmidecodeは未設定のOEMコードを "Unknown" や "Unknown (0)" のように返すことがある
    if v.lower().startswith("unknown"):
        return ""
    return v


def dmidecode_records(dtype):
    """`dmidecode -t <dtype>` の出力を、レコード(dict)のリストにして返す。

    dmidecode の出力は「非インデント行=見出し／インデント行=key: value」
    という構造で、レコード同士は空行で区切られる。空行そのものでは保存
    せず、次の非インデント見出し行(次のレコードの開始)が来たタイミングで
    それまで貯めた内容を1レコードとして確定する。
    """
    out = run(["dmidecode", "-t", dtype])
    records = []
    current = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")):
            if current:
                records.append(current)
                current = {}
            continue
        m = re.match(r"^\s+([^:]+):\s*(.*)$", line)
        if m:
            current[m.group(1).strip()] = m.group(2).strip()
    if current:
        records.append(current)
    return records


# dmidecode/lspci が返すベンダー表記を、アプリのメーカートグルと揃った短い表記に寄せる
MAKER_ALIASES = {
    "genuineintel": "Intel",
    "intel corporation": "Intel",
    "intel": "Intel",
    "authenticamd": "AMD",
    "advanced micro devices, inc. [amd/ati]": "AMD",
    "advanced micro devices, inc. [amd]": "AMD",
    "amd": "AMD",
    "nvidia corporation": "NVIDIA",
    "realtek semiconductor co., ltd.": "Realtek",
    "broadcom inc. and subsidiaries": "Broadcom",
    "broadcom limited": "Broadcom",
    "mellanox technologies": "Mellanox",
    "samsung": "Samsung",
    "samsung electronics co ltd": "Samsung",
    "micron technology": "Micron / Crucial",
    "micron": "Micron / Crucial",
    "crucial": "Micron / Crucial",
    "sk hynix": "SK hynix",
    "skhynix": "SK hynix",
    "hynix": "SK hynix",
    "kingston": "Kingston",
    "western digital": "Western Digital",
    "wdc": "Western Digital",
    "seagate": "Seagate",
    "kioxia": "Kioxia",
    "toshiba": "Kioxia",
}

# ストレージのモデル名は「メーカー名 + 型番」の形が多いので、先頭語で判定する
STORAGE_MAKER_PREFIXES = [
    "Samsung", "WDC", "WD", "Seagate", "Crucial", "Kioxia", "Toshiba",
    "Intel", "Kingston", "SanDisk", "Hitachi", "HGST", "Dogfish",
]


def normalize_maker(raw):
    value = clean(raw)
    if not value:
        return ""
    return MAKER_ALIASES.get(value.lower(), value)


def split_storage_maker(model):
    """ストレージのモデル名を (メーカー, 残りの名称) に分解する。"""
    model = clean(model)
    if not model:
        return "", ""
    head = model.split()[0]
    for prefix in STORAGE_MAKER_PREFIXES:
        if head.lower() == prefix.lower():
            rest = model[len(head):].strip()
            return normalize_maker(prefix), (rest or model)
    return "", model


CSV_COLUMNS = ["category", "name", "maker", "spec", "serial_number", "status", "purchase_date", "notes"]

rows = []


def add(category, name, maker, spec, serial, notes=""):
    name = clean(name)
    if not name:
        return
    rows.append({
        "category": category,
        "name": name,
        "maker": clean(maker),
        "spec": clean(spec),
        "serial_number": clean(serial),
        "status": "normal",
        "purchase_date": "",
        "notes": notes,
    })


# ---- CPU ----
for r in dmidecode_records("processor"):
    status = r.get("Status", "")
    if status and "Unpopulated" in status:
        continue
    version = clean(r.get("Version"))
    if not version:
        continue
    cores = clean(r.get("Core Count"))
    threads = clean(r.get("Thread Count"))
    speed = clean(r.get("Current Speed")) or clean(r.get("Max Speed"))
    spec_bits = []
    if cores:
        spec_bits.append(f"{cores}コア")
    if threads:
        spec_bits.append(f"{threads}スレッド")
    if speed:
        spec_bits.append(speed)
    add(
        "CPU",
        version,
        normalize_maker(r.get("Manufacturer")),
        " / ".join(spec_bits),
        r.get("Serial Number"),
        r.get("Socket Designation", ""),
    )

# ---- メモリ（DIMMスロット単位） ----
for r in dmidecode_records("memory"):
    size = clean(r.get("Size"))
    if not size:
        continue
    mtype = clean(r.get("Type"))
    speed = clean(r.get("Speed"))
    form = clean(r.get("Form Factor"))
    maker = normalize_maker(r.get("Manufacturer"))
    partnum = clean(r.get("Part Number"))
    name = partnum or " ".join(filter(None, [mtype, size])) or size
    spec = " ".join(filter(None, [size.replace(" ", ""), mtype, speed, form]))
    add("メモリ", name, maker, spec, r.get("Serial Number"), r.get("Locator", ""))

# ---- マザーボード ----
for r in dmidecode_records("baseboard"):
    product = clean(r.get("Product Name"))
    if not product:
        continue
    add("マザーボード", product, normalize_maker(r.get("Manufacturer")), r.get("Version"), r.get("Serial Number"))

# ---- 電源(PSU) : 対応している一部サーバー機種のみ検出される ----
for r in dmidecode_records("39"):
    name = clean(r.get("Name")) or clean(r.get("Model Part Number"))
    if not name:
        continue
    add("電源(PSU)", name, normalize_maker(r.get("Manufacturer")), r.get("Max Power Capacity"), r.get("Serial Number"))

# ---- ストレージ ----
lsblk_out = run(["lsblk", "-dn", "-P", "-o", "NAME,MODEL,SERIAL,SIZE,TYPE,ROTA"])
for line in lsblk_out.splitlines():
    fields = dict(re.findall(r'(\w+)="([^"]*)"', line))
    if fields.get("TYPE") != "disk":
        continue
    if fields.get("SIZE", "0B") in ("0B", "0", ""):
        # メディア未挿入のカードリーダー等（内蔵SDカードリーダー等）はサイズ0で出てくるため除外
        continue
    dev = fields.get("NAME", "")
    kind = "HDD" if fields.get("ROTA") == "1" else ("NVMe" if dev.startswith("nvme") else "SSD")
    maker, model = split_storage_maker(fields.get("MODEL"))
    add(
        "ストレージ",
        model or dev,
        maker,
        f"{fields.get('SIZE', '')} {kind}".strip(),
        fields.get("SERIAL"),
        f"/dev/{dev}",
    )

# ---- 拡張カード類（GPU / NIC / RAIDカード） ----
PCI_CLASS_TO_CATEGORY = {
    "VGA compatible controller": "GPU",
    "3D controller": "GPU",
    "Ethernet controller": "NIC",
    "RAID bus controller": "RAIDカード",
    "Serial Attached SCSI controller": "RAIDカード",
    "Non-Volatile memory controller": None,  # ストレージ側(lsblk)で拾うため除外
}
for line in run(["lspci", "-mm"]).splitlines():
    m = re.match(r'^(\S+)\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"', line)
    if not m:
        continue
    slot, pci_class, vendor, device = m.groups()
    category = PCI_CLASS_TO_CATEGORY.get(pci_class)
    if not category:
        continue
    add(category, device, normalize_maker(vendor), pci_class, "", f"PCI {slot}")

# ---- ホスト情報 ----
sys_info = dmidecode_records("system")
host_summary = ""
if sys_info:
    s = sys_info[0]
    host_summary = (
        f"{clean(s.get('Manufacturer'))} {clean(s.get('Product Name'))} "
        f"(S/N: {clean(s.get('Serial Number')) or '不明'})"
    ).strip()


def push_report(base_url, token, server_name, hostname):
    """検出した構成を Dmidex へ送信する。反映はWeb画面で確認してから行う。"""
    payload = json.dumps({
        "server_name": server_name,
        "hostname": hostname,
        "host_info": host_summary,
        "parts": rows,
    }).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + "/api/sync/report",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("error", detail)
        except json.JSONDecodeError:
            pass
        print(f"送信に失敗しました (HTTP {err.code}): {detail}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as err:
        print(f"送信先に接続できませんでした: {err.reason}", file=sys.stderr)
        sys.exit(1)


if args.push:
    hostname = socket.gethostname()
    result = push_report(args.url, args.token, args.server or "", hostname)
    if result.get("needs_server"):
        print(f"{result.get('parts_count', len(rows))}件の構成を送信しました（対象サーバー未指定）。")
        print("  Web画面の「構成同期」タブでパーツを確認し、対象サーバーを選んで割り当ててください。")
    else:
        summary = result.get("summary", {})
        print(f"「{result.get('server')}」に{len(rows)}件の構成を送信しました。")
        print(
            f"  一致: {summary.get('matched', 0)}件 / 在庫から割り当て候補: {summary.get('to_assign', 0)}件 / "
            f"未登録: {summary.get('unregistered', 0)}件 / 取り外し候補: {summary.get('to_remove', 0)}件"
        )
        print("  Web画面の「構成同期」タブで内容を確認して反映してください。")
else:
    writer = csv.DictWriter(sys.stdout, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    if host_summary:
        print(f"# ホスト情報: {host_summary} / hostname={os.uname().nodename}", file=sys.stderr)
    print(f"# 検出件数: {len(rows)}件", file=sys.stderr)
