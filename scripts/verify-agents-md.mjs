import fs from 'node:fs';
import path from 'node:path';

const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
const content = fs.readFileSync(agentsPath, 'utf-8');

const checks = [
  {
    name: '技能安装流程记录 vellum-mdlog 真实目录版本化例外',
    pattern: /例外.*`vellum-mdlog`.*项目专属技能.*真实目录.*\.pi\/skills\/.*随仓库版本化.*不迁入全局仓库/,
  },
  {
    name: '已安装技能表中登记 vellum-mdlog',
    pattern: /\|\s*`vellum-mdlog`\s*\|\s*Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范/,
  },
  {
    name: '性能结构约束包含 WidgetSandbox memo 与 LRU 机制',
    pattern: /WidgetSandbox.*React\.memo.*全局最多 10 个存活 iframe LRU/,
  },
  {
    name: '性能结构约束包含代码块语言连字符正则',
    pattern: /language-\(\[\\w-\]\+\)/,
  },
];

let failed = 0;
for (const check of checks) {
  if (!check.pattern.test(content)) {
    console.error(`[FAIL] ${check.name}`);
    failed++;
  } else {
    console.log(`[PASS] ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n共 ${failed} 项校验失败，AGENTS.md 亟待订正。`);
  process.exit(1);
} else {
  console.log('\n[PASS] AGENTS.md 全部规约校验通过！');
  process.exit(0);
}
