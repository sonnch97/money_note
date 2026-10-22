Add-Type -AssemblyName System.Drawing

$iconDirectory = Join-Path $PSScriptRoot '..\icons'
foreach ($size in @(192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#153b36'))
    $scale = $size / 512.0
    $graphics.ScaleTransform($scale, $scale)

    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(118, 356), [System.Drawing.PointF]::new(118, 163),
        [System.Drawing.PointF]::new(176, 163), [System.Drawing.PointF]::new(256, 271),
        [System.Drawing.PointF]::new(336, 163), [System.Drawing.PointF]::new(394, 163),
        [System.Drawing.PointF]::new(394, 356), [System.Drawing.PointF]::new(330, 356),
        [System.Drawing.PointF]::new(330, 263), [System.Drawing.PointF]::new(256, 359),
        [System.Drawing.PointF]::new(182, 263), [System.Drawing.PointF]::new(182, 356)
    )
    $letterBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#eaf5df'))
    $dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#d2ed79'))
    $graphics.FillPolygon($letterBrush, $points)
    $graphics.FillEllipse($dotBrush, 366, 98, 56, 56)

    $output = Join-Path $iconDirectory "icon-$size.png"
    $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
    $letterBrush.Dispose()
    $dotBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
