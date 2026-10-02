# 被动监测：双击 .md 后，盯 vellum 从进程创建到「标题带文件名」的耗时。
# 放弃截屏（WebView2 GPU 渲染 CopyFromScreen 截到全黑），改轮询窗口标题变化：
# 「素笺」→「文件名 — 素笺」的时刻 = 文档渲染完成的近似信号。
# 用法：powershell -File scripts/win-open-watch.ps1 —— 然后去双击一个 .md

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder t, int c);
}
"@

Write-Host "监测中…现在去双击一个 .md 文件（Ctrl+C 退出）"
Get-Process vellum -ErrorAction SilentlyContinue | Stop-Process -Force

$vellum = $null
while (-not $vellum) {
    $vellum = Get-Process vellum -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $vellum) { Start-Sleep -Milliseconds 15 }
}
$t0 = $vellum.StartTime
function Stamp($l) { Write-Host ("[{0,6}ms] {1}" -f [int]((Get-Date)-$t0).TotalMilliseconds, $l) }
Stamp "vellum.exe created (pid=$($vellum.Id))"

$deadline = (Get-Date).AddSeconds(30)
while ($vellum.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) {
    $vellum.Refresh(); Start-Sleep -Milliseconds 15
}
if ($vellum.MainWindowHandle -eq 0) { Stamp "30s 无窗口句柄"; exit 1 }
Stamp "MainWindowHandle exists"

while (-not [W]::IsWindowVisible($vellum.MainWindowHandle) -and (Get-Date) -lt $deadline) {
    $vellum.Refresh(); Start-Sleep -Milliseconds 15
}
Stamp "IsWindowVisible=true"

# 标题变化序列（素笺 → xxx — 素笺），每次变化打一行
$lastTitle = ""
while ((Get-Date) -lt $deadline) {
    $vellum.Refresh()
    $sb = New-Object System.Text.StringBuilder 256
    [void][W]::GetWindowText($vellum.MainWindowHandle, $sb, 256)
    $t = $sb.ToString()
    if ($t -ne $lastTitle) {
        Stamp "title='$t'"
        $lastTitle = $t
        if ($t -like "*— 素笺*") { break }
    }
    Start-Sleep -Milliseconds 15
}
Stamp "done"
