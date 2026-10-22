# Lumio Print: draws one ticket with a Windows font, so Vietnamese accents print
# correctly, the table name is large and dishes are bold. The printer driver
# cuts the paper at the end of the document (thermal drivers: "Cut at end of
# document" / "Paper cut: Document end"). Called by index.js; on any error
# index.js falls back to plain text.
#
# Input file: one line per row, "<role>|<text>", role n (normal), b (bold),
# h (huge, centred).
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Printer = '',
  [int]$Cols = 32,
  [string]$FontName = 'Consolas'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$script:Rows = New-Object System.Collections.ArrayList
foreach ($raw in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
  if ($raw.Length -ge 2 -and $raw[1] -eq '|') { [void]$script:Rows.Add(@($raw.Substring(0, 1), $raw.Substring(2))) }
  else { [void]$script:Rows.Add(@('n', $raw)) }
}
$script:Index = 0
$script:Cols = [Math]::Max(16, [Math]::Min(64, $Cols))
$script:FontName = $FontName
$installed = New-Object System.Drawing.Text.InstalledFontCollection
if (-not ($installed.Families | Where-Object { $_.Name -eq $FontName })) { $script:FontName = 'Courier New' }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = 'Lumio'
if ($Printer) { $doc.PrinterSettings.PrinterName = $Printer }
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $Printer" }
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
  $w10 = $g.MeasureString(('M' * $script:Cols), $probe, [int]100000, $typo).Width
  $size = [single][Math]::Max(6, [Math]::Min(18, 10 * $W / [Math]::Max(1, $w10)))
  $normal = New-Object System.Drawing.Font($script:FontName, $size)
  $bold = New-Object System.Drawing.Font($script:FontName, [single]($size * 1.2), [System.Drawing.FontStyle]::Bold)
  $huge = New-Object System.Drawing.Font($script:FontName, [single]($size * 2), [System.Drawing.FontStyle]::Bold)
  $y = [single]0
  while ($script:Index -lt $script:Rows.Count) {
    $row = $script:Rows[$script:Index]
    $role = [string]$row[0]
    $text = [string]$row[1]
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
    $script:Index++
  }
  $e.HasMorePages = $false
})
$doc.Print()
