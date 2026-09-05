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

    const placeholderHoverRule = css.match(/\.markdown-body\s+\.mdlog-widget__placeholder:hover\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderHoverRule).toMatch(/background:\s*var\(--ivory\)/);
    expect(placeholderHoverRule).toMatch(/color:\s*var\(--brand\)/);

    // P12: 占位块/休眠块补 :focus-visible 2px --brand 描边
    const placeholderFocusRule = css.match(/\.markdown-body\s+\.mdlog-widget__placeholder:focus-visible\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderFocusRule).toMatch(/outline:\s*2px solid var\(--brand\)/);
    expect(placeholderFocusRule).toMatch(/outline-offset:\s*-2px/);
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
    expect(css).toMatch(/\.markdown-body\s+\.mdlog-widget__placeholder:hover\s*\{/);
    expect(css).toMatch(/\.markdown-body\s+\.mdlog-widget__placeholder:focus-visible\s*\{/);
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
