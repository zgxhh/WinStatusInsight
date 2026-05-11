$ErrorActionPreference = "Stop"

$buildDir = Join-Path $PSScriptRoot "..\build"
$pngPath = Join-Path $buildDir "icon-256.png"
$icoPath = Join-Path $buildDir "icon.ico"

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

if (-not (Test-Path $pngPath)) {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::new(256, 256)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#071018"))
    $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#24d6a5"), 16)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(46, 168),
        [System.Drawing.PointF]::new(88, 168),
        [System.Drawing.PointF]::new(112, 88),
        [System.Drawing.PointF]::new(144, 202),
        [System.Drawing.PointF]::new(172, 136),
        [System.Drawing.PointF]::new(214, 136)
    )
    $graphics.DrawLines($pen, $points)
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Dispose()
$stream.Dispose()

Write-Output "Generated icon.ico and icon-256.png in $buildDir"
