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
    const liveRule = css.match(/\.mdlog-live\s*\{[^}]*\}/s)?.[0] ?? "";
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

  it("strictly obeys kami design constraints for mdlog rules: allowed radii, max weight 500, no raw colors", () => {
    const startIndex = css.indexOf(".mdlog-widget");
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
    // （设计定稿 2026-09-10：覆盖层由「无线框 + 左竖线」改为「纸签底 + 实线外框」，
    //  故这里断言的是新形态：背景/边框/圆角均由本规则显式给出）
    expect(rule).toMatch(/background:\s*var\(--ivory\)/);
    expect(rule).toMatch(/border:\s*1px solid var\(--brand\)/);
    expect(rule).toMatch(/box-shadow:\s*none/);
    // 圆角取 kami 的轻尺度（仍不得沿用阅读态输入控件的 6px）
    expect(rule).toMatch(/border-radius:\s*3px/);
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

  it("编辑态三态视觉契约（2026-09-10 设计定稿）：只读粗虚线框 / 可编辑 hover 纸签底 / 覆盖层实框", () => {
    // 只读块：加粗灰色虚线框 + not-allowed，且不得再有任何文字提示样式常驻
    const roRule = css.match(/\.markdown-body--editing \[data-vellum-locked\]\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(roRule).not.toBe("");
    expect(roRule).toMatch(/border:\s*2px dashed/);
    expect(roRule).toMatch(/cursor:\s*not-allowed/);

    // display:contents 的包裹层（代码块 / 交互块 / 数学块）：外框画在子元素上
    const wrapRule = css.match(/\.markdown-body--editing \.vellum-unit-wrap\[data-vellum-locked\]\s*>\s*\*\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(wrapRule).not.toBe("");
    expect(wrapRule).toMatch(/border:\s*2px dashed/);

    // 覆盖层：纸签底 + 实线外框（与只读虚线成对区分），且不再有左侧竖线
    const inputRule = css.match(/\.document-scroll__content--editing > \.block-editor__input\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(inputRule).not.toBe("");
    expect(inputRule).toMatch(/background:\s*var\(--ivory\)/);
    expect(inputRule).toMatch(/border:\s*1px solid var\(--brand\)/);
    expect(inputRule).not.toMatch(/border-left/);

    // 未保存提示：**无**（全自动保存的设计定稿——不保留任何未保存指示）
    expect(css).not.toMatch(/\.top-bar__dirty/);
  });
});
