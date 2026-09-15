#!/usr/bin/env python3
"""
Proxmox（や一般のLinuxホスト）に搭載されているパーツを検出し、
server-parts-inventory の「CSVから一括登録」でそのまま使える
CSV形式で標準出力に書き出す。

使い方:
    sudo python3 hw_to_csv.py > parts.csv

追加インストール不要（Python3 / dmidecode / lsblk / lspci は
Proxmox / Debian に標準で入っている）。dmidecode の読み取りに
root権限が必要なため sudo で実行すること。
"""
import csv
import os
import re
import subprocess
import sys


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


rows = []


def add(category, name, maker, spec, serial, notes=""):
    name = clean(name)
    if not name:
        return
    rows.append([category, name, clean(maker), clean(spec), clean(serial), "normal", "", notes])


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

# ---- 出力 ----
writer = csv.writer(sys.stdout, lineterminator="\n")
writer.writerow(["category", "name", "maker", "spec", "serial_number", "status", "purchase_date", "notes"])
writer.writerows(rows)

# ホスト自体の情報は参考としてstderrへ（サーバー登録名の参考用。CSVには含めない）
sys_info = dmidecode_records("system")
if sys_info:
    s = sys_info[0]
    print(
        f"# ホスト情報: {clean(s.get('Manufacturer'))} {clean(s.get('Product Name'))} "
        f"(S/N: {clean(s.get('Serial Number')) or '不明'}) / hostname={os.uname().nodename}",
        file=sys.stderr,
    )
print(f"# 検出件数: {len(rows)}件", file=sys.stderr)

if os.geteuid() != 0:
    print(
        "# 警告: root権限で実行していません。CPU/メモリ等の情報が取得できていない可能性があります。"
        " sudo python3 hw_to_csv.py で再実行してください。",
        file=sys.stderr,
    )
