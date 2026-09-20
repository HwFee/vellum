import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "kami.css"), "utf-8");

describe("kami.css scroll ownership contract", () => {
  it("establishes a definite viewport geometry for the shell body", () => {
    const bodyRule = css.match(/\.app-shell__body\s*\{[^}]*display:\s*flex[^}]*\}/s)?.[0] ?? "";
    expect(bodyRule).toMatch(/height:\s*100vh/);
    expect(bodyRule).toMatch(/min-height:\s*0/);
    expect(bodyRule).toMatch(/overflow:\s*hidden/);
  });

  it("gives the document scroll area its own scrolling context", () => {
    const scrollRule = css.match(/\.document-scroll\s*\{[^}]*position:\s*relative[^}]*\}/s)?.[0] ?? "";
    expect(scrollRule).toMatch(/min-height:\s*0/);
    expect(scrollRule).toMatch(/overflow-y:\s*scroll/);
  });
});

describe("kami.css code-block structure and resets", () => {
  it("declares scoped selectors for the wrapper, inner pre, and inner code", () => {
    expect(css).toMatch(/\.code-block\s*\{/s);
    expect(css).toMatch(/\.code-block\s+pre\s*\{/s);
    expect(css).toMatch(/\.code-block\s+pre\s+code\s*\{/s);
  });

  it("pushes the copy button to the top-right when no language label is present", () => {
    const rule = css.match(/\.code-block\s+\.code-block__copy\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/margin-left:\s*auto/);
  });

  it("resets the copy button height and active transform against markdown-body button", () => {
    const rule = css.match(/\.code-block\s+\.code-block__copy\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/min-height:\s*(0|28px)/);
    const activeRule = css.match(/\.code-block\s+\.code-block__copy:active\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(activeRule).toMatch(/transform:\s*none/);
  });
});

describe("kami.css code copy visibility", () => {
  it("hides the copy button by default and reveals it on hover or focus-within", () => {
    const rule = css.match(/\.code-block\s+\.code-block__copy\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/opacity:\s*0/);
    const hoverRule = css.match(/\.code-block:hover\s+\.code-block__copy,\s*\.code-block:focus-within\s+\.code-block__copy\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(hoverRule).toMatch(/opacity:\s*1/);
  });

  it("keeps the copy button visible on touch/no-hover devices", () => {
    const rule = css.match(/@media\s*\(hover:\s*none\)\s*\{[^}]*\.code-block\s+\.code-block__copy\s*\{[^}]*opacity:\s*1/s)?.[0] ?? "";
    expect(rule).toBeTruthy();
  });
});

describe("kami.css code copy reduced motion", () => {
  it("disables code copy transitions under reduced motion", () => {
    const rule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.code-block\s+\.code-block__copy[^}]*transition:\s*none/s)?.[0] ?? "";
    expect(rule).toBeTruthy();
  });
});

describe("kami.css outline frameless docked panel", () => {
  it("docks the outline flush without card chrome", () => {
    const rule = css.match(/\.outline-sidebar\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/top:\s*46px/);
    expect(rule).toMatch(/left:\s*0/);
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/background:\s*var\(--parchment\)/);
    expect(rule).toMatch(/border-right:\s*1px solid var\(--hairline\)/);
    expect(rule).not.toMatch(/border-radius/);
    expect(rule).not.toMatch(/box-shadow/);
  });

  it("declares a shared hairline color", () => {
    expect(css).toMatch(/--hairline:\s*#dddacc/);
  });

  it("defines the outline shift as width + gutter", () => {
    expect(css).toMatch(/--outline-shift:\s*calc\(var\(--outline-width\) \+ var\(--outline-gutter\)\)/);
  });

  it("draws a hairline guide on nested outline lists", () => {
    const rule = css.match(/\.outline-panel__list\s+\.outline-panel__list\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/border-left:\s*1px solid var\(--hairline\)/);
  });

  it("marks the active link with an ink rule and no background fill", () => {
    const active = css.match(/\.outline-panel__link--active\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(active).toMatch(/color:\s*var\(--brand\)/);
    expect(active).not.toMatch(/background/);
    expect(active).not.toMatch(/border-left/);
    const marker = css.match(/\.outline-panel__link--active::before\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(marker).toMatch(/width:\s*2px/);
    expect(marker).toMatch(/background:\s*var\(--brand\)/);
  });

  it("gives outline links a visible keyboard focus ring", () => {
    const rule = css.match(/\.outline-panel__link:focus-visible\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/outline:\s*2px solid var\(--brand\)/);
  });

  it("shifts the document by the outline shift on medium/wide", () => {
    const rule = css.match(/@media\s*\(min-width:\s*720px\)\s*\{[^}]*\.app-shell__body--outline-open\s*\.document-scroll\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/margin-left:\s*var\(--outline-shift\)/);
  });

  it("keeps the document unshifted on narrow", () => {
    const rule = css.match(/@media\s*\(max-width:\s*719px\)\s*\{[^}]*\.app-shell__body--outline-open\s*\.document-scroll\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/margin-left:\s*0/);
  });

  it("窄屏纱罩高于自定义滚动条与重载印章（950），但低于侧栏本身（960）", () => {
    const scrim = css.match(/\.outline-scrim\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(scrim).toMatch(/z-index:\s*950/);
    const scrollbar = css.match(/\.custom-scrollbar\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(scrollbar).toMatch(/z-index:\s*900/);
    const reloadNote = css.match(/\.reload-note\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(reloadNote).toMatch(/z-index:\s*900/);
    // 纱罩只封侧栏之外：侧栏与拖宽手柄必须仍在纱罩之上，否则浮层模式侧栏被罩住不可交互
    const sidebar = css.match(/\.outline-sidebar\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(sidebar).toMatch(/z-index:\s*960/);
    const handle = css.match(/\.outline-resize-handle\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(handle).toMatch(/z-index:\s*970/);
  });
});

describe("kami.css outline reduced motion", () => {
  it("disables outline transitions under reduced motion", () => {
    const rule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.outline-sidebar[^}]*transition:\s*none/s)?.[0] ?? "";
    expect(rule).toBeTruthy();
  });

  it("disables outline-scrim animation under reduced motion", () => {
    const rule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.outline-scrim[^}]*animation:\s*none/s)?.[0] ?? "";
    expect(rule).toBeTruthy();
  });

  it("places the reduced-motion .document-scroll rule after the base rule so it wins", () => {
    const baseRuleIndex = css.search(/^\.document-scroll\s*\{/m);
    const reducedMotionRuleIndex = css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.document-scroll[^}]*transition:\s*none/s);
    expect(reducedMotionRuleIndex).toBeGreaterThan(baseRuleIndex);
  });
});

describe("kami.css top bar", () => {
  it("shows the file path inline instead of hiding it", () => {
    const rule = css.match(/\.top-bar__path\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).toMatch(/font-size:\s*11px/);
  });

  it("lays out the meta line as a single baseline-aligned row", () => {
    const rule = css.match(/\.top-bar__meta\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/align-items:\s*baseline/);
  });

  it("shares one ghost style between outline toggle and open button", () => {
    const rule = css.match(/\.outline-toggle,\s*\.open-button\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/width:\s*28px/);
    expect(rule).toMatch(/height:\s*28px/);
    expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--hairline\)/);
  });

  it("历史导航按钮的禁用态只用透明度表达，且压得住幽灵按钮的悬停配色", () => {
    const rule = css.match(/\.nav-button:disabled\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/opacity:\s*0\.35/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).not.toMatch(/color:/);

    // 同特异度下靠顺序取胜：禁用规则必须在 .open-button:hover 之后
    expect(css.indexOf(".nav-button:disabled")).toBeGreaterThan(css.indexOf(".open-button:hover"));
  });
});

describe("kami.css mdlog widget and live indicator tokens", () => {
  it("declares widget container rules with exact preview metrics", () => {
    const widgetRule = css.match(/\.mdlog-widget\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(widgetRule).toMatch(/margin:\s*17px 0/);
    expect(widgetRule).toMatch(/background:\s*var\(--ivory\)/);
    expect(widgetRule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border\)/);
    expect(widgetRule).toMatch(/border-radius:\s*6px/);
    expect(widgetRule).toMatch(/overflow:\s*hidden/);

    const barRule = css.match(/\.mdlog-widget__bar\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(barRule).toMatch(/padding:\s*7px 14px/);
    expect(barRule).toMatch(/font:\s*10px\/1\.5 var\(--mono\)/);
    expect(barRule).toMatch(/letter-spacing:\s*1\.2px/);
    expect(barRule).toMatch(/text-transform:\s*uppercase/);
    expect(barRule).toMatch(/color:\s*var\(--stone\)/);

    const frameRule = css.match(/\.mdlog-widget__frame\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(frameRule).toMatch(/min-height:\s*120px/);
    expect(frameRule).toMatch(/border:\s*0/);
    expect(frameRule).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    expect(frameRule).toMatch(/background:\s*var\(--parchment\)/);

    const placeholderRule = css.match(/\.markdown-body\s+\.mdlog-widget__placeholder\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderRule).toMatch(/min-height:\s*120px/);
    expect(placeholderRule).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    expect(placeholderRule).toMatch(/background:\s*var\(--parchment\)/);
    expect(placeholderRule).toMatch(/color:\s*var\(--stone\)/);
    expect(placeholderRule).toMatch(/box-shadow:\s*none/);
    expect(placeholderRule).toMatch(/border-radius:\s*0/);

    const buttonPlaceholderRule = css.match(/\.markdown-body\s+button\.mdlog-widget__placeholder\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(buttonPlaceholderRule).toMatch(/cursor:\s*pointer/);
    expect(placeholderRule).not.toMatch(/cursor:\s*pointer/);

    const placeholderHoverRule = css.match(/\.markdown-body\s+button\.mdlog-widget__placeholder:hover\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderHoverRule).toMatch(/background:\s*var\(--ivory\)/);
    expect(placeholderHoverRule).toMatch(/color:\s*var\(--brand\)/);

    // P12: 占位块/休眠块补 :focus-visible 2px --brand 描边
    const placeholderFocusRule = css.match(/\.markdown-body\s+button\.mdlog-widget__placeholder:focus-visible\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderFocusRule).toMatch(/outline:\s*2px solid var\(--brand\)/);
    expect(placeholderFocusRule).toMatch(/outline-offset:\s*-2px/);

    // 3ae47d1 / A3: :active 防下沉规则
    const placeholderActiveRule = css.match(/\.markdown-body\s+button\.mdlog-widget__placeholder:active\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderActiveRule).toMatch(/transform:\s*none/);
  });

  it("P3/P12: ensures placeholder specificity (.markdown-body .mdlog-widget__placeholder) overrides .markdown-body button", () => {
    // 级联断言：选择器特异性与出现位置
    const buttonIndex = css.indexOf(".markdown-body button {");
    const placeholderIndex = css.indexOf(".markdown-body .mdlog-widget__placeholder {");
    expect(buttonIndex).toBeGreaterThan(-1);
    expect(placeholderIndex).toBeGreaterThan(-1);
    // .markdown-body .mdlog-widget__placeholder 声明位置在 .markdown-body button 之后
    expect(placeholderIndex).toBeGreaterThan(buttonIndex);

    // 显式断言占位块选择器包含 .markdown-body 前缀（特异性 0,2,0 > 0,1,1）
    expect(css).toMatch(/\.markdown-body\s+\.mdlog-widget__placeholder\s*\{/);
    expect(css).toMatch(/\.markdown-body\s+button\.mdlog-widget__placeholder:hover\s*\{/);
    expect(css).toMatch(/\.markdown-body\s+button\.mdlog-widget__placeholder:focus-visible\s*\{/);
    expect(css).toMatch(/\.markdown-body\s+button\.mdlog-widget__placeholder:active\s*\{/);
  });

  it("P3/C3: verifies true cascade in jsdom computed style for placeholder elements", () => {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const container = document.createElement("div");
    container.className = "markdown-body";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mdlog-widget__placeholder";
    button.textContent = "交互内容 · 点击加载";
    container.appendChild(button);

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "mdlog-widget__placeholder";
    loadingDiv.textContent = "交互准备中…";
    container.appendChild(loadingDiv);

    document.body.appendChild(container);

    const buttonComputed = window.getComputedStyle(button);
    expect(buttonComputed.minHeight).toBe("120px");
    expect(buttonComputed.borderRadius).toBe("0px");
    expect(buttonComputed.boxShadow).toBe("none");
    expect(buttonComputed.fontWeight).toBe("500");
    expect(buttonComputed.width).toBe("100%");
    expect(buttonComputed.padding).toBe("24px");
    expect(buttonComputed.display).toBe("flex");
    expect(buttonComputed.cursor).toBe("pointer");

    const divComputed = window.getComputedStyle(loadingDiv);
    expect(divComputed.minHeight).toBe("120px");
    expect(divComputed.borderRadius).toBe("0px");
    expect(divComputed.boxShadow).toBe("none");
    expect(divComputed.width).toBe("100%");
    expect(divComputed.padding).toBe("24px");
    expect(divComputed.display).toBe("flex");
    expect(divComputed.cursor).not.toBe("pointer");

    document.body.removeChild(container);
    document.head.removeChild(styleEl);
  });

  it("declares live indicator rules with 5x5px square dot and breathing animation", () => {
    // 打印段也有一条 .mdlog-live（display:none，排在前面）：这里要的是**屏幕态**那条，
    // 按「首个 mdlog widget 选择器之后」的区段取，避免命中打印段
    const liveRule =
      css.slice(css.indexOf(".mdlog-widget")).match(/\.mdlog-live\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(liveRule).toMatch(/margin:\s*30px 0 0/);
    expect(liveRule).toMatch(/color:\s*var\(--stone\)/);
    expect(liveRule).toMatch(/font:\s*10px\/1 var\(--mono\)/);
    expect(liveRule).toMatch(/letter-spacing:\s*2px/);

    const dotRule = css.match(/\.mdlog-live::before\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(dotRule).toMatch(/width:\s*5px/);
    expect(dotRule).toMatch(/height:\s*5px/);
    expect(dotRule).toMatch(/border-radius:\s*1px/);
    expect(dotRule).toMatch(/background:\s*var\(--brand\)/);
    expect(dotRule).toMatch(/animation:\s*mdlog-pulse 1\.6s ease infinite/);

    const motionRule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.mdlog-live::before\s*\{[^}]*animation:\s*none/s)?.[0] ?? "";
    expect(motionRule).toBeTruthy();
  });

  it("停帧降载：离屏 widget iframe 用 visibility:hidden（绝不能用 display:none）", () => {
    const rule = css.match(/\.mdlog-widget__frame--parked\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/visibility:\s*hidden/);
    // display:none 会把 iframe 布局高塌成 0 → 顶动整篇文档，实测过，别改回去
    expect(rule).not.toMatch(/display:\s*none/);
  });

  it("strictly obeys kami design constraints for mdlog rules: allowed radii, max weight 500, no raw colors", () => {    const startIndex = css.indexOf(".mdlog-widget");
    expect(startIndex).toBeGreaterThan(0);
    const mdlogSection = css.slice(startIndex);

    // 1. 圆角仅允许 ∈ {0, 1px, 2px, 3px, 4px, 6px}
    const radiiMatches = Array.from(mdlogSection.matchAll(/border-radius:\s*([^;]+);/g));
    const allowedRadii = new Set(["0", "1px", "2px", "3px", "4px", "6px"]);
    for (const match of radiiMatches) {
      const val = match[1].trim();
      expect(allowedRadii.has(val), `Disallowed border-radius in mdlog section: ${val}`).toBe(true);
    }

    // 2. font-weight 严格 ≤ 500
    const weightMatches = Array.from(mdlogSection.matchAll(/font-weight:\s*([^;]+);/g));
    for (const match of weightMatches) {
      const w = parseInt(match[1].trim(), 10);
      if (!Number.isNaN(w)) {
        expect(w).toBeLessThanOrEqual(500);
      }
    }

    // 3. 颜色仅允许使用 var(--*)、transparent 或 currentColor，严禁未声明的原始十六进制或 rgb
    const colorDeclarations = Array.from(
      mdlogSection.matchAll(/(?:color|background|border(?:-[a-z]+)?|box-shadow):\s*([^;]+);/g)
    );
    for (const match of colorDeclarations) {
      const decl = match[1];
      expect(decl).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(decl).not.toMatch(/rgba?\(/);
    }
  });
});

describe("kami.css editing view (block-level inline editing)", () => {
  it("编辑态区段位于首个 .mdlog-widget 之前，且自身不含该字样", () => {
    const editorSection = css.indexOf(".block-editor__input");
    const mdlogSection = css.indexOf(".mdlog-widget");

    expect(editorSection).toBeGreaterThan(-1);
    expect(editorSection).toBeLessThan(mdlogSection);

    // 区段以注释头起算：从「/* ===== 编辑视图」到首个 .mdlog-widget 之间不得出现 mdlog 字样
    // （kami.css.test.ts 的 mdlog 设计约束用例从首个 .mdlog-widget 扫到文件尾，
    //   编辑态规则跑到它之后就会被卷入那套扫描）
    const editorBlock = css.slice(css.indexOf("/* ===== 编辑视图"), mdlogSection);
    expect(editorBlock).not.toContain(".mdlog-widget");
  });

  it("编辑态宿主提供定位上下文", () => {
    expect(css).toMatch(/\.document-scroll__content--editing\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.block-editor__input\s*\{[^}]*position:\s*absolute/);
  });

  it("F23：覆盖层写成直接子元素选择器，不依赖 .markdown-body 后代选择器", () => {
    // 覆盖层刻意不进 .markdown-body（否则 .markdown-body textarea 的 0,1,1 会压过它），
    // 选择器必须是 .document-scroll__content--editing 的直接子元素（0,2,0）
    expect(css).toMatch(/\.document-scroll__content--editing\s*>\s*\.block-editor__input\s*\{/);
    expect(css).not.toMatch(/\.markdown-body[^{}]*\.block-editor__input/);

    const rule = css.match(/\.document-scroll__content--editing\s*>\s*\.block-editor__input\s*\{[^}]*\}/s)?.[0] ?? "";
    // 与 .markdown-body textarea 冲突的属性都要显式覆写，避免样式漂移
    // （设计定稿 2026-09-12，A2「页边字符」：覆盖层改为**透明底 + 零框线**，
    //  编辑信号移到块左页边的 ¶ 字符；冲突属性的显式归零不变）
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/border:\s*none/);
    expect(rule).toMatch(/box-shadow:\s*none/);
    expect(rule).toMatch(/border-radius:\s*0/);
  });

  it("F12/F18：包裹层 display: contents 且不带任何尺寸/边框/内外边距", () => {
    const rule = css.match(/\.markdown-body--editing\s+\.vellum-unit-wrap\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/display:\s*contents/);

    // display: contents 的元素不生成布局盒；一旦给它尺寸/边框/内外边距，
    // T3 的「隐藏原块 + 锁高 + 自增高」与包裹层的退布局承诺都会失真（裁定 F12/F18）
    for (const prop of ["width", "height", "margin", "padding", "border", "min-height", "max-height"]) {
      expect(rule, `包裹层不得声明 ${prop}`).not.toMatch(new RegExp(`(?:^|[;{\\s])${prop}\\s*:`));
    }
  });

  it("F31：提示条只做视觉淡入，消失机制不写在 CSS 里", () => {
    const rule = css.match(/\.editor-toast\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/pointer-events:\s*none/);
    // 消失由 hook 的 2.4s 定时器负责；forwards / 基础态 opacity:0 会让元素被 CSS 永久藏住
    expect(rule).not.toMatch(/fill-mode/);
    expect(rule).not.toMatch(/forwards/);
    expect(rule).not.toMatch(/opacity:\s*0\s*;/);
    expect(rule).not.toMatch(/display:\s*none/);
  });

  it("F40：重文档提示常驻且与提示条同一视觉语汇", () => {
    const rule = css.match(/\.editor-hint\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toBe("");
    // 与 .editor-toast 同一语汇：实色标签底 + 墨色字，字重不超过 kami 上限
    expect(rule).toMatch(/background:\s*var\(--tag-bg\)/);
    expect(rule).toMatch(/color:\s*var\(--near-black\)/);
    expect(rule).toMatch(/font:\s*500/);
    expect(rule).toMatch(/border-radius:\s*[2-6]px/);
    // 常驻提示：不得靠动画/隐藏伪装成「会自动消失」，也不得抢交互
    expect(rule).not.toMatch(/animation/);
    expect(rule).not.toMatch(/fill-mode|forwards|display:\s*none/);
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  it("编辑态三态视觉契约（2026-09-12 A2「页边字符」定稿）：hover 页边 ¶ / 只读页边灰 × / 激活 brand ¶", () => {
    // 只读块：零框线，只剩 not-allowed 光标；页边灰 × 由 ::before 承担（见下）
    const roRule = css.match(/\.markdown-body--editing \[data-vellum-locked\]\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(roRule).not.toBe("");
    expect(roRule).not.toMatch(/border/);
    expect(roRule).toMatch(/cursor:\s*not-allowed/);

    // display:contents 的包裹层（交互块）：子元素同样只留光标、不画框（旧的 2px dashed 已废除）
    const wrapRule = css.match(/\.markdown-body--editing \.vellum-unit-wrap\[data-vellum-locked\]\s*>\s*\*\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(wrapRule).not.toBe("");
    expect(wrapRule).not.toMatch(/border/);
    expect(wrapRule).toMatch(/cursor:\s*not-allowed/);

    // 旧形态的实物残留检查：粗灰虚线框与 hover 纸签底在整份 CSS 里不复存在
    expect(css).not.toContain("2px dashed #b9b6a9");
    expect(css).not.toMatch(/\[data-vellum-unit\]:not\(\[data-vellum-locked\]\):hover\s*\{[^}]*background/);

    // hover 页边 ¶：普通块画在自身 ::before 上；display:contents 包裹层画在首布局子元素上
    const hoverGlyph = css.match(/\.markdown-body--editing\s*>\s*\[data-vellum-unit\]:not\(\[data-vellum-locked\]\):not\(\.vellum-unit-wrap\)::before[^{]*\{[^}]*\}/s)?.[0] ?? "";
    expect(hoverGlyph).toMatch(/content:\s*"¶"/);
    const hoverShow = css.match(/:not\(\.vellum-unit-wrap\):hover::before[^{]*\{[^}]*\}/s)?.[0] ?? "";
    expect(hoverShow).not.toBe("");
    expect(hoverShow).toMatch(/color:\s*#a5a294/);

    // 只读页边 ×：块自身（HTML 块）与包裹层首子元素（交互块）两路并列
    expect(css).toMatch(/\.markdown-body--editing\s*>\s*\[data-vellum-locked\]::before[^{]*\{[^}]*content:\s*"×"/s);

    // 反裁剪红线：页边字符一律「绝对定位 + auto 偏移（静态位置）+ 负 margin 进页边」，
    // 绝不给块自身加 position:relative —— 否则代码块 / widget 根容器的
    // overflow:hidden 会把 -26px 处的字符整条裁掉（A2 探针实测）。
    expect(css).not.toMatch(/\[data-vellum-unit\][^{]*\{[^}]*position:\s*relative/);
    expect(hoverGlyph).toMatch(/position:\s*absolute/);
    expect(hoverGlyph).toMatch(/margin-left:\s*-26px/);

    // 覆盖层：透明底 + 零框线（编辑信号在页边，不在输入框上）
    const inputRule = css.match(/\.document-scroll__content--editing > \.block-editor__input\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(inputRule).not.toBe("");
    expect(inputRule).toMatch(/background:\s*transparent/);
    expect(inputRule).toMatch(/border:\s*none/);

    // 激活块的页边标记：brand 色 ¶，由 BlockEditor 随覆盖层渲染（.block-editor__mark）
    const markRule = css.match(/\.block-editor__mark\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(markRule).not.toBe("");
    expect(markRule).toMatch(/color:\s*var\(--brand\)/);
    expect(markRule).toMatch(/pointer-events:\s*none/);

    // 未保存提示：**无**（全自动保存的设计定稿——不保留任何未保存指示）
    expect(css).not.toMatch(/\.top-bar__dirty/);
  });
});

/// 2026-09-18 Owner 定稿的四项形态（①inline title ②属性卡去盒子 ④callout 素）。
/// 这些是设计约束：改样式前先读这里的断言，别把已经定下的形态改回去。
describe("kami.css 文档标题 / 属性卡 / 提示块定稿形态", () => {
  it("文档标题与正文同宽、贴顶上移，左缘逐像素对齐", () => {
    const rule = css.match(/\.document-title\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toMatch(/max-width:\s*min\(var\(--reader-column-width,\s*800px\),\s*100%\)/);
    expect(rule).toMatch(/margin:\s*0 auto/);
    expect(rule).toMatch(/padding:\s*0 32px/);
    // 与正文 H1 同级字号（Obsidian 的 inline title 与 H1 同尺度）
    expect(rule).toMatch(/font-size:\s*30px/);

    // 贴顶：有标题时正文区顶部留白从 70px 收窄，正文自身不再叠 40px 顶距（:has() 判定）
    expect(css).toMatch(/\.document-scroll__content:has\(\.document-title\)\s*\{[^}]*padding-top:\s*42px/s);
    expect(css).toMatch(/\.document-content:has\(\.document-title\)\s+\.markdown-body\s*\{[^}]*padding-top:\s*20px/s);
  });

  it("属性卡去外框与底色，改成上下发丝线的键值两列表", () => {
    const card = css.match(/\.md-props\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(card).not.toBe("");
    expect(card).not.toMatch(/background/);
    expect(card).not.toMatch(/border:\s*1px solid/);
    expect(card).not.toMatch(/border-radius/);
    expect(card).toMatch(/border-top:\s*1px solid var\(--hairline\)/);

    const row = css.match(/\.md-props__row\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(row).toMatch(/display:\s*grid/);
    expect(row).toMatch(/grid-template-columns:\s*78px minmax\(0,\s*1fr\)/);
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--hairline\)/);

    // tags 退成中点分隔的普通文字：不再有蓝底 chip
    const chip = css.match(/\.md-props__chip\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(chip).not.toMatch(/background/);
    expect(chip).toMatch(/color:\s*var\(--olive\)/);
    expect(css).toMatch(/\.md-props__chip \+ \.md-props__chip::before\s*\{[^}]*content:\s*"· "/s);
  });

  it("callout 为素形态：无底色、发丝竖线，type 靠标题字色区分", () => {
    const callout = css.match(/\.markdown-body blockquote\.callout\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(callout).not.toBe("");
    expect(callout).not.toMatch(/background/);
    expect(callout).toMatch(/border-left:\s*2px solid var\(--hairline\)/);
    expect(callout).toMatch(/border-radius:\s*0/);

    const title = css.match(/\.markdown-body \.callout__title\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(title).toMatch(/color:\s*var\(--brand\)/);

    // 警示族：竖线沉一档 + 标题转淡墨，不引第二个色相
    const warn = css.match(/\.markdown-body blockquote\.callout--warning,[^}]*\}/s)?.[0] ?? "";
    expect(warn).toMatch(/border-left-color:\s*var\(--stone\)/);
    expect(warn).not.toMatch(/background/);
  });
});

/// 阅读设置（2026-09-20，reader-polish task-2）：正文字号 / 栏宽 / 行高走
/// --reader-font-size / --reader-column-width / --reader-line-height 三个根变量，
/// 由 useReaderSettings 在 documentElement 上覆写；消费处必须带默认值回退。
/// 标题字号阶梯（30/21/17）与行内 code 的 12px 不随设置缩放。
describe("kami.css 阅读设置变量消费", () => {
  it(":root 声明三个阅读变量的默认值，死变量 --content-max-width 已移除", () => {
    const root = css.match(/:root\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(root).toMatch(/--reader-font-size:\s*14px/);
    expect(root).toMatch(/--reader-column-width:\s*800px/);
    expect(root).toMatch(/--reader-line-height:\s*1\.55/);
    expect(css).not.toContain("--content-max-width");
  });

  it("正文列宽消费 --reader-column-width（默认值 800px 回退）", () => {
    const rule = css.match(/\.markdown-body,\s*\.empty-state,\s*\.error-state\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toMatch(/max-width:\s*min\(var\(--reader-column-width,\s*800px\),\s*100%\)/);
  });

  it("正文字号与行高消费变量并带默认值回退；列表行高跟随正文", () => {
    const body = css.match(/\.markdown-body\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(body).toMatch(/font-size:\s*var\(--reader-font-size,\s*14px\)/);
    expect(body).toMatch(/line-height:\s*var\(--reader-line-height,\s*1\.55\)/);

    const lists = css.match(/\.markdown-body ul,\s*\.markdown-body ol\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(lists).toMatch(/line-height:\s*inherit/);
  });

  it("表格字号比正文小一档并跟随变量；行内 code 保持 12px 不变", () => {
    const table = css.match(/\.markdown-body table\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(table).toMatch(/font-size:\s*calc\(var\(--reader-font-size,\s*14px\)\s*-\s*1px\)/);

    const inlineCode = css.match(/\.markdown-body code\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(inlineCode).toMatch(/font-size:\s*12px/);
  });

  it("标题字号阶梯保持设计定稿（h1 30 / h2 21 / h3 17），不随正文字号缩放", () => {
    // 用全文件匹配而非首个命中：窄屏媒体查询里另有一组缩档字号（25px 等），不能误取
    expect(css).toMatch(/\.markdown-body h1\s*\{[^}]*font-size:\s*30px/s);
    expect(css).toMatch(/\.markdown-body h2\s*\{[^}]*font-size:\s*21px/s);
    expect(css).toMatch(/\.markdown-body h3\s*\{[^}]*font-size:\s*17px/s);
  });

  it("设置弹层样式位于首个 .mdlog-widget 之前（避开 mdlog 区段的设计约束扫描）", () => {
    const popoverIndex = css.indexOf(".settings-popover {");
    const mdlogIndex = css.indexOf(".mdlog-widget");
    expect(popoverIndex).toBeGreaterThan(-1);
    expect(popoverIndex).toBeLessThan(mdlogIndex);
  });
});

describe("kami.css reader-polish task-3 小修（2026-09-20）", () => {
  it("空态/错态眉题与实色按钮样式补齐（EmptyState/ErrorState 引用的类不再缺失）", () => {
    const eyebrow = css.match(/\.empty-eyebrow\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(eyebrow).not.toBe("");
    expect(eyebrow).toMatch(/font:\s*500 10px/);
    expect(eyebrow).toMatch(/letter-spacing:\s*4px/);
    expect(eyebrow).toMatch(/color:\s*var\(--stone\)/);

    const button = css.match(/\.button\.button-primary\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(button).not.toBe("");
    expect(button).toMatch(/background:\s*var\(--warm-sand\)/);
    expect(button).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--hairline\)/);
    expect(button).toMatch(/border-radius:\s*6px/);
    expect(button).toMatch(/padding:\s*7px 16px/);
    expect(button).toMatch(/font-weight:\s*500/);
    // 高度写死：空态「打开文件…」与错态「重新打开」在两个页面里逐像素同高
    expect(button).toMatch(/height:\s*32px/);

    const hover = css.match(/\.button\.button-primary:hover\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(hover).toMatch(/0 1px 2px rgba\(20,\s*20,\s*19,\s*0\.04\)/);

    // 按下态：只压深底色，不位移（正文 button:active 的 1px 下沉是正文控件的语汇）
    const active = css.match(/\.button\.button-primary:active\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(active).not.toBe("");
    expect(active).toMatch(/background:\s*color-mix/);
    expect(active).not.toMatch(/transform/);
  });

  it("搜索框清除按钮：幽灵小按钮规格（16×16 命中区），hover 转 brand", () => {
    const clear = css.match(/\.outline-search__clear\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(clear).not.toBe("");
    expect(clear).toMatch(/width:\s*16px/);
    expect(clear).toMatch(/height:\s*16px/);

    // 与上/下导航共用 .outline-search__nav 的幽灵语汇：stone 图标、hover warm-sand 底 + brand
    const nav = css.match(/\.outline-search__nav\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(nav).toMatch(/background:\s*transparent/);
    expect(nav).toMatch(/color:\s*var\(--stone\)/);
    const navHover = css.match(/\.outline-search__nav:hover\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(navHover).toMatch(/background:\s*var\(--warm-sand\)/);
    expect(navHover).toMatch(/color:\s*var\(--brand\)/);

    // 两条同为 0,1,0：尺寸覆写必须排在 .outline-search__nav 之后才生效
    expect(css.search(/^\.outline-search__clear\s*\{/m)).toBeGreaterThan(
      css.search(/^\.outline-search__nav\s*\{/m)
    );
    expect(css.indexOf(".outline-search__clear")).toBeLessThan(css.indexOf(".mdlog-widget"));
  });

  it("document-scroll 键盘聚焦给 1px 靛青内描边（克制款 focus-visible）", () => {
    const rule = css.match(/\.document-scroll:focus-visible\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--brand\)/);
  });

  it("顶栏记录中小章与 editor-toast 同族（tag-bg 底 + mono 10px）", () => {
    const chip = css.match(/\.top-bar__recording\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(chip).not.toBe("");
    expect(chip).toMatch(/background:\s*var\(--tag-bg\)/);
    expect(chip).toMatch(/color:\s*var\(--brand\)/);
    expect(chip).toMatch(/font:\s*500 10px/);
    // 新规则不得落入 mdlog 区段扫描范围
    expect(css.indexOf(".top-bar__recording")).toBeLessThan(css.indexOf(".mdlog-widget"));
  });
});

describe("kami.css reader-polish task-4 新增（2026-09-20）", () => {
  it("拖放提示态：正文区 1px 靛青内描边，transition 写全两个属性，reduced-motion 关停", () => {
    const rule = css.match(/\.document-scroll--drop-target\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--brand\)/);
    // 本规则覆盖 .document-scroll 的 transition 简写：漏写 margin-left 会把侧栏开关的
    // 宽度过渡一起关掉（这正是「一条规则覆盖另一条简写」的隐性代价）
    expect(rule).toMatch(/margin-left 250ms/);

    const motion =
      css.match(
        /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.document-scroll--drop-target\s*\{[^}]*transition:\s*none/s
      )?.[0] ?? "";
    expect(motion).not.toBe("");

    // 新规则都在首个 .mdlog-widget 之前（不进 mdlog 区段的设计约束扫描）
    expect(css.indexOf(".document-scroll--drop-target")).toBeLessThan(css.indexOf(".mdlog-widget"));
  });

  it("最近列表（空态/错误态共用）：行内按钮无框线、hover ivory 底 + 文件名靛青，文件名 500 字重、目录 mono 10px stone", () => {
    const link = css.match(/\.recent-files__link\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(link).not.toBe("");
    expect(link).toMatch(/background:\s*transparent/);
    expect(link).toMatch(/border:\s*0/);
    expect(link).toMatch(/border-radius:\s*3px/);
    expect(link).toMatch(/transition:\s*background 0\.15s ease/);

    const hover = css.match(/\.recent-files__link:hover\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(hover).toMatch(/background:\s*var\(--ivory\)/);

    const hoverName =
      css.match(/\.recent-files__link:hover\s+\.recent-files__name\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(hoverName).toMatch(/color:\s*var\(--brand\)/);

    const name = css.match(/\.recent-files__name\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(name).toMatch(/font-weight:\s*500/);

    const dir = css.match(/\.recent-files__dir\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(dir).toMatch(/font:\s*10px\/1\.5 var\(--mono\)/);
    expect(dir).toMatch(/color:\s*var\(--stone\)/);

    // 列表行是键盘可达的按钮：必须给 focus-visible 描边
    const focus = css.match(/\.recent-files__link:focus-visible\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(focus).toMatch(/outline:\s*2px solid var\(--brand\)/);

    const motion =
      css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.recent-files__link[^}]*transition:\s*none/s)?.[0] ?? "";
    expect(motion).not.toBe("");

    expect(css.indexOf(".recent-files")).toBeLessThan(css.indexOf(".mdlog-widget"));
  });

  it("拖放提示行带 .empty-state 前缀（同级的 .empty-state p 是 0,1,1，裸类名压不过它）", () => {
    expect(css).toMatch(/\.empty-state\s+\.empty-hint\s*\{/);
    expect(css).not.toMatch(/^\.empty-hint\s*\{/m);

    const rule = css.match(/\.empty-state\s+\.empty-hint\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toMatch(/color:\s*var\(--stone\)/);
    expect(rule).toMatch(/font-size:\s*11px/);
  });
});

describe("kami.css reader-polish task-7 大纲深层级（2026-09-20）", () => {
  it("l4–l6 缩进在 l3 之上每级 +14px、字号 12px，色阶 olive → stone（不引新颜色）", () => {
    const l4 = css.match(/\.outline-panel__link--l4\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(l4).not.toBe("");
    expect(l4).toMatch(/padding-left:\s*30px/);
    expect(l4).toMatch(/font-size:\s*12px/);
    expect(l4).toMatch(/color:\s*var\(--olive\)/);

    const l5 = css.match(/\.outline-panel__link--l5\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(l5).not.toBe("");
    expect(l5).toMatch(/padding-left:\s*44px/);
    expect(l5).toMatch(/font-size:\s*12px/);
    expect(l5).toMatch(/color:\s*var\(--stone\)/);

    const l6 = css.match(/\.outline-panel__link--l6\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(l6).not.toBe("");
    expect(l6).toMatch(/padding-left:\s*58px/);
    expect(l6).toMatch(/font-size:\s*12px/);
    expect(l6).toMatch(/color:\s*var\(--stone\)/);
  });

  it("层级配色排在激活态规则之前（同为 0,1,0 特异度，靠顺序让靛青压过它）", () => {
    // 用行首锚定的正则取**规则**位置：注释里提到过激活态选择器，indexOf 会命中注释
    const l6Rule = css.search(/^\.outline-panel__link--l6\s*\{/m);
    const activeRule = css.search(/^\.outline-panel__link--active\s*\{/m);
    expect(l6Rule).toBeGreaterThan(-1);
    expect(activeRule).toBeGreaterThan(-1);
    expect(activeRule).toBeGreaterThan(l6Rule);
  });

  it("深层级规则落在既有 outline 段落内，且在首个 .mdlog-widget 之前", () => {
    const l4Rule = css.search(/^\.outline-panel__link--l4\s*\{/m);
    expect(l4Rule).toBeGreaterThan(css.indexOf(".outline-panel__list .outline-panel__list"));
    expect(l4Rule).toBeLessThan(css.indexOf(".outline-search {"));
    expect(l4Rule).toBeLessThan(css.indexOf(".mdlog-widget"));
  });

  it("真级联：激活态压过 l5 的层级配色（同特异度靠顺序，jsdom 计算样式）", () => {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const make = (className: string) => {
      const el = document.createElement("button");
      el.className = className;
      el.textContent = "Detail";
      document.body.appendChild(el);
      return el;
    };
    const plain = make("outline-panel__link outline-panel__link--l5");
    const active = make("outline-panel__link outline-panel__link--l5 outline-panel__link--active");

    const plainColor = window.getComputedStyle(plain).color;
    const activeColor = window.getComputedStyle(active).color;
    expect(plainColor).toContain("stone");
    expect(activeColor).toContain("brand");
    expect(activeColor).not.toBe(plainColor);

    document.body.removeChild(plain);
    document.body.removeChild(active);
    document.head.removeChild(styleEl);
  });
});

describe("kami.css reader-polish task-8 任务列表勾选（2026-09-20）", () => {
  it("可点复选框：hover / 键盘聚焦给 1px 靛青描边，光标 pointer", () => {
    const base = css.match(
      /\.markdown-body \.task-list-item input\[type="checkbox"\]:not\(:disabled\)\s*\{[^}]*\}/s
    )?.[0] ?? "";
    expect(base).not.toBe("");
    expect(base).toMatch(/cursor:\s*pointer/);

    const hover = css.match(
      /\.markdown-body \.task-list-item input\[type="checkbox"\]:not\(:disabled\):hover,\s*\.markdown-body \.task-list-item input\[type="checkbox"\]:not\(:disabled\):focus-visible\s*\{[^}]*\}/s
    )?.[0] ?? "";
    expect(hover).not.toBe("");
    expect(hover).toMatch(/outline:\s*1px solid var\(--brand\)/);
    expect(hover).toMatch(/outline-offset:\s*1px/);

    // 新规则都在首个 .mdlog-widget 之前（不进 mdlog 区段的设计约束扫描）
    expect(css.indexOf(".task-list-item input")).toBeLessThan(css.indexOf(".mdlog-widget"));
  });

  it("真选择器判定：只有 GFM 任务项里**可点**的复选框才拿到可点提示", () => {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const body = document.createElement("div");
    body.className = "markdown-body";
    document.body.appendChild(body);
    const selector = '.markdown-body .task-list-item input[type="checkbox"]:not(:disabled)';

    const make = (disabled: boolean, taskItem: boolean) => {
      const wrapper = document.createElement(taskItem ? "li" : "div");
      if (taskItem) wrapper.className = "task-list-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.disabled = disabled;
      wrapper.appendChild(input);
      body.appendChild(wrapper);
      return input;
    };

    const clickable = make(false, true);   // GFM 任务项（阅读视图）
    const editView = make(true, true);     // 编辑视图 / 原始 HTML 写死的 disabled
    const rawHtml = make(false, false);    // 原始 HTML 里的复选框（不在任务项里）

    expect(clickable.matches(selector)).toBe(true);
    expect(editView.matches(selector)).toBe(false);
    expect(rawHtml.matches(selector)).toBe(false);
    expect(window.getComputedStyle(clickable).cursor).toBe("pointer");

    document.body.removeChild(body);
    document.head.removeChild(styleEl);
  });
});

/// reader-polish task-9（2026-09-20）：打印只做「隐藏界面件 / 放开版心 / 保护分页」。
/// 本区段是打印段的**位置与内容**契约：主段不含 `.mdlog-widget` 字样且排在首个该选择器
/// 之前，含该字样的交互块打印规则在文件末尾（约束 8，mdlog 设计约束扫描从首个出现处起算）。
describe("kami.css reader-polish task-9 打印样式（2026-09-20）", () => {
  const printStart = css.indexOf("/* ===== 打印");
  const mdlogIndex = css.indexOf(".mdlog-widget");
  const printBlock = css.slice(printStart, mdlogIndex);
  const trailingBlock = css.slice(css.lastIndexOf("@media print"));

  it("主打印段排在首个 .mdlog-widget 之前，且自身不含该字样（否则会把扫描起点提前）", () => {
    expect(printStart).toBeGreaterThan(-1);
    expect(printStart).toBeLessThan(mdlogIndex);
    expect(printBlock).not.toContain(".mdlog-widget");
    expect(printBlock).toMatch(/@media\s*print\s*\{/);
  });

  it("打印隐藏清单：顶栏 / 侧栏 / 拖宽手柄 / 纱罩 / 滚动条 / 跳底 / 印章 / 提示条 / 设置弹层 / 记录中章", () => {
    const hiddenRule = printBlock.match(/\.top-bar,\s*[\s\S]*?display:\s*none;/)?.[0] ?? "";
    expect(hiddenRule).not.toBe("");
    for (const selector of [
      ".top-bar",
      ".outline-sidebar",
      ".outline-resize-handle",
      ".outline-scrim",
      ".custom-scrollbar",
      ".jump-bottom",
      ".reload-note",
      ".editor-toast",
      ".editor-hint",
      ".settings-popover",
      ".mdlog-live",
    ]) {
      expect(hiddenRule, `打印隐藏清单缺 ${selector}`).toContain(selector);
    }
  });

  it("版心放开：外壳改内容高度、溢出可见，列宽放开到 100%，侧栏位移归零", () => {
    const shellRule = printBlock.match(/\.app-shell,\s*[\s\S]*?\{[^}]*\}/s)?.[0] ?? "";
    expect(shellRule).not.toBe("");
    // 屏幕态的 100vh + overflow:hidden/scroll 不放开就只印得出第一屏
    expect(shellRule).toContain(".app-shell__body");
    expect(shellRule).toContain(".document-scroll");
    expect(shellRule).toContain(".document-scroll__content");
    expect(shellRule).toMatch(/height:\s*auto/);
    expect(shellRule).toMatch(/min-height:\s*0/);
    expect(shellRule).toMatch(/overflow:\s*visible/);

    const widthRule = printBlock.match(/\.markdown-body,\s*\.document-title\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(widthRule).not.toBe("");
    expect(widthRule).toMatch(/max-width:\s*100%/);

    // 侧栏已隐藏：--outline-shift 的正文位移（0,2,0）必须显式压掉
    expect(printBlock).toMatch(
      /\.app-shell__body--outline-open\s+\.document-scroll\s*\{[^}]*margin-left:\s*0/
    );

    // 正文区上下留白归零，且 :has(.document-title) 的 42px 覆写（同为 0,2,0）一起压住
    const contentRule =
      printBlock.match(/\.document-scroll__content,\s*\.document-scroll__content:has\(\.document-title\)\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(contentRule).not.toBe("");
    expect(contentRule).toMatch(/padding:\s*0/);
  });

  it("打印覆写一律排在屏幕态规则之后（同特异度靠顺序取胜）", () => {
    expect(printStart).toBeGreaterThan(css.search(/^\.top-bar\s*\{/m));
    expect(printStart).toBeGreaterThan(css.search(/^\.document-title\s*\{/m));
    expect(printStart).toBeGreaterThan(css.search(/\.app-shell__body--outline-open\s+\.document-scroll/));
    expect(printStart).toBeGreaterThan(css.search(/^\.document-scroll__content:has\(\.document-title\)\s*\{/m));
    expect(printStart).toBeGreaterThan(css.search(/^\.markdown-body,\s*$/m));
  });

  it("屏幕态未被打印段染指：顶栏与文档标题的基础规则里没有 display:none", () => {
    const topBar = css.match(/^\.top-bar\s*\{[^}]*\}/m)?.[0] ?? "";
    expect(topBar).not.toMatch(/display:\s*none/);
    const title = css.match(/^\.document-title\s*\{[^}]*\}/m)?.[0] ?? "";
    expect(title).not.toMatch(/display:\s*none/);
    expect(title).toMatch(/max-width:\s*min\(var\(--reader-column-width,\s*800px\),\s*100%\)/);
    // 打印段只出现在这两处（主段 + 末尾交互块段），没有第三段散落
    expect(Array.from(css.matchAll(/@media\s*print\s*\{/g)).length).toBe(2);
  });

  it("分页保护：代码块 / 表格 / 引用 / 图片不跨页，标题不在页脚断行", () => {
    const breakRule = printBlock.match(/\.code-block,\s*[\s\S]*?break-inside:\s*avoid;/)?.[0] ?? "";
    expect(breakRule).not.toBe("");
    for (const selector of [
      ".code-block",
      ".markdown-body pre",
      ".markdown-body table",
      ".markdown-body blockquote",
      ".markdown-body img",
    ]) {
      expect(breakRule, `分页保护缺 ${selector}`).toContain(selector);
    }

    const headingRule = printBlock.match(/\.document-title,\s*\.markdown-body h1,[\s\S]*?break-after:\s*avoid;/)?.[0] ?? "";
    expect(headingRule).not.toBe("");
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      expect(headingRule, `标题分页保护缺 ${level}`).toContain(`.markdown-body ${level}`);
    }
    expect(headingRule).toContain(".document-title");
  });

  it("交互块打印规则（含 .mdlog-widget 字样）排在首个该选择器之后：隐 chrome 题头栏、恢复停帧 iframe", () => {
    expect(css.lastIndexOf("@media print")).toBeGreaterThan(mdlogIndex);
    expect(trailingBlock).toContain(".mdlog-widget__bar");
    expect(trailingBlock).toMatch(/@media\s*print\s*\{/);

    const barRule = trailingBlock.match(/\.mdlog-widget__bar\s*\{[^}]*\}/)?.[0] ?? "";
    expect(barRule).toMatch(/display:\s*none/);

    // 停帧是按屏幕视口判定的：打印时落在后几页的 widget 必须恢复可见，否则整块空白
    const parkedRule = trailingBlock.match(/\.mdlog-widget__frame--parked\s*\{[^}]*\}/)?.[0] ?? "";
    expect(parkedRule).toMatch(/visibility:\s*visible/);
    expect(parkedRule).not.toMatch(/display:\s*none/);

    // 末尾段只加显示属性，不得夹带配色/字重（它会落进 mdlog 区段的设计约束扫描）
    expect(trailingBlock).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(trailingBlock).not.toMatch(/rgba?\(/);
    expect(trailingBlock).not.toMatch(/border-radius/);
    expect(trailingBlock).not.toMatch(/font-weight/);
  });
});
