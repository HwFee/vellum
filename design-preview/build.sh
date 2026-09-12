#!/usr/bin/env bash
# 设计预览装配脚本：把 src/styles/kami.css 内联进模板（字体路径改写为相对路径），
# 产出可直接双击打开的 design-preview/edit-views.html。
# kami.css 或模板改动后重新执行本脚本即可。
set -euo pipefail
cd "$(dirname "$0")/.."

sed 's|/fonts/|../public/fonts/|g' src/styles/kami.css > design-preview/.kami.inlined.css

awk '{
  if ($0 ~ /__KAMI_CSS__/) {
    while ((getline line < "design-preview/.kami.inlined.css") > 0) print line;
    close("design-preview/.kami.inlined.css");
  } else {
    print $0;
  }
}' design-preview/edit-views.template.html > design-preview/edit-views.html

echo "built design-preview/edit-views.html"
