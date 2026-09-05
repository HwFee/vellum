import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const skillDir = path.resolve(projectRoot, '.pi/skills/vellum-mdlog');
const skillFile = path.resolve(skillDir, 'SKILL.md');
const templateFile = path.resolve(skillDir, 'assets/widget-template.html');

console.log('[INFO] 开始执行 pi 技能发现与契约一致性审查...\n');

// 1. 物理目录与文件存在性
if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
  console.error(`[FAIL] 技能目录不存在或不是真实目录: ${skillDir}`);
  process.exit(1);
}
if (!fs.existsSync(skillFile)) {
  console.error(`[FAIL] SKILL.md 文件不存在: ${skillFile}`);
  process.exit(1);
}
if (!fs.existsSync(templateFile)) {
  console.error(`[FAIL] 骨架模板文件不存在: ${templateFile}`);
  process.exit(1);
}
console.log('[PASS] 目录结构校验通过（真实目录，非无效符号联接）');

// 2. 解析 YAML Frontmatter
const content = fs.readFileSync(skillFile, 'utf-8');
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error('[FAIL] SKILL.md 未包含合法的 YAML frontmatter');
  process.exit(1);
}

const fmRaw = fmMatch[1];
const nameMatch = fmRaw.match(/^name:\s*(.+)$/m);
const descMatch = fmRaw.match(/^description:\s*(.+)$/m);

if (!nameMatch || nameMatch[1].trim() !== 'vellum-mdlog') {
  console.error(`[FAIL] frontmatter name 必须精确为 "vellum-mdlog"，实际: ${nameMatch ? nameMatch[1] : 'null'}`);
  process.exit(1);
}
console.log('[PASS] frontmatter name 精确匹配: vellum-mdlog');

if (!descMatch) {
  console.error('[FAIL] frontmatter 缺少 description 字段');
  process.exit(1);
}

const desc = descMatch[1].trim();
if (desc.length > 1024) {
  console.error(`[FAIL] description 超过 1024 字符限制（当前 ${desc.length}）`);
  process.exit(1);
}
if (!desc.startsWith('Use when')) {
  console.error('[FAIL] description 必须以 "Use when..." 开头');
  process.exit(1);
}

// 检查触发关键词
const triggers = ['对话记录', 'vellum', 'mdlog', '交互块', '可视化讲解'];
const missingTriggers = triggers.filter(t => !desc.includes(t));
if (missingTriggers.length > 0) {
  console.error(`[FAIL] description 遗漏核心触发词: ${missingTriggers.join(', ')}`);
  process.exit(1);
}
console.log('[PASS] frontmatter description 触发词与格式校验通过');

// 3. 跨包契约逐字一致性断言（Cross-Package Verbatim Contracts）
const crossPackageTokens = [
  { name: '围栏语言标识符', text: 'vellum-widget' },
  { name: '通信事件类型', text: 'vellum-widget:resize' },
  { name: '高度范围闭区间', text: '[80, 2000]' },
];

for (const item of crossPackageTokens) {
  if (!content.includes(item.text)) {
    console.error(`[FAIL] SKILL.md 缺少跨包逐字契约: ${item.name} -> "${item.text}"`);
    process.exit(1);
  }
}
console.log('[PASS] 跨包逐字契约检查通过（vellum-widget, vellum-widget:resize, [80, 2000]）');

console.log('\n[PASS] pi agent 技能发现与载入条件 100% 达成！');
process.exit(0);
