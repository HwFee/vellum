import fs from 'node:fs';
import path from 'node:path';

const templatePath = path.resolve(
  process.cwd(),
  'C:/Users/17445/Desktop/HwFee-skills/skills/vellum-mdlog/assets/widget-template.html'
);

if (!fs.existsSync(templatePath)) {
  console.error(`[FAIL] 模板文件不存在: ${templatePath}`);
  process.exit(1);
}

const html = fs.readFileSync(templatePath, 'utf-8');

const assertions = [
  { name: '符合标准 HTML5 DOCTYPE 声明', pass: html.startsWith('<!DOCTYPE html>') },
  { name: '指定中文 lang 属性', pass: /<html[^>]+lang=["']zh-CN["']/.test(html) },
  { name: '声明 UTF-8 编码', pass: /<meta charset=["']UTF-8["']/i.test(html) },
  { name: '包含 postMessage 契约类型 vellum-widget:resize', pass: html.includes('"vellum-widget:resize"') },
  { name: '包含 ResizeObserver 监听', pass: html.includes('ResizeObserver') },
  { name: '包含 load 事件兜底上报', pass: html.includes('addEventListener("load"') || html.includes("addEventListener('load'") },
  { name: '严禁外部网络请求 (http://, https://, //)', pass: !/https?:\/\//.test(html) },
  { name: '严禁本地存储 (localStorage)', pass: !html.includes('localStorage') },
  { name: '严禁本地存储 (sessionStorage)', pass: !html.includes('sessionStorage') },
  { name: '严禁数据库存储 (indexedDB)', pass: !html.includes('indexedDB') },
  { name: '严禁 Cookie 存储 (document.cookie)', pass: !html.includes('document.cookie') },
  { name: '严禁使用 emoji', pass: !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html) },
  { name: '硬编码 kami 纸底色 #f5f4ed', pass: html.includes('#f5f4ed') },
  { name: '硬编码 kami 象牙白 #faf9f5', pass: html.includes('#faf9f5') },
  { name: '硬编码 kami 浓墨 #141413', pass: html.includes('#141413') },
  { name: '硬编码 kami 暗暖字 #3d3d3a', pass: html.includes('#3d3d3a') },
  { name: '硬编码 kami 弱化字 #6b6a64', pass: html.includes('#6b6a64') },
  { name: '硬编码 kami 靛青品牌色 #1B365D', pass: html.includes('#1B365D') },
  { name: '硬编码 kami 发丝线 #dddacc', pass: html.includes('#dddacc') },
  { name: '支持 prefers-reduced-motion 动画豁免', pass: html.includes('prefers-reduced-motion') },
  { name: '字体栈包含 TsangerJinKai02 与 CJK 衬线回退', pass: html.includes('TsangerJinKai02') && html.includes('Source Han Serif SC') },
];

let failedCount = 0;
for (const a of assertions) {
  if (!a.pass) {
    console.error(`[FAIL] ${a.name}`);
    failedCount++;
  } else {
    console.log(`[PASS] ${a.name}`);
  }
}

if (failedCount > 0) {
  console.error(`\n共 ${failedCount} 项模板契约检查失败！`);
  process.exit(1);
} else {
  console.log('\n[PASS] widget-template.html 契约全部通过！');
  process.exit(0);
}
