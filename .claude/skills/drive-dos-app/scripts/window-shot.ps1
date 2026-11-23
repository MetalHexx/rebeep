# Saves a PNG of one process's main window. Windows only.
#   powershell -NoProfile -File window-shot.ps1 -ProcId <pid> -Out <file.png>
# The capture copies screen pixels, so the window is restored and put on top first; the shot fails (exit 1) when
# something still covers it, rather than saving a picture of another application.
param([Parameter(Mandatory = $true)][int]$ProcId, [Parameter(Mandatory = $true)][string]$Out)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WinShot {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
}
"@

$SW_RESTORE = 9
$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP_NOMOVE_NOSIZE_NOACTIVATE = 0x0001 -bor 0x0002 -bor 0x0010
$GA_ROOT = 2

# Without this the rectangle is in scaled units on a high-DPI display and the capture is cut short.
[WinShot]::SetProcessDPIAware() | Out-Null
$handle = (Get-Process -Id $ProcId).MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { Write-Error "process $ProcId has no window"; exit 1 }

if ([WinShot]::IsIconic($handle)) { [WinShot]::ShowWindow($handle, $SW_RESTORE) | Out-Null }
[WinShot]::SetWindowPos($handle, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE_NOSIZE_NOACTIVATE) | Out-Null
try {
  Start-Sleep -Milliseconds 200
  $rect = New-Object WinShot+RECT
  [WinShot]::GetWindowRect($handle, [ref]$rect) | Out-Null
  $width = $rect.R - $rect.L
  $height = $rect.B - $rect.T

  # The window must be the top window at its centre and at the middle of each quarter.
  foreach ($fx in 0.25, 0.5, 0.75) {
    foreach ($fy in 0.25, 0.5, 0.75) {
      $point = New-Object WinShot+POINT
      $point.X = [int]($rect.L + $width * $fx)
      $point.Y = [int]($rect.T + $height * $fy)
      $top = [WinShot]::GetAncestor([WinShot]::WindowFromPoint($point), $GA_ROOT)
      if ($top -ne $handle) {
        Write-Error "process $ProcId's window is covered at ($($point.X), $($point.Y)) by another window"
        exit 1
      }
    }
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($rect.L, $rect.T, 0, 0, (New-Object System.Drawing.Size $width, $height))
  $bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  [WinShot]::SetWindowPos($handle, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP_NOMOVE_NOSIZE_NOACTIVATE) | Out-Null
}
