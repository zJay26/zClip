param(
  [Parameter(Mandatory = $true)][string]$DarkPath,
  [Parameter(Mandatory = $true)][string]$ExportPath,
  [Parameter(Mandatory = $true)][string]$LightPath,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$OverviewPath,
  [Parameter(Mandatory = $true)][string]$SocialPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param([System.Drawing.RectangleF]$Rectangle, [float]$Radius)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-CoverImage {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius = 16
  )
  $scale = [Math]::Max($Rectangle.Width / $Image.Width, $Rectangle.Height / $Image.Height)
  $sourceWidth = $Rectangle.Width / $scale
  $sourceHeight = $Rectangle.Height / $scale
  $sourceX = ($Image.Width - $sourceWidth) / 2
  $sourceY = ($Image.Height - $sourceHeight) / 2
  $destination = [System.Drawing.Rectangle]::new(
    [int][Math]::Round($Rectangle.X),
    [int][Math]::Round($Rectangle.Y),
    [int][Math]::Round($Rectangle.Width),
    [int][Math]::Round($Rectangle.Height)
  )
  $clip = New-RoundedPath -Rectangle $Rectangle -Radius $Radius
  $saved = $Graphics.Save()
  $Graphics.SetClip($clip)
  $Graphics.DrawImage(
    $Image,
    $destination,
    [int][Math]::Round($sourceX),
    [int][Math]::Round($sourceY),
    [int][Math]::Round($sourceWidth),
    [int][Math]::Round($sourceHeight),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $Graphics.Restore($saved)
  $clip.Dispose()
}

function New-Canvas {
  param([int]$Width, [int]$Height)
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $bitmap.SetResolution(96, 96)
  return $bitmap
}

function Save-Jpeg {
  param([System.Drawing.Image]$Image, [string]$Path, [long]$Quality)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
  $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, $Quality)
  $Image.Save($Path, $codec, $parameters)
  $parameters.Dispose()
}

$dark = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $DarkPath))
$export = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $ExportPath))
$light = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $LightPath))
$icon = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $IconPath))

try {
  $overview = New-Canvas -Width 1440 -Height 900
  $graphics = [System.Drawing.Graphics]::FromImage($overview)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0B0A12'))

    $titleFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 27, [System.Drawing.FontStyle]::Bold)
    $subtitleFont = [System.Drawing.Font]::new('Segoe UI', 13, [System.Drawing.FontStyle]::Regular)
    $labelFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 13, [System.Drawing.FontStyle]::Bold)
    try {
      $graphics.DrawString('同一个 zClip，随时切换主题和语言', $titleFont, [System.Drawing.Brushes]::White, 44, 28)
      $graphics.DrawString('The same editing workflow in dark or light, Chinese or English.', $subtitleFont, [System.Drawing.Brushes]::LightGray, 47, 75)

      $darkCard = [System.Drawing.RectangleF]::new(40, 124, 670, 730)
      $lightCard = [System.Drawing.RectangleF]::new(730, 124, 670, 730)
      $cardBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#171522'))
      $borderPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#3B3459'), 2)
      try {
        foreach ($card in @($darkCard, $lightCard)) {
          $path = New-RoundedPath -Rectangle $card -Radius 22
          $graphics.FillPath($cardBrush, $path)
          $graphics.DrawPath($borderPen, $path)
          $path.Dispose()
        }
      } finally {
        $cardBrush.Dispose()
        $borderPen.Dispose()
      }
      $graphics.DrawString('深色 · 中文', $labelFont, [System.Drawing.Brushes]::White, 66, 148)
      $graphics.DrawString('Light · English', $labelFont, [System.Drawing.Brushes]::White, 756, 148)
      Draw-CoverImage -Graphics $graphics -Image $dark -Rectangle ([System.Drawing.RectangleF]::new(62, 194, 626, 630)) -Radius 14
      Draw-CoverImage -Graphics $graphics -Image $light -Rectangle ([System.Drawing.RectangleF]::new(752, 194, 626, 630)) -Radius 14
    } finally {
      $titleFont.Dispose()
      $subtitleFont.Dispose()
      $labelFont.Dispose()
    }
  } finally {
    $graphics.Dispose()
  }
  $overview.Save($OverviewPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $overview.Dispose()

  $social = New-Canvas -Width 1280 -Height 640
  $graphics = [System.Drawing.Graphics]::FromImage($social)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      ([System.Drawing.Rectangle]::new(0, 0, 1280, 640)),
      [System.Drawing.ColorTranslator]::FromHtml('#0D0B16'),
      [System.Drawing.ColorTranslator]::FromHtml('#241A49'),
      18
    )
    $graphics.FillRectangle($gradient, 0, 0, 1280, 640)
    $gradient.Dispose()

    $iconRect = [System.Drawing.RectangleF]::new(66, 60, 92, 92)
    Draw-CoverImage -Graphics $graphics -Image $icon -Rectangle $iconRect -Radius 20
    $titleFont = [System.Drawing.Font]::new('Segoe UI', 48, [System.Drawing.FontStyle]::Bold)
    $taglineFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 22, [System.Drawing.FontStyle]::Bold)
    $englishFont = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Regular)
    $chipFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 13, [System.Drawing.FontStyle]::Bold)
    try {
      $graphics.DrawString('zClip', $titleFont, [System.Drawing.Brushes]::White, 178, 67)
      $taglineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F4F0FF'))
      $mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#C9BFE7'))
      try {
        $graphics.DrawString('小剪辑，不必上重工具。', $taglineFont, $taglineBrush, ([System.Drawing.RectangleF]::new(66, 192, 458, 78)))
        $graphics.DrawString('A local-first Windows video editor for the edits that should take minutes.', $englishFont, $mutedBrush, ([System.Drawing.RectangleF]::new(68, 280, 450, 90)))
      } finally {
        $taglineBrush.Dispose()
        $mutedBrush.Dispose()
      }

      $chipBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#6D5DFB'))
      foreach ($chip in @(
        @{ X = 68; Width = 112; Text = '本地处理' },
        @{ X = 194; Width = 112; Text = '无订阅' },
        @{ X = 320; Width = 150; Text = 'Windows 10/11' }
      )) {
        $rect = [System.Drawing.RectangleF]::new($chip.X, 404, $chip.Width, 44)
        $path = New-RoundedPath -Rectangle $rect -Radius 14
        $graphics.FillPath($chipBrush, $path)
        $format = [System.Drawing.StringFormat]::new()
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $graphics.DrawString($chip.Text, $chipFont, [System.Drawing.Brushes]::White, $rect, $format)
        $format.Dispose()
        $path.Dispose()
      }
      $chipBrush.Dispose()

      $screenRect = [System.Drawing.RectangleF]::new(552, 62, 664, 516)
      $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(90, 0, 0, 0))
      $shadowPath = New-RoundedPath -Rectangle ([System.Drawing.RectangleF]::new(562, 74, 664, 516)) -Radius 22
      $graphics.FillPath($shadowBrush, $shadowPath)
      $shadowBrush.Dispose()
      $shadowPath.Dispose()
      Draw-CoverImage -Graphics $graphics -Image $export -Rectangle $screenRect -Radius 22
      $border = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#8C7DDB'), 2)
      $screenPath = New-RoundedPath -Rectangle $screenRect -Radius 22
      $graphics.DrawPath($border, $screenPath)
      $border.Dispose()
      $screenPath.Dispose()
    } finally {
      $titleFont.Dispose()
      $taglineFont.Dispose()
      $englishFont.Dispose()
      $chipFont.Dispose()
    }
  } finally {
    $graphics.Dispose()
  }
  Save-Jpeg -Image $social -Path $SocialPath -Quality 88
  $social.Dispose()
} finally {
  $dark.Dispose()
  $export.Dispose()
  $light.Dispose()
  $icon.Dispose()
}
