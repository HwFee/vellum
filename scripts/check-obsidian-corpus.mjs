/**
 * Obsidian 全库语料检查的入口。
 *
 * 真正的检查写在 `scripts/check-obsidian-corpus.test.tsx` 里——只有 vitest 能把
 * `.tsx` 那条真实渲染管线（remark/rehype 插件链、`components` 覆盖渲染、KaTeX、
 * 懒加载语言包）跑起来；用 node 直接跑 .tsx 会连 import 都过不去，重写一套解析
 * 又等于检查另一份实现。所以这里只做一件事：把 vitest 拉起来、把退出码原样透传。
 *
 * 两条行为：库目录不存在时检查自身整体跳过（`describe.skipIf`），退出码仍是 0；
 * 库存在但有未处理构造时退出码非 0，可直接进 CI 或 pre-commit。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 从脚本自身位置推仓库根：从仓库根、从 scripts/、从任何地方调用结果一致
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// shell: true 是刻意的——Windows 上 npx 是 .cmd，不经 shell 起不来；命令串是常量，无注入面
const command = "npx vitest run scripts/check-obsidian-corpus.test.tsx";
const result = spawnSync(command, { cwd: repoRoot, stdio: "inherit", shell: true });

process.exit(result.status ?? 1);
