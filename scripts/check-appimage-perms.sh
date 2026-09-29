#!/usr/bin/env bash
# 发布前核对 AppImage：包内可执行文件必须对 other 也可执行（AppImage 目录的 firejail 沙箱以别的用户运行）。
# 用法（WSL 内）：bash scripts/check-appimage-perms.sh path/to/Vellum_x.y.z_amd64.AppImage
set -e
f=$(readlink -f "$1"); d=$(mktemp -d); cd "$d"
chmod +x "$f"; "$f" --appimage-extract >/dev/null
bad=$(find squashfs-root ! -type l -type f \( -name AppRun -o -name AppRun.wrapped -o -path '*/usr/bin/*' \) ! -perm -o+rx)
rm -rf "$d"
if [ -n "$bad" ]; then echo "FAIL: 权限不足（应为 755）:"; echo "$bad"; echo "先 chmod 755 ~/.cache/tauri/* 再重打包"; exit 1; fi
echo "OK: AppRun / AppRun.wrapped / usr/bin/* 均 other 可执行"
