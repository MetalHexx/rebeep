# Saves a PNG of one process's main window. Windows only.
#   powershell -NoProfile -File window-shot.ps1 -ProcId <pid> -Out <file.png>
param([Parameter(Mandatory = $true)][int]$ProcId, [Parameter(Mandatory = $true)][string]$Out)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WinShot {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@

# Without this the rectangle is in scaled units on a high-DPI display and the capture is cut short.
[WinShot]::SetProcessDPIAware() | Out-Null
$handle = (Get-Process -Id $ProcId).MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { Write-Error "process $ProcId has no window"; exit 1 }
$rect = New-Object WinShot+RECT
[WinShot]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = $rect.R - $rect.L
$height = $rect.B - $rect.T
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.L, $rect.T, 0, 0, (New-Object System.Drawing.Size $width, $height))
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
