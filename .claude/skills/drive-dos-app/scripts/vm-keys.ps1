# Types keys into a lab VM's 86Box window as real keyboard scan codes. Windows only.
#   powershell -NoProfile -File vm-keys.ps1 -ProcId <pid> 'type D:' 'tap Enter' 'wait 500'
# Each argument after the process id is one step, and the steps run in order:
#   type <text>   letters, digits, space and . , : ; \ / - = (Shift is added where needed)
#   tap <key>     press and release one key            down <key> / up <key>  hold or release it
#   chord <keys>  e.g. Ctrl+F11 or Alt+4: hold the first keys, tap the last, release
#   wait <ms>     pause
# Key names: Esc Enter Space Tab Bksp Ctrl Shift Alt F1-F12 Up Down Left Right Home End PgUp PgDn Ins Del,
# or one letter or digit. The window is brought to the front first, and the script fails (exit 2) if it can't be.
# It needs an unlocked desktop: a locked session drops injected keys.
param([Parameter(Mandatory = $true)][int]$ProcId,
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Steps)

Add-Type @"
using System; using System.Runtime.InteropServices;
public class VmKeys {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static uint Key(ushort scan, bool extended, bool up) {
    INPUT[] a = new INPUT[1];
    a[0].type = 1;
    a[0].u.ki.wScan = scan;
    a[0].u.ki.dwFlags = 0x0008 | (extended ? 0x0001u : 0u) | (up ? 0x0002u : 0u);
    return SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

# Set-1 scan codes. Extended keys (E0 prefix) are listed in $extended.
$codes = @{
  Esc = 0x01; Bksp = 0x0E; Tab = 0x0F; Enter = 0x1C; Ctrl = 0x1D; Shift = 0x2A; Alt = 0x38; Space = 0x39
  F1 = 0x3B; F2 = 0x3C; F3 = 0x3D; F4 = 0x3E; F5 = 0x3F; F6 = 0x40; F7 = 0x41; F8 = 0x42; F9 = 0x43; F10 = 0x44
  F11 = 0x57; F12 = 0x58; Up = 0x48; Down = 0x50; Left = 0x4B; Right = 0x4D; Home = 0x47; End = 0x4F
  PgUp = 0x49; PgDn = 0x51; Ins = 0x52; Del = 0x53
}
$extended = 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PgUp', 'PgDn', 'Ins', 'Del'
$row = @{ 'Q' = 0x10; 'W' = 0x11; 'E' = 0x12; 'R' = 0x13; 'T' = 0x14; 'Y' = 0x15; 'U' = 0x16; 'I' = 0x17; 'O' = 0x18; 'P' = 0x19
  'A' = 0x1E; 'S' = 0x1F; 'D' = 0x20; 'F' = 0x21; 'G' = 0x22; 'H' = 0x23; 'J' = 0x24; 'K' = 0x25; 'L' = 0x26
  'Z' = 0x2C; 'X' = 0x2D; 'C' = 0x2E; 'V' = 0x2F; 'B' = 0x30; 'N' = 0x31; 'M' = 0x32
  '1' = 0x02; '2' = 0x03; '3' = 0x04; '4' = 0x05; '5' = 0x06; '6' = 0x07; '7' = 0x08; '8' = 0x09; '9' = 0x0A; '0' = 0x0B }
# Characters typed with or without Shift: char -> scan, shifted.
$punct = @{ ' ' = @(0x39, $false); '.' = @(0x34, $false); ',' = @(0x33, $false); ';' = @(0x27, $false); ':' = @(0x27, $true)
  '\' = @(0x2B, $false); '/' = @(0x35, $false); '-' = @(0x0C, $false); '=' = @(0x0D, $false); '_' = @(0x0C, $true) }

function Get-Scan([string]$name) {
  foreach ($k in $codes.Keys) { if ($k -ieq $name) { return @{ Scan = $codes[$k]; Ext = ($extended -contains $k) } } }
  $u = $name.ToUpperInvariant()
  if ($u.Length -eq 1 -and $row.ContainsKey($u)) { return @{ Scan = $row[$u]; Ext = $false } }
  throw "unknown key '$name'"
}
function Send-Key($k, [bool]$up) {
  if ([VmKeys]::Key([uint16]$k.Scan, [bool]$k.Ext, $up) -ne 1) { Write-Error "SendInput failed (is the desktop locked?)"; exit 2 }
  Start-Sleep -Milliseconds 30
}
function Send-Tap($k) { Send-Key $k $false; Start-Sleep -Milliseconds 40; Send-Key $k $true }

$handle = (Get-Process -Id $ProcId).MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { Write-Error "process $ProcId has no window"; exit 2 }
if ([VmKeys]::IsIconic($handle)) { [VmKeys]::ShowWindow($handle, 9) | Out-Null }
if ([VmKeys]::GetForegroundWindow() -ne $handle) {
  # Windows lets a process take the foreground right after a key event, so tap Alt first.
  [VmKeys]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [VmKeys]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [VmKeys]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 250
}
if ([VmKeys]::GetForegroundWindow() -ne $handle) { Write-Error "could not bring process $ProcId's window to the front"; exit 2 }

foreach ($step in $Steps) {
  $verb, $arg = $step -split ' ', 2
  switch ($verb.ToLowerInvariant()) {
    'type' {
      foreach ($ch in $arg.ToCharArray()) {
        $c = [string]$ch
        if ($punct.ContainsKey($c)) { $k = @{ Scan = $punct[$c][0]; Ext = $false }; $shift = $punct[$c][1] }
        else { $k = Get-Scan $c; $shift = $false }
        if ($shift) { Send-Key (Get-Scan 'Shift') $false }
        Send-Tap $k
        if ($shift) { Send-Key (Get-Scan 'Shift') $true }
        Start-Sleep -Milliseconds 30
      }
    }
    'tap' { Send-Tap (Get-Scan $arg) }
    'down' { Send-Key (Get-Scan $arg) $false }
    'up' { Send-Key (Get-Scan $arg) $true }
    'chord' {
      $keys = @($arg -split '\+' | ForEach-Object { Get-Scan $_ })
      for ($i = 0; $i -lt $keys.Count - 1; $i++) { Send-Key $keys[$i] $false }
      Send-Tap $keys[-1]
      for ($i = $keys.Count - 2; $i -ge 0; $i--) { Send-Key $keys[$i] $true }
    }
    'wait' { Start-Sleep -Milliseconds ([int]$arg) }
    default { Write-Error "unknown step '$step'"; exit 1 }
  }
}
