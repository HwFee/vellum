# 真机冷启动计时：从 Start-Process 发起 ShellExecute 那一刻起，到 vellum 主窗口出现为止。
# 打点：ShellExecute 返回 → vellum.exe 进程 → MainWindowHandle 出现 → IsWindowVisible → 标题带文件名。
# 用法：powershell -File scripts/win-open-timing.ps1 "C:\path\to\file.md"
param([string]$File = "C:\Users\17445\Desktop\test\issue-body.md")

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
}
"@

$sw = [System.Diagnostics.Stopwatch]::StartNew()
function Stamp($label) { Write-Host ("[{0,6}ms] {1}" -f $sw.ElapsedMilliseconds, $label) }

Get-Process vellum -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

Stamp "ShellExecute $File"
Start-Process -FilePath $File  # 走 Windows 关联 → vellum.exe（不等返回，立即轮询）
Stamp "Start-Process issued"

# 1. 等 vellum.exe 进程出现
$vellum = $null
while (-not $vellum -and $sw.ElapsedMilliseconds -lt 15000) {
    $vellum = Get-Process vellum -ErrorAction SilentlyContinue
    if (-not $vellum) { Start-Sleep -Milliseconds 30 }
}
if (-not $vellum) { Stamp "FAIL: 15s 内没有 vellum.exe 进程"; exit 1 }
Stamp "vellum.exe process (pid=$($vellum.Id))"

# 2. 等主窗口句柄出现（窗口对象创建，此时可能还不可见）
while ($vellum.MainWindowHandle -eq 0 -and $sw.ElapsedMilliseconds -lt 15000) {
    $vellum.Refresh()
    Start-Sleep -Milliseconds 30
}
if ($vellum.MainWindowHandle -eq 0) { Stamp "FAIL: 15s 内没有主窗口"; exit 1 }
Stamp "MainWindowHandle=$($vellum.MainWindowHandle) exists"

# 3. 等窗口可见（IsWindowVisible——show() 调用后）
while (-not [Win32]::IsWindowVisible($vellum.MainWindowHandle) -and $sw.ElapsedMilliseconds -lt 15000) {
    Start-Sleep -Milliseconds 30
    $vellum.Refresh()
}
Stamp "window VISIBLE"

# 4. 等标题带出文件名（文档渲染完成）
$fileStem = [IO.Path]::GetFileNameWithoutExtension($File)
$title = ""
while ($sw.ElapsedMilliseconds -lt 15000) {
    $vellum.Refresh()
    $sb = New-Object System.Text.StringBuilder 256
    [void][Win32]::GetWindowText($vellum.MainWindowHandle, $sb, 256)
    $title = $sb.ToString()
    if ($title -like "*$fileStem*") { break }
    Start-Sleep -Milliseconds 30
}
Stamp "title = '$title'"
Stamp ("TOTAL ShellExecute→title: {0}ms" -f $sw.ElapsedMilliseconds)
