# 交互 widget：设计准则与配方

只在 `SKILL.md` 步骤 1 选了交互 widget 时读。外壳（token、字体栈、通信 IIFE、`prefers-reduced-motion`）从 `assets/widget-template.html` 起手，这里只给**内核**。

## 设计准则

- **默认态自己讲得通**：不碰控件，首屏已是一幅完整的图；交互只是加深。
- **一个演示回答一个问题**：控件 ≤ 3 个，每个都有标签与当前值。
- **重置一步到位**：必备「重置」，回到默认态。
- **状态写成文字**：当前参数、步骤、结论用文字写在图旁，颜色变化只做辅助。
- **步进优于自动播放**：教学演示给「上一步 / 下一步」；要自动播放就给暂停，并守契约 4 的帧预算。
- **原生控件**：`<button>`、`<input type="range">`，键盘与读屏免费可用。
- **一屏内可读**：高度按一屏设计；确需滚动就自备内层容器。

## 配方一：步进器（最常用）

状态机一次只亮一步；说明文字与图同步换。步骤数据放一个数组，图元用 `data-step` 标记。

```html
<svg viewBox="0 0 560 160" id="fig"> … <g data-step="0">…</g> <g data-step="1">…</g> … </svg>
<p id="say" aria-live="polite"></p>
<button id="prev" class="btn">上一步</button>
<button id="next" class="btn">下一步</button>
<button id="reset" class="btn">重置</button>
<script>
  const STEPS = ["第 0 步的一句话", "第 1 步的一句话", "第 2 步的一句话"];
  let i = 0;
  function show() {
    document.querySelectorAll("[data-step]").forEach(function (g) {
      g.style.opacity = Number(g.dataset.step) <= i ? 1 : 0.15;   // 已走过的亮，未到的淡
    });
    document.getElementById("say").textContent = (i + 1) + " / " + STEPS.length + "　" + STEPS[i];
    document.getElementById("prev").disabled = i === 0;
    document.getElementById("next").disabled = i === STEPS.length - 1;
  }
  document.getElementById("prev").onclick  = function () { i = Math.max(0, i - 1); show(); };
  document.getElementById("next").onclick  = function () { i = Math.min(STEPS.length - 1, i + 1); show(); };
  document.getElementById("reset").onclick = function () { i = 0; show(); };
  show();
</script>
```

过渡写在 CSS：`[data-step]{transition:opacity .2s}`；`prefers-reduced-motion` 豁免已在模板里。

## 配方二：滑杆驱动 SVG

滑杆改一个数，`render()` 重算整幅图的属性。图元少（≤ 几十个）时直接改 SVG 属性，比 canvas 省事且随宽自适应。

```html
<input type="range" id="k" min="1" max="8" value="3">
<span id="kv">3</span>
<script>
  const k = document.getElementById("k");
  function render() {
    const n = Number(k.value);
    document.getElementById("kv").textContent = n;
    document.getElementById("bar").setAttribute("width", n * 40);
  }
  k.addEventListener("input", render);
  render();
</script>
```

图元成百上千、或每帧重绘时才改用 canvas（模板里有 `resizeCanvas` + `draw` 范式，须监听 `resize`）。

## 配方三：标签页 / 对照开关

同一块区域两种视图（写法 A / 写法 B，优化前 / 优化后）。两份内容都在 DOM 里，切换只改 `hidden`，这样默认态与高度都稳定。

```html
<button class="btn active" data-tab="a">写法 A</button>
<button class="btn" data-tab="b">写法 B</button>
<section id="pane-a">…</section>
<section id="pane-b" hidden>…</section>
<script>
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("active", x === b); });
      document.getElementById("pane-a").hidden = b.dataset.tab !== "a";
      document.getElementById("pane-b").hidden = b.dataset.tab !== "b";
    };
  });
</script>
```

两个面板高度差很大时，通信 IIFE 的 `ResizeObserver` 会随切换上报新高度，宿主平滑伸缩；差距过大会让正文跳动，宁可让两面板等高。

## 配方四：悬停高亮 + 说明

图元 `mouseenter` 时在固定位置的说明栏写出含义，`mouseleave` 回到默认提示。说明栏位置固定，免得文字跳动。触屏没有悬停，同时挂 `click`。

```js
document.querySelectorAll("[data-tip]").forEach(function (el) {
  const on = function () { tip.textContent = el.dataset.tip; el.classList.add("hot"); };
  const off = function () { tip.textContent = "指向图中任一部分查看说明"; el.classList.remove("hot"); };
  el.addEventListener("mouseenter", on); el.addEventListener("mouseleave", off); el.addEventListener("click", on);
});
```

## 沙箱里不要做的事

- `<a href>`：沙箱内不会导航；引用外部资料写在围栏外的正文里。
- `alert` / `confirm` / `prompt`：沙箱无 `allow-modals`，调用会被忽略。
- `localStorage` 等持久化：会抛 `SecurityError` 让整段脚本崩掉（契约 3）。
- `fetch` / 外链资源：CSP 全拦（契约 2）。
