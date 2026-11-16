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
# Windows allows 2 open connections per server by default; a reply never closed used one up for good.
try { [Net.ServicePointManager]::DefaultConnectionLimit = 16 } catch {}
$Dir = Split-Path -Parent $PSCommandPath
$Cfg = Get-Content -Raw -Path (Join-Path $Dir 'config.json') | ConvertFrom-Json
$Api = [string]$Cfg.api
$Headers = @{ 'X-Lumio-Device' = [string]$Cfg.token }
Add-Type -AssemblyName System.Drawing
$Mutex = New-Object System.Threading.Mutex($false, 'Local\LumioPrintAgent')
# A copy that was stopped by force leaves the lock "abandoned": that is ours to take, not a reason to quit.
$got = $false
try { $got = $Mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $got = $true }
if (-not $got) { exit }
$LogFile = Join-Path $Dir 'agent.log'
$BeatFile = Join-Path $Dir 'heartbeat.txt'
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

# Every call to the server: a hard time limit on connecting AND on reading,
# no kept-alive connections, and the reply always closed. Invoke-RestMethod
# (Windows PowerShell 5.1) could wait forever on a connection that died (Wi-Fi
# dropped, the PC slept) and leaked connections until none were left: the
# agent looked alive but never printed again until the PC was restarted.
function Invoke-Api([string]$method, [string]$path, [string]$json, [int]$timeoutSec) {
  $req = [System.Net.HttpWebRequest]::Create($Api + $path)
  $req.Method = $method
  $req.Timeout = $timeoutSec * 1000
  $req.ReadWriteTimeout = $timeoutSec * 1000
  $req.KeepAlive = $false
  $req.Headers.Add('X-Lumio-Device', [string]$Cfg.token)
  if ($json) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $req.ContentType = 'application/json; charset=utf-8'
    $req.ContentLength = $bytes.Length
    $rs = $req.GetRequestStream()
    try { $rs.Write($bytes, 0, $bytes.Length) } finally { $rs.Close() }
  }
  $resp = $null
  $body = ''
  try {
    $resp = $req.GetResponse()
    $rd = New-Object System.IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    try { $body = $rd.ReadToEnd() } finally { $rd.Close() }
  } finally { if ($resp) { $resp.Close() } }
  if (-not $body) { return $null }
  return ($body | ConvertFrom-Json)
}

function Send-Json([string]$path, $obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  return Invoke-Api 'POST' $path $json 20
}

# The HTTP status of a failed call (0 = no answer at all).
function Get-StatusCode($err) {
  $ex = $err.Exception
  while ($ex) {
    try { if ($ex.Response) { return [int]$ex.Response.StatusCode } } catch {}
    $ex = $ex.InnerException
  }
  return 0
}

# "I am alive" for the watchdog: written on every round of the loop.
function Write-Beat {
  try { [IO.File]::WriteAllText($BeatFile, (Get-Date -Format 'o')) } catch {}
}

# The watchdog: Windows Task Scheduler runs a tiny script every 2 minutes and
# at sign-in. If this agent has not written its heartbeat for 4 minutes (hung,
# crashed, or the PC woke from sleep) it is stopped and started again - no
# restart of the PC, no reinstall. A .vbs, so no window ever flashes.
$WatchdogVbs = @'
' Lumio Print watchdog - restarts the print agent when it stops answering.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
agent = dir & "\agent.ps1"
If Not fso.FileExists(agent) Then WScript.Quit
If Not fso.FileExists(dir & "\config.json") Then WScript.Quit
beat = dir & "\heartbeat.txt"
If fso.FileExists(beat) Then
  If DateDiff("s", fso.GetFile(beat).DateLastModified, Now) < 240 Then WScript.Quit
End If
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
For Each p In wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='powershell.exe'")
  If Not IsNull(p.CommandLine) Then
    If InStr(1, p.CommandLine, "LumioPrint\agent.ps1", 1) > 0 Then p.Terminate
  End If
Next
WScript.Sleep 1500
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & agent & """", 0, False
'@

function Ensure-Watchdog {
  try {
    $vbs = Join-Path $Dir 'watchdog.vbs'
    Set-Content -Path $vbs -Value $WatchdogVbs -Encoding ASCII
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $td = $svc.NewTask(0)
    $td.RegistrationInfo.Description = 'Lumio Print - keeps the print agent running'
    $td.Settings.Enabled = $true
    $td.Settings.Hidden = $true
    $td.Settings.StartWhenAvailable = $true
    $td.Settings.DisallowStartIfOnBatteries = $false
    $td.Settings.StopIfGoingOnBatteries = $false
    $td.Settings.ExecutionTimeLimit = 'PT5M'
    $td.Settings.MultipleInstances = 2
    $td.Principal.LogonType = 3
    $tt = $td.Triggers.Create(1)
    $tt.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
    $tt.Repetition.Interval = 'PT2M'
    $tl = $td.Triggers.Create(9)
    $tl.UserId = [Environment]::UserDomainName + '\' + [Environment]::UserName
    $tl.Delay = 'PT1M'
    $act = $td.Actions.Create(0)
    $act.Path = 'wscript.exe'
    $act.Arguments = '//B //Nologo "' + $vbs + '"'
    [void]$svc.GetFolder('\').RegisterTaskDefinition('LumioPrintWatchdog', $td, 6, $null, $null, 3)
    Write-Log 'watchdog ready'
  } catch { Write-Log ('watchdog: ' + $_) }
}

function Get-PrinterInfo {
  $list = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
  $def = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
  return @{ name = $env:COMPUTERNAME; printers = $list; defaultPrinter = [string]$def; version = $Version }
}

function Pick-Font([string]$name) {
  try {
    $fams = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
    foreach ($f in @($name, 'Arial', 'Segoe UI', 'Microsoft Sans Serif')) { if ($f -and ($fams -contains $f)) { return $f } }
  } catch {}
  return 'Arial'
}

# Draws one ticket like the bill designer's preview: a normal font, the shop
# name and title large, rules as dashed lines, centred lines centred, amounts
# pinned to the right edge, the total bold, the table huge on kitchen tickets.
#
# The paper is cut to the ticket's own length: many thermal drivers default
# to a very long page (e.g. 80 x 3276 mm), and the printer then feeds the
# whole page - a metre of blank paper after a short bill (Nau Chill, 10/11).
# So the ticket is measured first and the page made exactly that long.
function Layout-Ticket($g, [single]$W, [single]$H, [bool]$draw) {
  $fam = $script:PsFamily
  $sz = [single]$script:PsSize
  $fN = New-Object System.Drawing.Font($fam, $sz)
  $fB = New-Object System.Drawing.Font($fam, [single]($sz * 1.15), [System.Drawing.FontStyle]::Bold)
  $fT = New-Object System.Drawing.Font($fam, [single]($sz * 1.5), [System.Drawing.FontStyle]::Bold)
  $fH = New-Object System.Drawing.Font($fam, [single]($sz * 2.1), [System.Drawing.FontStyle]::Bold)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single]1)
  $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
  $ink = [System.Drawing.Brushes]::Black
  $gap = [single]($fN.GetHeight($g) * 0.15)
  $y = [single]0
  # Every font, pen and string format is given back to Windows: they were not,
  # and after a few hundred tickets Windows refused to draw any more
  # ("A generic error occurred in GDI+") until the PC was restarted.
  $sfs = New-Object System.Collections.ArrayList
  try {
  while ($script:PsIndex -lt $script:PsRows.Count) {
    $row = $script:PsRows[$script:PsIndex]
    $role = [string]$row.r
    $text = ([string]$row.t).TrimEnd()
    if ($role -ceq 'q') {
      $qm = @($row.m)
      $qn = $qm.Count
      if ($qn -gt 0) {
        $side = [single][Math]::Min($W * 0.62, 170)
        $cell = [single]($side / $qn)
        $x0 = [single](($W - $side) / 2)
        $h = [single]($side + $gap * 4)
        if ($y -gt 0 -and ($y + $h) -gt $H) { return @{ y = $y; more = $true } }
        $top = [single]($y + $gap * 2)
        if ($draw) {
          for ($qy = 0; $qy -lt $qn; $qy++) {
            $line = [string]$qm[$qy]
            $qx = 0
            while ($qx -lt $line.Length) {
              if ($line[$qx] -ne '1') { $qx++; continue }
              $qe = $qx
              while ($qe -lt $line.Length -and $line[$qe] -eq '1') { $qe++ }
              $g.FillRectangle($ink, [single]($x0 + $qx * $cell), [single]($top + $qy * $cell), [single](($qe - $qx) * $cell + 0.3), [single]($cell + 0.3))
              $qx = $qe
            }
          }
        }
        $y = [single]($y + $h)
      }
      $script:PsIndex = $script:PsIndex + 1
      continue
    }
    if ($role -ceq 's') {
      $h = [single]($fN.GetHeight($g) * 0.8)
      if ($y -gt 0 -and ($y + $h) -gt $H) { return @{ y = $y; more = $true } }
      $mid = [single]($y + $h / 2)
      if ($draw) { $g.DrawLine($pen, [single]0, $mid, $W, $mid) }
      $y = [single]($y + $h)
      $script:PsIndex = $script:PsIndex + 1
      continue
    }
    $font = $fN
    if ($role -ceq 'b') { $font = $fB }
    if ($role -ceq 't') { $font = $fT }
    if ($role -ceq 'h') { $font = $fH }
    $sf = New-Object System.Drawing.StringFormat
    [void]$sfs.Add($sf)
    $right = ''
    if ($row.c) { $text = $text.Trim(); $sf.Alignment = [System.Drawing.StringAlignment]::Center }
    elseif ($row.a) {
      $right = [string]$row.a
      if ($text.EndsWith($right)) { $text = $text.Substring(0, $text.Length - $right.Length).TrimEnd() }
    }
    $leftW = $W
    if ($right) { $leftW = [single][Math]::Max(40, $W - $g.MeasureString($right, $font).Width - 4) }
    $measure = $text
    if ($measure.Length -eq 0) { $measure = ' ' }
    $box = New-Object System.Drawing.SizeF($leftW, [single]100000)
    $h = [single]([Math]::Max($g.MeasureString($measure, $font, $box, $sf).Height, $font.GetHeight($g)) + $gap)
    if ($y -gt 0 -and ($y + $h) -gt $H) { return @{ y = $y; more = $true } }
    if ($draw) {
      $g.DrawString($text, $font, $ink, (New-Object System.Drawing.RectangleF([single]0, $y, $leftW, $h)), $sf)
      if ($right) {
        $sfr = New-Object System.Drawing.StringFormat
        [void]$sfs.Add($sfr)
        $sfr.Alignment = [System.Drawing.StringAlignment]::Far
        $g.DrawString($right, $font, $ink, (New-Object System.Drawing.RectangleF([single]0, $y, $W, $h)), $sfr)
      }
    }
    $y = [single]($y + $h)
    $script:PsIndex = $script:PsIndex + 1
  }
  return @{ y = $y; more = $false }
  } finally {
    foreach ($o in $sfs) { try { $o.Dispose() } catch {} }
    foreach ($o in @($fN, $fB, $fT, $fH, $pen)) { try { $o.Dispose() } catch {} }
  }
}

# The width the ticket is drawn on, in 1/100 inch.
function Ticket-Width([single]$W) {
  if ($script:PsMaxW -gt 50 -and $W -gt $script:PsMaxW) { $W = [single]$script:PsMaxW }
  return [single]($W - 6)
}

function Invoke-GdiPrint($rows, [string]$printer, [int]$maxWidth, [string]$fontName, [double]$baseSize) {
  $script:PsRows = @($rows)
  $script:PsIndex = 0
  $script:PsMaxW = $maxWidth
  $script:PsFamily = Pick-Font $fontName
  $script:PsSize = $baseSize
  if ($script:PsSize -lt 6) { $script:PsSize = 10 }
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.DocumentName = 'Lumio'
  if ($printer) { $doc.PrinterSettings.PrinterName = $printer }
  if (-not $doc.PrinterSettings.IsValid) { throw ('Khong thay may in: ' + $printer) }
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false
  # Measure the whole ticket, then make the page exactly that long (plus room
  # for the cutter). A driver that ignores custom sizes prints as before.
  try {
    $mg = $doc.PrinterSettings.CreateMeasurementGraphics($doc.DefaultPageSettings)
    try {
      $pw = [single]$doc.DefaultPageSettings.PrintableArea.Width
      if ($pw -lt 50) { $pw = [single]$doc.DefaultPageSettings.PaperSize.Width }
      $script:PsIndex = 0
      $m = Layout-Ticket $mg (Ticket-Width $pw) ([single]1000000) $false
      $script:PsIndex = 0
      $paperW = [int]$doc.DefaultPageSettings.PaperSize.Width
      if ($paperW -lt 100) { $paperW = 315 }
      $paperH = [int][Math]::Ceiling([double]$m.y + 60)
      if ($paperH -lt 150) { $paperH = 150 }
      $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Lumio', $paperW, $paperH)
    } finally { $mg.Dispose() }
  } catch { Write-Log ('measure: ' + $_); $script:PsIndex = 0 }
  $doc.add_PrintPage({
    param($src, $e)
    $g = $e.Graphics
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $area = $e.PageSettings.PrintableArea
    $W = [single]$area.Width
    if ($W -lt 50) { $W = [single]$e.PageBounds.Width }
    $vis = [single]$g.VisibleClipBounds.Width
    if ($vis -gt 50 -and $vis -lt $W) { $W = $vis }
    $H = [single]$area.Height
    if ($H -lt 50) { $H = [single]$e.PageBounds.Height }
    $r = Layout-Ticket $g (Ticket-Width $W) $H $true
    $e.HasMorePages = [bool]$r.more
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
  try { $svc = New-Object -ComObject Schedule.Service; $svc.Connect(); $svc.GetFolder('\').DeleteTask('LumioPrintWatchdog', 0) } catch {}
  try { Remove-Item -Force -ErrorAction SilentlyContinue -Path $BeatFile } catch {}
}

function Update-Self {
  try {
    $req = [System.Net.HttpWebRequest]::Create($Api + '/print-agent/agent.ps1')
    $req.Timeout = 30000
    $req.ReadWriteTimeout = 30000
    $req.KeepAlive = $false
    $resp = $req.GetResponse()
    try { $rd = New-Object System.IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8); $new = $rd.ReadToEnd(); $rd.Close() } finally { $resp.Close() }
    if ($new -notmatch 'Lumio Print agent') { return }
    Set-Content -Path $PSCommandPath -Value $new -Encoding UTF8
    Write-Log 'updated, restarting'
    $Mutex.ReleaseMutex()
    Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"') -WindowStyle Hidden
    exit
  } catch { Write-Log ('update failed: ' + $_) }
}

Write-Log ('start ' + $Version)
Write-Beat
Ensure-Watchdog
$lastHello = [DateTime]::MinValue
$gone = 0
while ($true) {
  Write-Beat
  try {
    if (((Get-Date) - $lastHello).TotalMinutes -ge 2) { [void](Send-Json '/print-agent/hello' (Get-PrinterInfo)); $lastHello = Get-Date }
    $asked = Get-Date
    # Long poll: the server answers the moment a ticket arrives (or after 25 s with nothing).
    $r = Invoke-Api 'GET' '/print-agent/jobs?wait=25' '' 45
    $gone = 0
    if (-not $r) { Start-Sleep -Seconds 2; continue }
    $jobs = @($r.jobs)
    foreach ($j in $jobs) {
      if (-not $j) { continue }
      $ok = $true
      $err = ''
      try {
        if ($j.drawerOnly) {
          if ($j.raw) { Send-Raw ([string]$j.host) ([int]$j.port) ([string]$j.raw) } else { Send-Kick ([string]$j.printer) }
        } else {
          # Cash sale: open the drawer first, the cashier counts the change while the bill prints.
          if ($j.kick -and -not $j.raw) { try { Send-Kick ([string]$j.printer) } catch { Write-Log ('drawer: ' + $_) } }
          $n = [Math]::Max(1, [int]$j.copies)
          for ($k = 0; $k -lt $n; $k++) {
            if ($j.raw) { Send-Raw ([string]$j.host) ([int]$j.port) ([string]$j.raw) }
            else {
              try { Invoke-GdiPrint $j.rows ([string]$j.printer) ([int]$j.maxWidth) ([string]$j.font) ([double]$j.size) }
              catch { Write-Log ('gdi: ' + $_); Invoke-TextPrint ([string]$j.text) ([string]$j.printer) }
            }
          }
        }
      } catch { $ok = $false; $err = [string]$_; Write-Log ('job ' + $j.id + ': ' + $err) }
      try { [void](Send-Json ('/print-agent/jobs/' + $j.id + '/result') @{ ok = $ok; error = $err }) } catch {}
      Write-Beat
    }
    if ($r.version -and ($r.version -ne $Version)) { Update-Self }
    # An old server answers at once: do not spin.
    if ($jobs.Count -eq 0 -and ((Get-Date) - $asked).TotalSeconds -lt 2) { Start-Sleep -Seconds 2 }
  } catch {
    $code = Get-StatusCode $_
    # Removed in Lumio (or reconnected with a new code): stop for good - but
    # only after three refusals in a row, never on one odd answer.
    if ($code -eq 401) { $gone++ } else { $gone = 0 }
    if ($gone -ge 3) { Write-Log 'this computer was removed in Lumio; stopping'; Remove-Autostart; exit }
    Write-Log ('poll: ' + $code + ' ' + $_)
    Start-Sleep -Seconds 5
  }
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
