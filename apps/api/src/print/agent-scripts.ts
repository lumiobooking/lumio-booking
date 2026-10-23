import { createHash } from 'crypto';

/*
 * The two PowerShell scripts of the one-touch printer setup, served by the API
 * (so every shop runs the version that matches the server, and the agent
 * updates itself when this file changes).
 *
 * Rules for editing: ASCII only (Windows PowerShell 5.1 reads files in the
 * machine's code page), no backticks and no dollar-brace (this is a JS
 * template string). Windows ships PowerShell 5.1 and System.Drawing, so a shop
 * needs nothing installed.
 */

const AGENT = String.raw`# Lumio Print agent (installed by the one-line setup; updates itself).
$Version = '__VERSION__'
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}
$Dir = Split-Path -Parent $PSCommandPath
$Cfg = Get-Content -Raw -Path (Join-Path $Dir 'config.json') | ConvertFrom-Json
$Api = [string]$Cfg.api
$Headers = @{ 'X-Lumio-Device' = [string]$Cfg.token }
Add-Type -AssemblyName System.Drawing
$Mutex = New-Object System.Threading.Mutex($false, 'Local\LumioPrintAgent')
if (-not $Mutex.WaitOne(0)) { exit }
$LogFile = Join-Path $Dir 'agent.log'
$script:FontName = 'Consolas'
try {
  $fams = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
  if ($fams -notcontains 'Consolas') { $script:FontName = 'Courier New' }
} catch {}

function Write-Log([string]$m) {
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1048576)) { Remove-Item $LogFile -Force }
    Add-Content -Path $LogFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m)
  } catch {}
}

function Send-Json([string]$path, $obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method Post -Uri ($Api + $path) -Headers $Headers -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 20
}

function Get-PrinterInfo {
  $list = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
  $def = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
  return @{ name = $env:COMPUTERNAME; printers = $list; defaultPrinter = [string]$def; version = $Version }
}

function Invoke-GdiPrint($rows, [string]$printer, [int]$cols) {
  $script:PsRows = @($rows)
  $script:PsIndex = 0
  $script:PsCols = [Math]::Max(16, [Math]::Min(64, $cols))
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.DocumentName = 'Lumio'
  if ($printer) { $doc.PrinterSettings.PrinterName = $printer }
  if (-not $doc.PrinterSettings.IsValid) { throw ('Khong thay may in: ' + $printer) }
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false
  $doc.add_PrintPage({
    param($src, $e)
    $g = $e.Graphics
    $area = $e.PageSettings.PrintableArea
    $W = [single]$area.Width
    if ($W -lt 50) { $W = [single]$e.PageBounds.Width }
    $H = [single]$area.Height
    if ($H -lt 50) { $H = [single]$e.PageBounds.Height }
    $W = [single]($W - 4)
    $typo = [System.Drawing.StringFormat]::GenericTypographic
    $probe = New-Object System.Drawing.Font($script:FontName, [single]10)
    $w10 = $g.MeasureString(('M' * $script:PsCols), $probe, [int]100000, $typo).Width
    $size = [single][Math]::Max(6, [Math]::Min(18, 10 * $W / [Math]::Max(1, $w10)))
    $normal = New-Object System.Drawing.Font($script:FontName, $size)
    $bold = New-Object System.Drawing.Font($script:FontName, [single]($size * 1.2), [System.Drawing.FontStyle]::Bold)
    $huge = New-Object System.Drawing.Font($script:FontName, [single]($size * 2), [System.Drawing.FontStyle]::Bold)
    $y = [single]0
    while ($script:PsIndex -lt $script:PsRows.Count) {
      $row = $script:PsRows[$script:PsIndex]
      $role = [string]$row.r
      $text = [string]$row.t
      $font = $normal
      if ($role -ceq 'b') { $font = $bold }
      if ($role -ceq 'h') { $font = $huge }
      $sf = New-Object System.Drawing.StringFormat($typo)
      $sf.FormatFlags = $sf.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
      if ($role -ceq 'h') { $text = $text.Trim(); $sf.Alignment = [System.Drawing.StringAlignment]::Center }
      $measure = $text
      if ($measure.Length -eq 0) { $measure = ' ' }
      $box = New-Object System.Drawing.SizeF($W, [single]100000)
      $h = [single][Math]::Max($g.MeasureString($measure, $font, $box, $sf).Height, $font.GetHeight($g))
      if ($y -gt 0 -and ($y + $h) -gt $H) { $e.HasMorePages = $true; return }
      $rect = New-Object System.Drawing.RectangleF([single]0, $y, $W, $h)
      $g.DrawString($text, $font, [System.Drawing.Brushes]::Black, $rect, $sf)
      $y = [single]($y + $h)
      $script:PsIndex = $script:PsIndex + 1
    }
    $e.HasMorePages = $false
  })
  try { $doc.Print() } finally { $doc.Dispose() }
}

# Raw bytes to a Windows printer (the cash drawer pulse goes through the
# printer it is plugged into). Compiled once; without it only the drawer stays shut.
$RawSrc = @'
using System;
using System.Runtime.InteropServices;
public static class LumioRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter " + Marshal.GetLastWin32Error());
    try {
      DocInfo di = new DocInfo();
      di.pDocName = "Lumio";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw new Exception("WritePrinter " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
$script:RawReady = $false
try { Add-Type -TypeDefinition $RawSrc -Language CSharp; $script:RawReady = $true } catch { Write-Log ('raw printing unavailable: ' + $_) }

function Send-Kick([string]$printer) {
  if (-not $script:RawReady) { throw 'Khong mo duoc ket tien (thieu RAW)' }
  $name = $printer
  if (-not $name) { $name = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName }
  [LumioRaw]::Send($name, [byte[]](27, 112, 0, 25, 250, 27, 112, 1, 25, 250))
}

function Invoke-TextPrint([string]$text, [string]$printer) {
  if ($printer) { $text | Out-Printer -Name $printer } else { $text | Out-Printer }
}

function Send-Raw([string]$hostName, [int]$port, [string]$b64) {
  $bytes = [Convert]::FromBase64String($b64)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $ar = $client.BeginConnect($hostName, $port, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne(6000)) { throw ('May in mang ' + $hostName + ' khong tra loi') }
    $client.EndConnect($ar)
    $stream = $client.GetStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    Start-Sleep -Milliseconds 300
  } finally { $client.Close() }
}

function Remove-Autostart {
  try { Remove-Item -Force -ErrorAction SilentlyContinue -Path (Join-Path ([Environment]::GetFolderPath('Startup')) 'Lumio Print.lnk') } catch {}
}

function Update-Self {
  try {
    $wc = New-Object Net.WebClient
    $wc.Encoding = [Text.Encoding]::UTF8
    $new = $wc.DownloadString($Api + '/print-agent/agent.ps1')
    if ($new -notmatch 'Lumio Print agent') { return }
    Set-Content -Path $PSCommandPath -Value $new -Encoding UTF8
    Write-Log 'updated, restarting'
    $Mutex.ReleaseMutex()
    Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"') -WindowStyle Hidden
    exit
  } catch { Write-Log ('update failed: ' + $_) }
}

Write-Log ('start ' + $Version)
$lastHello = [DateTime]::MinValue
while ($true) {
  try {
    if (((Get-Date) - $lastHello).TotalMinutes -ge 2) { [void](Send-Json '/print-agent/hello' (Get-PrinterInfo)); $lastHello = Get-Date }
    $r = Invoke-RestMethod -Uri ($Api + '/print-agent/jobs') -Headers $Headers -TimeoutSec 20
    foreach ($j in @($r.jobs)) {
      if (-not $j) { continue }
      $ok = $true
      $err = ''
      try {
        if ($j.drawerOnly) {
          if ($j.raw) { Send-Raw ([string]$j.host) ([int]$j.port) ([string]$j.raw) } else { Send-Kick ([string]$j.printer) }
        } else {
          $n = [Math]::Max(1, [int]$j.copies)
          for ($k = 0; $k -lt $n; $k++) {
            if ($j.raw) { Send-Raw ([string]$j.host) ([int]$j.port) ([string]$j.raw) }
            else {
              try { Invoke-GdiPrint $j.rows ([string]$j.printer) ([int]$j.cols) }
              catch { Write-Log ('gdi: ' + $_); Invoke-TextPrint ([string]$j.text) ([string]$j.printer) }
            }
          }
          if ($j.kick -and -not $j.raw) { try { Send-Kick ([string]$j.printer) } catch { Write-Log ('drawer: ' + $_) } }
        }
      } catch { $ok = $false; $err = [string]$_; Write-Log ('job ' + $j.id + ': ' + $err) }
      try { [void](Send-Json ('/print-agent/jobs/' + $j.id + '/result') @{ ok = $ok; error = $err }) } catch {}
    }
    if ($r.version -and ($r.version -ne $Version)) { Update-Self }
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 401) { Write-Log 'this computer was removed in Lumio; stopping'; Remove-Autostart; exit }
    Write-Log ('poll: ' + $_)
    Start-Sleep -Seconds 10
  }
  Start-Sleep -Seconds 3
}
`;

const INSTALL = String.raw`# Lumio Print setup (one time, one shop).
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}
$Api = '__API__'
$Code = '__CODE__'
Write-Host ''
Write-Host '  Lumio Print - dang cai dat...' -ForegroundColor Cyan
Add-Type -AssemblyName System.Drawing
$printers = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
$default = [string](New-Object System.Drawing.Printing.PrinterSettings).PrinterName
$body = @{ code = $Code; name = $env:COMPUTERNAME; printers = $printers; defaultPrinter = $default } | ConvertTo-Json -Compress
try {
  $r = Invoke-RestMethod -Method Post -Uri ($Api + '/print-agent/pair') -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
} catch {
  Write-Host ''
  Write-Host '  Ma cai dat da het han hoac da dung roi.' -ForegroundColor Red
  Write-Host '  Vao Lumio > Cai dat > Hoa don in > May in, bam "Them may tinh" de lay lenh moi.'
  Read-Host '  Bam Enter de dong'
  exit 1
}
$dir = Join-Path $env:LOCALAPPDATA 'LumioPrint'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
try {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*LumioPrint*agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
@{ api = $Api; token = [string]$r.token } | ConvertTo-Json | Set-Content -Path (Join-Path $dir 'config.json') -Encoding UTF8
$wc = New-Object Net.WebClient
$wc.Encoding = [Text.Encoding]::UTF8
$agent = $wc.DownloadString($Api + '/print-agent/agent.ps1')
Set-Content -Path (Join-Path $dir 'agent.ps1') -Value $agent -Encoding UTF8
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$runArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'agent.ps1') + '"'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Lumio Print.lnk'))
$lnk.TargetPath = $ps
$lnk.Arguments = $runArgs
$lnk.WindowStyle = 7
$lnk.Description = 'Lumio Print'
$lnk.Save()
Start-Process -FilePath $ps -ArgumentList $runArgs -WindowStyle Hidden
Write-Host ''
Write-Host ('  Da cai xong! May tinh: ' + $env:COMPUTERNAME) -ForegroundColor Green
if ($printers.Count -gt 0) { Write-Host ('  May in tim thay: ' + ($printers -join ', ')) }
else { Write-Host '  Chua thay may in nao. Hay cai driver may in, Lumio se tu thay sau vai phut.' -ForegroundColor Yellow }
Write-Host '  Lumio Print chay ngam va tu bat moi khi mo may. Ban co the dong cua so nay.'
Write-Host ''
Read-Host '  Bam Enter de dong'
`;

const GONE = String.raw`Write-Host ''
Write-Host '  Lenh cai dat nay da het han hoac da dung roi.' -ForegroundColor Red
Write-Host '  Vao Lumio > Cai dat > Hoa don in > May in, bam "Them may tinh" de lay lenh moi.'
Write-Host ''
Read-Host '  Bam Enter de dong'
`;

/** Changes whenever the agent script changes; a running agent that sees a new one updates itself. */
export const AGENT_VERSION = createHash('sha256').update(AGENT).digest('hex').slice(0, 12);

export function agentScript(): string {
  return AGENT.replace('__VERSION__', AGENT_VERSION);
}

/** The setup script for one code. Only the API address and the code are filled in, both checked. */
export function installScript(api: string, code: string): string {
  if (!/^https?:\/\/[A-Za-z0-9.:-]+(\/[A-Za-z0-9._-]+)*$/.test(api)) throw new Error('bad api base');
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error('bad code');
  return INSTALL.replace('__API__', api).replace('__CODE__', code);
}

export function goneScript(): string {
  return GONE;
}
