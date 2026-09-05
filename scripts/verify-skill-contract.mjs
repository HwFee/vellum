import fs from 'node:fs';
import path from 'node:path';

const skillPath = path.resolve(process.cwd(), '.pi/skills/vellum-mdlog/SKILL.md');

if (!fs.existsSync(skillPath)) {
  console.error(`[FAIL] 目标技能文件不存在: ${skillPath}`);
  process.exit(1);
}

const content = fs.readFileSync(skillPath, 'utf-8');

const requiredTokens = [
  // 触发词与 frontmatter
  'name: vellum-mdlog',
  '对话记录',
  'vellum',
  'mdlog',
  '交互块',
  '可视化讲解',
  // 跨包契约逐字匹配
  'vellum-widget',
  'vellum-widget:resize',
  '[80, 2000]',
  // 沙箱与 Opaque Origin 禁存储
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'SecurityError',
  // kami 色值
  '#f5f4ed',
  '#faf9f5',
  '#e8e6dc',
  '#141413',
  '#3d3d3a',
  '#6b6a64',
  '#1B365D',
  '#dddacc',
  // 字体栈与 CJK 衬线回退
  'TsangerJinKai02',
  'Source Han Serif SC',
  // 动画与交互限制
  'prefers-reduced-motion',
  'emoji',
  // 图片惯例
  'mdlog-assets/',
];

let missing = 0;
for (const token of requiredTokens) {
  if (!content.includes(token)) {
    console.error(`[FAIL] 缺少必需契约关键词: "${token}"`);
    missing++;
  } else {
    console.log(`[PASS] 契约关键词检测通过: "${token}"`);
  }
}

// 检查 frontmatter 格式
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error('[FAIL] 缺少有效的 YAML frontmatter');
  missing++;
} else {
  const fm = fmMatch[1];
  if (!fm.includes('name: vellum-mdlog')) {
    console.error('[FAIL] frontmatter 缺少 name: vellum-mdlog');
    missing++;
  }
  if (!/description:\s*Use when/.test(fm)) {
    console.error('[FAIL] frontmatter description 必须遵循 "Use when..." 触发模式');
    missing++;
  }
}

if (missing > 0) {
  console.error(`\n共 ${missing} 项契约检查不满足！`);
  process.exit(1);
} else {
  console.log('\n[PASS] SKILL.md 完整性与契约全部通过！');
  process.exit(0);
}
