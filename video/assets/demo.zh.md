# 纸的界面

屏幕是光源，纸是表面。下面这些，都是在试着让一份 Markdown 文件像后者。

> 好的排版是看不见的。只有它消失了，你才会注意到它——当行宽和眼睛打架，或者标题
> 的字重在该说话的地方喊起来。

## 为什么是纸

阅读是低带宽的动作，却要付高带宽的代价。眼睛靠跳动前进，跳动需要稳定的节奏，而节奏
会被一切不是文字的东西打断：边框、栏距、卡片、分隔线、渐变。

于是界面把它们都去掉。结构只由四样东西承担——`font-size`、`font-weight`、留白，以及
`parchment` 与 `ivory` 之间 3% 的明度差。整页只有一种彩色，占比不超过 5%，而且从不
用来填充。

### 留下来的

- 一组内容结束处的发丝线
- 大纲：它只是文档的地图，仅此而已
- 行内代码，因为它是另一种材质，就该看起来像另一种材质
- 脚注，折在页边，等你来问

## 排版

### 字号阶梯

| 元素 | 字号 | 字重 | 行高 |
| --- | --- | --- | --- |
| `h1` | 30px | 500 | 1.2 |
| `h2` | 21px | 500 | 1.25 |
| `h3` | 17px | 500 | 1.3 |
| 正文 | 14px | 400 | 1.55 |
| 代码 | 12px | 400 | 1.5 |

字重的上限是 500。今楷到了 700 就不再是一个声音，而是一块色斑——层级只能来自字号
和空气。

### 字距

中文要字距，同样字号下的拉丁文不要。正文因此停在 `0.4px` 的字距上，而衬线只在标题、
引用，以及读者确实要「读」而不是「扫」的地方出现。

- [x] 正文用衬线
- [x] 代码、计数与快捷键提示用等宽
- [ ] 引入第三种字族

## 渲染管线

一份文档只解析一次成 MDAST，净化之后交给编辑器用的同一批块。

```ts
type EditUnit = {
  index: number;
  start: number;
  end: number;
  editable: boolean;
};

export function buildEditUnits(source: string): EditUnit[] {
  const tree = fromMarkdown(source, { extensions: [gfm()] });
  return flatten(tree).map((node, index) => ({
    index,
    start: node.position!.start.offset!,
    end: node.position!.end.offset!,
    // Structural containers stay read-only: splicing a list item would
    // desynchronise the offsets of every unit after it.
    editable: isLeafBlock(node),
  }));
}
```

Rust 那一半不好看但必须有人做：路径解析、编码探测，以及一个只在磁盘字节确实不同于
编辑器上次写回的内容时才触发的观察者。

```rust
pub fn save_document(path: &Path, markdown: &str) -> Result<(), String> {
    if mdlog_is_live()? {
        return Err("mdlog session in progress".into());
    }
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, markdown.as_bytes()).map_err(io_err)?;
    fs::rename(&tmp, path).map_err(io_err)
}
```

## 数学

行内公式要防住货币陷阱——`$5 和 $10` 还是钱，而 $e^{i\pi} + 1 = 0$ 会渲染出来。
行间公式有自己的列：

$$
f(x) \;=\; \frac{a_0}{2} \;+\; \sum_{n=1}^{\infty}\left(a_n\cos\frac{n\pi x}{L} + b_n\sin\frac{n\pi x}{L}\right)
$$

![傅里叶合成：部分和向方波收敛](figure.png)

## 现场会话

文档不总是由人写完的。当 agent 往文件里写，Vellum 跟着尾巴走，却不抢你的滚动位置，
也不会把没有变化的块重新排一遍。

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>渲染管线</title>
<style>
  :root {
    --parchment: #f5f4ed; --ivory: #faf9f5; --warm-sand: #e8e6dc;
    --near-black: #141413; --dark-warm: #3d3d3a; --stone: #6b6a64;
    --brand: #1B365D; --hairline: #dddacc; --border: #e8e6dc;
    --font-serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif;
    --font-mono: "JetBrains Mono", "SF Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 14px 16px; background: var(--ivory);
    font-family: var(--font-serif); color: var(--dark-warm); font-size: 15px;
  }
  svg { display: block; width: 100%; height: auto; }
  .label { font-size: 13px; fill: var(--near-black); }
  .sub { font-size: 11.5px; fill: var(--stone); }
  .latin { font-family: var(--font-mono); }
  .box { fill: var(--parchment); stroke: var(--border); stroke-width: 1; rx: 4; }
  .edge { stroke: var(--hairline); stroke-width: 1.2; fill: none; }
  .accent { stroke: var(--brand); }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
</head>
<body>
  <svg viewBox="0 0 700 150" role="img" aria-label="渲染管线">
    <rect class="box" x="8"   y="45" width="120" height="48"></rect>
    <text class="label latin" x="68"  y="68" text-anchor="middle">Markdown</text>
    <text class="sub latin"   x="68"  y="84" text-anchor="middle">.md</text>

    <rect class="box" x="170" y="45" width="120" height="48"></rect>
    <text class="label latin" x="230" y="68" text-anchor="middle">MDAST</text>
    <text class="sub"   x="230" y="84" text-anchor="middle">解析一次</text>

    <rect class="box" x="332" y="45" width="120" height="48"></rect>
    <text class="label" x="392" y="68" text-anchor="middle">块</text>
    <text class="sub"   x="392" y="84" text-anchor="middle">可编辑单元</text>

    <rect class="box" x="494" y="45" width="120" height="48"></rect>
    <text class="label" x="554" y="68" text-anchor="middle">纸面</text>
    <text class="sub"   x="554" y="84" text-anchor="middle">渲染</text>

    <path class="edge" d="M128 69 H 170"></path>
    <path class="edge" d="M290 69 H 332"></path>
    <path class="edge" d="M452 69 H 494"></path>
    <path class="edge accent" d="M554 93 V 124 H 68 V 93"></path>
    <text class="sub" x="311" y="140" text-anchor="middle">写回，偏移保持不变</text>
  </svg>
<script>
  (function() {
    function report() {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({
        type: "vellum-widget:resize",
        height: h,
        title: document.title
      }, "*");
    }
    window.addEventListener("load", report);
    if (window.ResizeObserver) {
      new ResizeObserver(report).observe(document.body);
    }
  })();
</script>
</body>
</html>
```

## 阅读位置

长文档是一个地方，不是一条流。位置先记成标题锚点，其次记成顶层块序号，比例只在兜底
时才用[^ratio]——因为在图片从你脚底下加载出来的时候，说谎的正是比例。

[^ratio]: 退回 `scrollTop / scrollHeight` 只在一种情况下是对的：一份既没有标题、也没有
    块结构的文档的最顶端。
