<#
.SYNOPSIS
    Dmidex 用のハードウェア検出スクリプト（Windows版）。

.DESCRIPTION
    Windowsに搭載されているパーツをCIM/WMIから検出し、Dmidex の
    「CSVから一括登録」で使えるCSVを出力する。-Push を付けると
    CSVを出さずに Dmidex へ構成を送信し、「構成同期」画面に差分を作る
    （送信しただけでは台帳は変更されない）。

    PowerShellはWindowsに標準搭載のため追加インストールは不要。
    シリアル番号の取得には管理者権限が必要な項目があるため、
    管理者として実行することを推奨する。

.EXAMPLE
    # 画面にCSVを表示する（そのままコピーして貼り付けられる）
    .\hw_to_csv.ps1

.EXAMPLE
    # CSVをファイルに保存する（Excelで開けるUTF-8 BOM付き）
    .\hw_to_csv.ps1 -OutFile parts.csv

.EXAMPLE
    # Dmidex へ構成を送信する
    .\hw_to_csv.ps1 -Push -Url https://dmidex.nuids.duckdns.org -Token <APIトークン> -Server win01
#>
[CmdletBinding()]
param(
    [switch]$Push,
    [string]$Url,
    [string]$Token,
    [string]$Server = $env:COMPUTERNAME,
    [string]$OutFile
)

if ($Push -and (-not $Url -or -not $Token)) {
    throw "-Push には -Url と -Token が必要です"
}

# dmidecode/WMIが返すベンダー表記を、アプリのメーカートグルと揃った短い表記に寄せる
$MakerAliases = @{
    'genuineintel'                     = 'Intel'
    'intel'                            = 'Intel'
    'intel corporation'                = 'Intel'
    'authenticamd'                     = 'AMD'
    'advanced micro devices, inc.'     = 'AMD'
    'amd'                              = 'AMD'
    'nvidia'                           = 'NVIDIA'
    'nvidia corporation'               = 'NVIDIA'
    'samsung'                          = 'Samsung'
    'micron'                           = 'Micron / Crucial'
    'micron technology'                = 'Micron / Crucial'
    'crucial'                          = 'Micron / Crucial'
    'sk hynix'                         = 'SK hynix'
    'hynix'                            = 'SK hynix'
    'kingston'                         = 'Kingston'
    'western digital'                  = 'Western Digital'
    'wdc'                              = 'Western Digital'
    'seagate'                          = 'Seagate'
    'kioxia'                           = 'Kioxia'
    'toshiba'                          = 'Kioxia'
    'realtek'                          = 'Realtek'
    'realtek semiconductor corp.'      = 'Realtek'
    'broadcom'                         = 'Broadcom'
}

# SMBIOSの数値コード（Win32_PhysicalMemory）
$MemoryTypes = @{
    20 = 'DDR'; 21 = 'DDR2'; 24 = 'DDR3'; 26 = 'DDR4'; 34 = 'DDR5'
    27 = 'LPDDR'; 28 = 'LPDDR2'; 29 = 'LPDDR3'; 30 = 'LPDDR4'; 35 = 'LPDDR5'
}
$FormFactors = @{ 8 = 'DIMM'; 12 = 'SODIMM'; 13 = 'SODIMM' }

# ストレージのモデル名は「メーカー名 + 型番」の形が多いので、先頭語で判定する
$StorageMakerPrefixes = @(
    'Samsung', 'WDC', 'WD', 'Seagate', 'Crucial', 'Kioxia', 'Toshiba',
    'Intel', 'Kingston', 'SanDisk', 'Hitachi', 'HGST', 'Micron', 'SK'
)

function Get-CleanValue($value) {
    if ($null -eq $value) { return '' }
    $text = ([string]$value).Trim()
    if ($text -eq '' -or $text -match '^(To Be Filled By O\.E\.M\.|Not Specified|None|Default string|Unknown)') { return '' }
    return $text
}

function Get-NormalizedMaker($value) {
    $text = Get-CleanValue $value
    if ($text -eq '') { return '' }
    $key = $text.ToLower()
    if ($MakerAliases.ContainsKey($key)) { return $MakerAliases[$key] }
    # 「Intel(R) Corporation」のように前方一致するものも拾う
    foreach ($alias in $MakerAliases.Keys) {
        if ($key.StartsWith($alias)) { return $MakerAliases[$alias] }
    }
    return $text
}

function Split-StorageMaker($model) {
    $text = Get-CleanValue $model
    if ($text -eq '') { return @('', '') }
    $head = ($text -split '\s+')[0]
    foreach ($prefix in $StorageMakerPrefixes) {
        if ($head -ieq $prefix) {
            $rest = $text.Substring($head.Length).Trim()
            return @((Get-NormalizedMaker $prefix), $(if ($rest) { $rest } else { $text }))
        }
    }
    return @('', $text)
}

$rows = New-Object System.Collections.ArrayList

function Add-Part($category, $name, $maker, $spec, $serial, $notes) {
    $cleanName = Get-CleanValue $name
    if ($cleanName -eq '') { return }
    [void]$rows.Add([ordered]@{
        category      = $category
        name          = $cleanName
        maker         = Get-NormalizedMaker $maker
        spec          = Get-CleanValue $spec
        serial_number = Get-CleanValue $serial
        status        = 'normal'
        purchase_date = ''
        notes         = Get-CleanValue $notes
    })
}

# ---- CPU ----
foreach ($cpu in Get-CimInstance Win32_Processor) {
    $specBits = @()
    if ($cpu.NumberOfCores) { $specBits += "$($cpu.NumberOfCores)コア" }
    if ($cpu.NumberOfLogicalProcessors) { $specBits += "$($cpu.NumberOfLogicalProcessors)スレッド" }
    if ($cpu.MaxClockSpeed) { $specBits += "$([math]::Round($cpu.MaxClockSpeed / 1000, 2))GHz" }
    Add-Part 'CPU' $cpu.Name $cpu.Manufacturer ($specBits -join ' / ') $cpu.SerialNumber $cpu.SocketDesignation
}

# ---- メモリ（DIMMスロット単位） ----
foreach ($mem in Get-CimInstance Win32_PhysicalMemory) {
    $sizeGB = [math]::Round($mem.Capacity / 1GB, 0)
    $type = $MemoryTypes[[int]$mem.SMBIOSMemoryType]
    $form = $FormFactors[[int]$mem.FormFactor]
    $specBits = @("${sizeGB}GB")
    if ($type) { $specBits += $type }
    if ($mem.Speed) { $specBits += "$($mem.Speed)MT/s" }
    if ($form) { $specBits += $form }
    $name = Get-CleanValue $mem.PartNumber
    if ($name -eq '') { $name = (@($type, "${sizeGB}GB") | Where-Object { $_ }) -join ' ' }
    Add-Part 'メモリ' $name $mem.Manufacturer ($specBits -join ' ') $mem.SerialNumber $mem.DeviceLocator
}

# ---- マザーボード ----
foreach ($board in Get-CimInstance Win32_BaseBoard) {
    Add-Part 'マザーボード' $board.Product $board.Manufacturer $board.Version $board.SerialNumber ''
}

# ---- ストレージ ----
$physicalDisks = @()
try { $physicalDisks = Get-PhysicalDisk -ErrorAction Stop } catch { $physicalDisks = @() }
foreach ($disk in Get-CimInstance Win32_DiskDrive) {
    $sizeGB = [math]::Round($disk.Size / 1GB, 1)
    # MediaType(HDD/SSD)はGet-PhysicalDiskの方が正確なので、取れる場合はそちらを使う
    $match = $physicalDisks | Where-Object { $_.SerialNumber -and $disk.SerialNumber -and $_.SerialNumber.Trim() -eq $disk.SerialNumber.Trim() } | Select-Object -First 1
    $kind = if ($match -and $match.MediaType -and $match.MediaType -ne 'Unspecified') { $match.MediaType } else { $disk.InterfaceType }
    if ($match -and $match.BusType -eq 'NVMe') { $kind = 'NVMe' }
    $maker, $model = Split-StorageMaker $disk.Model
    Add-Part 'ストレージ' $model $maker "${sizeGB}GB $kind".Trim() $disk.SerialNumber $disk.DeviceID
}

# ---- GPU ----
# 仮想ディスプレイドライバも列挙されるため、PCI接続の実デバイスだけに絞る
foreach ($gpu in Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -like 'PCI\*' }) {
    $spec = ''
    # AdapterRAMは4GB超で正しく取れないことがあるため、妥当な値のときだけ載せる
    if ($gpu.AdapterRAM -gt 0) { $spec = "VRAM $([math]::Round($gpu.AdapterRAM / 1GB, 0))GB" }
    Add-Part 'GPU' $gpu.Name $gpu.AdapterCompatibility $spec '' ''
}

# ---- NIC（物理アダプタのみ） ----
$netAdapters = @()
try { $netAdapters = Get-NetAdapter -Physical -ErrorAction Stop } catch { $netAdapters = @() }
foreach ($nic in $netAdapters) {
    # Get-NetAdapterにベンダー欄が無いので、説明の先頭語からメーカーを推定する
    $maker = Get-NormalizedMaker (($nic.InterfaceDescription -split '\s+')[0])
    Add-Part 'NIC' $nic.InterfaceDescription $maker $nic.LinkSpeed '' $nic.Name
}

# ---- ホスト情報 ----
$system = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$hostInfo = "$(Get-CleanValue $system.Manufacturer) $(Get-CleanValue $system.Model) (S/N: $(if (Get-CleanValue $bios.SerialNumber) { Get-CleanValue $bios.SerialNumber } else { '不明' }))".Trim()

# ---- 出力 ----
if ($Push) {
    $payload = @{
        server_name = $Server
        host_info   = $hostInfo
        parts       = @($rows | ForEach-Object { [PSCustomObject]$_ })
    } | ConvertTo-Json -Depth 5

    try {
        # PowerShell 5.1では文字列のままだと日本語が壊れるのでUTF-8バイト列で送る
        $response = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + '/api/sync/report') -Method Post `
            -ContentType 'application/json; charset=utf-8' `
            -Headers @{ Authorization = "Bearer $Token" } `
            -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    } catch {
        $message = $_.Exception.Message
        if ($_.ErrorDetails.Message) {
            try { $message = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { $message = $_.ErrorDetails.Message }
        }
        Write-Error "送信に失敗しました: $message"
        exit 1
    }

    Write-Host "「$($response.server)」に$($rows.Count)件の構成を送信しました。"
    Write-Host ("  一致: {0}件 / 在庫から割り当て候補: {1}件 / 未登録: {2}件 / 取り外し候補: {3}件" -f `
        $response.summary.matched, $response.summary.to_assign, $response.summary.unregistered, $response.summary.to_remove)
    Write-Host "  Web画面の「構成同期」タブで内容を確認して反映してください。"
}
else {
    $csv = @($rows | ForEach-Object { [PSCustomObject]$_ }) | ConvertTo-Csv -NoTypeInformation
    if ($OutFile) {
        # ExcelがUTF-8と判別できるようBOM付きで書き出す
        [IO.File]::WriteAllText($OutFile, ($csv -join "`r`n"), (New-Object Text.UTF8Encoding($true)))
        Write-Host "$OutFile に$($rows.Count)件を書き出しました。"
    }
    else {
        $csv
    }
    Write-Host "# ホスト情報: $hostInfo / hostname=$env:COMPUTERNAME" -ForegroundColor DarkGray
    Write-Host "# 検出件数: $($rows.Count)件" -ForegroundColor DarkGray
}
