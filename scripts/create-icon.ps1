param(
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\build")
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param(
        [System.Drawing.RectangleF]$Rect,
        [float]$Radius
    )

    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $arc = [System.Drawing.RectangleF]::new($Rect.X, $Rect.Y, $diameter, $diameter)
    $path.AddArc($arc, 180, 90)
    $arc.X = $Rect.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $Rect.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $Rect.X
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()
    return $path
}

function Convert-HexColor {
    param([string]$Hex)
    return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function New-IconPng {
    param(
        [int]$Size,
        [string]$Path
    )

    $scale = $Size / 512.0
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.ScaleTransform($scale, $scale)

    $outer = New-RoundedRectanglePath ([System.Drawing.RectangleF]::new(0, 0, 512, 512)) 112
    $graphics.FillPath([System.Drawing.SolidBrush]::new((Convert-HexColor "#071018")), $outer)

    $panel = New-RoundedRectanglePath ([System.Drawing.RectangleF]::new(62, 62, 388, 388)) 92
    $panelBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        [System.Drawing.PointF]::new(96, 80),
        [System.Drawing.PointF]::new(416, 432),
        (Convert-HexColor "#142235"),
        (Convert-HexColor "#0b1118")
    )
    $graphics.FillPath($panelBrush, $panel)
    $graphics.DrawPath([System.Drawing.Pen]::new((Convert-HexColor "#263647"), 18), $panel)

    $barPen = [System.Drawing.Pen]::new((Convert-HexColor "#607080"), 28)
    $barPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $barPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    foreach ($bar in @(@(142, 338, 142, 198), @(214, 338, 214, 150), @(286, 338, 286, 238), @(358, 338, 358, 176))) {
        $graphics.DrawLine($barPen, $bar[0], $bar[1], $bar[2], $bar[3])
    }

    $pulseBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        [System.Drawing.PointF]::new(132, 292),
        [System.Drawing.PointF]::new(380, 196),
        (Convert-HexColor "#24d6a5"),
        (Convert-HexColor "#f2b84b")
    )
    $blend = [System.Drawing.Drawing2D.ColorBlend]::new()
    $blend.Positions = [single[]](0, 0.55, 1)
    $blend.Colors = [System.Drawing.Color[]]((Convert-HexColor "#24d6a5"), (Convert-HexColor "#48a9f8"), (Convert-HexColor "#f2b84b"))
    $pulseBrush.InterpolationColors = $blend

    $pulsePen = [System.Drawing.Pen]::new($pulseBrush, 30)
    $pulsePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pulsePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pulsePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(126, 282),
        [System.Drawing.PointF]::new(180, 282),
        [System.Drawing.PointF]::new(208, 226),
        [System.Drawing.PointF]::new(256, 334),
        [System.Drawing.PointF]::new(300, 198),
        [System.Drawing.PointF]::new(336, 282),
        [System.Drawing.PointF]::new(386, 282)
    )
    $graphics.DrawLines($pulsePen, $points)
    $graphics.FillEllipse([System.Drawing.SolidBrush]::new((Convert-HexColor "#f2b84b")), 364, 260, 44, 44)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Write-Ico {
    param(
        [string[]]$PngPaths,
        [string]$IcoPath
    )

    $pngBytes = @($PngPaths | ForEach-Object { [System.IO.File]::ReadAllBytes($_) })
    $stream = [System.IO.File]::Create($IcoPath)
    $writer = [System.IO.BinaryWriter]::new($stream)

    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$pngBytes.Count)

    $offset = 6 + (16 * $pngBytes.Count)
    for ($i = 0; $i -lt $pngBytes.Count; $i++) {
        $size = [int]([System.IO.Path]::GetFileNameWithoutExtension($PngPaths[$i]) -replace "^icon-", "")
        $writer.Write([byte]($(if ($size -eq 256) { 0 } else { $size })))
        $writer.Write([byte]($(if ($size -eq 256) { 0 } else { $size })))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$pngBytes[$i].Length)
        $writer.Write([UInt32]$offset)
        $offset += $pngBytes[$i].Length
    }

    foreach ($bytes in $pngBytes) {
        $writer.Write($bytes)
    }

    $writer.Dispose()
    $stream.Dispose()
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngPaths = foreach ($size in $sizes) {
    $path = Join-Path $OutputDir "icon-$size.png"
    New-IconPng -Size $size -Path $path
    $path
}

Write-Ico -PngPaths $pngPaths -IcoPath (Join-Path $OutputDir "icon.ico")
Write-Output "Generated icon.ico and PNG sizes in $OutputDir"
