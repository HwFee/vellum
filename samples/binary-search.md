# 二分查找

在**已排序**的数组里找一个值，不必从头数到尾：每次看中间那个，比目标大就丢掉右半，比目标小就丢掉左半。区间每轮砍掉一半，找到或区间变空为止。

> [!note] 唯一的前提
> 数据必须有序（或者更一般地：能用“是 / 否”把序列切成前后两段，见文末）。数组没排序，二分查找给出的答案没有意义。

## 一、直觉：每轮砍掉一半

16 个元素的数组，最坏情况下区间长度依次是 16、8、4、2、1。一共 5 轮就能确定答案；线性扫描最坏要看 16 个。

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>二分查找：候选区间逐轮减半</title>
<style>
  :root {
    --parchment: #f5f4ed; --ivory: #faf9f5; --warm-sand: #e8e6dc;
    --near-black: #141413; --dark-warm: #3d3d3a; --stone: #6b6a64;
    --brand: #1B365D; --hairline: #dddacc; --border: #e8e6dc;
    --pine: #2F5D50; --ochre: #8C5B2E;
    --font-serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;
    --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--ivory); color: var(--dark-warm);
    font-family: var(--font-serif); font-size: 15px; line-height: 1.6;
    padding: 12px; overflow-x: hidden; -webkit-font-smoothing: antialiased;
  }
  svg { display: block; width: 100%; height: auto; }
  svg text { font-family: var(--font-serif); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
  <svg viewBox="0 0 560 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="16 个元素的候选区间每轮减半：16、8、4、2、1">
    <rect x="90" y="20" width="400" height="22" fill="#e8e6dc"/>
    <rect x="90" y="20" width="400" height="22" fill="#1B365D"/>
    <text x="24" y="37" font-size="15" fill="#141413">第 0 轮</text>
    <text x="500" y="37" font-size="15" fill="#141413">16</text>

    <rect x="90" y="56" width="400" height="22" fill="#e8e6dc"/>
    <rect x="90" y="56" width="200" height="22" fill="#1B365D"/>
    <text x="24" y="73" font-size="15" fill="#141413">第 1 轮</text>
    <text x="500" y="73" font-size="15" fill="#6b6a64">8</text>

    <rect x="90" y="92" width="400" height="22" fill="#e8e6dc"/>
    <rect x="90" y="92" width="100" height="22" fill="#1B365D"/>
    <text x="24" y="109" font-size="15" fill="#141413">第 2 轮</text>
    <text x="500" y="109" font-size="15" fill="#6b6a64">4</text>

    <rect x="90" y="128" width="400" height="22" fill="#e8e6dc"/>
    <rect x="90" y="128" width="50" height="22" fill="#1B365D"/>
    <text x="24" y="145" font-size="15" fill="#141413">第 3 轮</text>
    <text x="500" y="145" font-size="15" fill="#6b6a64">2</text>

    <rect x="90" y="164" width="400" height="22" fill="#e8e6dc"/>
    <rect x="90" y="164" width="25" height="22" fill="#2F5D50"/>
    <text x="24" y="181" font-size="15" fill="#141413">第 4 轮</text>
    <text x="500" y="181" font-size="15" fill="#2F5D50">1</text>

    <text x="280" y="220" text-anchor="middle" font-size="12.5" fill="#6b6a64">靛青：仍待查的候选区间　浅沙：已排除的部分</text>
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

增长的是对数：数据量翻一倍，只多比较一次。

| 元素个数 n | 线性扫描（最坏） | 二分查找（最坏） |
|---:|---:|---:|
| 1 000 | 1 000 次 | 10 次 |
| 1 000 000 | 1 000 000 次 | 20 次 |
| 1 000 000 000 | 1 000 000 000 次 | 30 次 |

最坏比较次数是 $\lceil \log_2(n+1) \rceil$；递推写出来就是 $T(n) = T(n/2) + O(1)$，即 $O(\log n)$。一亿个元素最多 27 次。

## 二、亲手走一遍

下面这个演示用同一个 16 元素数组。拖动滑块选目标值（可以选数组里没有的数），再用“下一步”逐轮观察。字母 **L**、**M**、**H** 分别标出 `lo`、`mid`、`hi`；变淡的格子是已经被排除的。

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>二分查找逐步演示</title>
<style>
  :root {
    --parchment: #f5f4ed; --ivory: #faf9f5; --warm-sand: #e8e6dc;
    --near-black: #141413; --dark-warm: #3d3d3a; --stone: #6b6a64;
    --brand: #1B365D; --hairline: #dddacc; --border: #e8e6dc;
    --pine: #2F5D50; --ochre: #8C5B2E;
    --font-serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;
    --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--ivory); color: var(--dark-warm);
    font-family: var(--font-serif); font-size: 15px; line-height: 1.6;
    padding: 14px; overflow-x: hidden; -webkit-font-smoothing: antialiased;
  }
  .card { display: flex; flex-direction: column; gap: 12px; }

  .controls {
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px;
    background: var(--parchment); border: 1px solid var(--border);
    border-radius: 3px; padding: 10px 12px;
  }
  .target { display: flex; align-items: center; gap: 10px; flex: 1 1 240px; }
  .target label { color: var(--stone); white-space: nowrap; }
  .target .val { font-family: var(--font-mono); color: var(--near-black); font-weight: 500; min-width: 2.2em; text-align: right; }
  input[type="range"] {
    -webkit-appearance: none; appearance: none; flex: 1; min-width: 80px;
    height: 4px; background: var(--hairline); border-radius: 2px; outline: none; margin: 4px 0;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 12px; height: 12px;
    border-radius: 2px; background: var(--brand); cursor: pointer; border: 1px solid var(--ivory);
  }
  .btns { display: flex; gap: 8px; }
  .btn {
    background: var(--ivory); color: var(--dark-warm); border: 1px solid var(--hairline);
    border-radius: 2px; font-family: var(--font-serif); font-size: 15px; padding: 3px 12px;
    cursor: pointer; font-weight: 500; transition: background .15s ease, border-color .15s ease;
  }
  .btn:hover:not(:disabled) { background: var(--parchment); border-color: var(--stone); }
  .btn.primary { background: var(--brand); color: var(--ivory); border-color: var(--brand); }
  .btn.primary:disabled { background: var(--ivory); color: var(--stone); border-color: var(--hairline); }
  .btn:disabled { cursor: default; opacity: .55; }

  .cells { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 3px; }
  .col { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
  .idx { font-family: var(--font-mono); font-size: 12.5px; color: var(--stone); line-height: 1.2; }
  .cell {
    width: 100%; text-align: center; padding: 5px 0;
    font-family: var(--font-mono); font-size: 15px; color: var(--near-black);
    background: var(--parchment); border: 1px solid var(--brand); border-radius: 2px;
    transition: background .15s ease, opacity .15s ease;
  }
  .cell.out { background: var(--ivory); border-color: var(--hairline); color: var(--stone); opacity: .45; }
  .cell.mid { background: var(--brand); color: var(--ivory); }
  .cell.hit { background: var(--pine); border-color: var(--pine); color: var(--ivory); }
  .mk { height: 18px; font-family: var(--font-mono); font-size: 12.5px; font-weight: 500; line-height: 18px; white-space: nowrap; }
  .mk .l { color: var(--brand); }
  .mk .m { color: var(--near-black); }
  .mk .h { color: var(--ochre); }

  .say {
    min-height: 4.9em; background: var(--parchment); border-left: 2px solid var(--brand);
    border-radius: 0 2px 2px 0; padding: 6px 12px; color: var(--near-black);
  }
  .say .meta { display: block; font-family: var(--font-mono); font-size: 12.5px; color: var(--stone); margin-bottom: 2px; }
  .say.ok { border-left-color: var(--pine); }
  .say.miss { border-left-color: var(--ochre); }
  .say code { font-family: var(--font-mono); font-size: 14px; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="controls">
      <div class="target">
        <label for="t">目标值</label>
        <input type="range" id="t" min="0" max="80" step="1" value="50">
        <span class="val" id="tv">50</span>
      </div>
      <div class="btns">
        <button class="btn" id="prev">上一步</button>
        <button class="btn primary" id="next">下一步</button>
        <button class="btn" id="reset">重置</button>
      </div>
    </div>

    <div class="cells" id="cells"></div>

    <div class="say" id="say" aria-live="polite"></div>
  </div>

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

    const A = [3, 8, 12, 17, 21, 26, 30, 35, 41, 44, 50, 53, 58, 64, 71, 79];
    const N = A.length;
    const DEFAULT_TARGET = 50;

    const tInput = document.getElementById("t");
    const tVal = document.getElementById("tv");
    const cellsEl = document.getElementById("cells");
    const say = document.getElementById("say");
    const btnPrev = document.getElementById("prev");
    const btnNext = document.getElementById("next");
    const btnReset = document.getElementById("reset");

    // 一次建好 16 列：下标 / 数值格 / 标记行
    const cols = A.map(function (v, i) {
      const col = document.createElement("div");
      col.className = "col";
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = i;
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.textContent = v;
      const mk = document.createElement("div");
      mk.className = "mk";
      col.appendChild(idx);
      col.appendChild(cell);
      col.appendChild(mk);
      cellsEl.appendChild(col);
      return { cell: cell, mk: mk };
    });

    // 预先算出整条轨迹：每个状态是“做决定之前”的 lo / hi / mid
    function buildTrace(t) {
      const s = [{ lo: 0, hi: N - 1, mid: -1, kind: "init",
        msg: "在有序数组里找 <code>" + t + "</code>。候选区间 <code>[0, " + (N - 1) + "]</code>，共 " + N + " 个。每一步取中点比较。" }];
      let lo = 0, hi = N - 1, cmp = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = A[mid];
        cmp++;
        const head = "<code>mid = (" + lo + " + " + hi + ") / 2 = " + mid + "</code>，<code>a[" + mid + "] = " + v + "</code>";
        if (v === t) {
          s.push({ lo: lo, hi: hi, mid: mid, kind: "hit", cmp: cmp,
            msg: head + " 等于目标 " + t + "。找到了，下标是 " + mid + "，共比较 " + cmp + " 次。" });
          return s;
        } else if (v < t) {
          s.push({ lo: lo, hi: hi, mid: mid, kind: "go", cmp: cmp,
            msg: head + " 小于 " + t + "：目标只可能在右半，<code>lo = mid + 1 = " + (mid + 1) + "</code>。" });
          lo = mid + 1;
        } else {
          s.push({ lo: lo, hi: hi, mid: mid, kind: "go", cmp: cmp,
            msg: head + " 大于 " + t + "：目标只可能在左半，<code>hi = mid - 1 = " + (mid - 1) + "</code>。" });
          hi = mid - 1;
        }
      }
      s.push({ lo: lo, hi: hi, mid: -1, kind: "miss", cmp: cmp,
        msg: "<code>lo = " + lo + " &gt; hi = " + hi + "</code>，候选区间为空。" + t + " 不在数组里，共比较 " + cmp + " 次。" });
      return s;
    }

    let target = DEFAULT_TARGET;
    let trace = buildTrace(target);
    let step = 0;

    function render() {
      const st = trace[step];
      cols.forEach(function (c, i) {
        let cls = "cell";
        if (i < st.lo || i > st.hi) cls += " out";
        if (i === st.mid) cls += st.kind === "hit" ? " hit" : " mid";
        c.cell.className = cls;
        let mk = "";
        if (i === st.lo) mk += '<span class="l">L</span>';
        if (i === st.mid) mk += '<span class="m">M</span>';
        if (i === st.hi) mk += '<span class="h">H</span>';
        c.mk.innerHTML = mk;
      });
      const left = Math.max(0, st.hi - st.lo + 1);
      const meta = "步骤 " + step + " / " + (trace.length - 1) +
        "　候选 " + left + " 个　已比较 " + (st.cmp || 0) + " 次";
      say.className = "say" + (st.kind === "hit" ? " ok" : st.kind === "miss" ? " miss" : "");
      say.innerHTML = '<span class="meta">' + meta + "</span>" + st.msg;
      btnPrev.disabled = step === 0;
      btnNext.disabled = step === trace.length - 1;
    }

    function setTarget(v) {
      target = v;
      tVal.textContent = v;
      trace = buildTrace(v);
      step = 0;
      render();
    }

    tInput.addEventListener("input", function () { setTarget(Number(tInput.value)); });
    btnPrev.addEventListener("click", function () { step = Math.max(0, step - 1); render(); });
    btnNext.addEventListener("click", function () { step = Math.min(trace.length - 1, step + 1); render(); });
    btnReset.addEventListener("click", function () { tInput.value = DEFAULT_TARGET; setTarget(DEFAULT_TARGET); });

    render();
  </script>
</body>
</html>
```

试几组值：

- 选 `3` 或 `79`（两端）：几步就到头，仍不超过 5 次。
- 选 `30`：第一步 `mid=7` 偏大，后面一路往左。
- 选 `51`（不在数组里，夹在 50 与 53 之间）：区间被压到空，`lo` 越过 `hi`，这就是“没找到”的信号。

## 三、写成代码

```python
def binary_search(a, target):
    lo, hi = 0, len(a) - 1          # 闭区间 [lo, hi]
    while lo <= hi:                  # 区间非空就继续
        mid = lo + (hi - lo) // 2
        if a[mid] == target:
            return mid
        if a[mid] < target:
            lo = mid + 1             # 丢掉左半，连 mid 一起
        else:
            hi = mid - 1             # 丢掉右半，连 mid 一起
    return -1                        # 区间空了：不存在
```

整个算法靠一条**循环不变量**撑住：

> 如果 `target` 在数组里，它的下标一定在 `[lo, hi]` 内。

初始时 `[0, n-1]` 覆盖全部，成立；每次更新只丢掉“确定不是答案”的部分，保持成立；退出时区间为空，不变量就推出“不在数组里”。

> [!warning] 三个高发错误
> 1. **`lo = mid` 或 `hi = mid`（闭区间下）**：区间可能不再缩小，死循环。比如 `lo=2, hi=3` 时 `mid=2`，`lo = mid` 原地不动。
> 2. **`lo <= hi` 与 `lo < hi` 混用**：条件取决于区间是闭还是半开，不是随手选的，见下一节。
> 3. **`mid = (lo + hi) / 2`**：在 32 位整型语言里 `lo + hi` 可能溢出。写成 `lo + (hi - lo) / 2`。Python 的整数不会溢出，但这个写法值得养成习惯。

## 四、更常用的形态：lower_bound

真实场景里，更多是问“**第一个不小于 target 的位置**”，而不是“有没有等于 target 的那一个”：重复元素里找最左边的、找插入位置、数一个范围内有几个，都归这一类。

换成**半开区间** `[lo, hi)`，规则会统一得多：

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>lower_bound 的区间不变量</title>
<style>
  :root {
    --parchment: #f5f4ed; --ivory: #faf9f5; --warm-sand: #e8e6dc;
    --near-black: #141413; --dark-warm: #3d3d3a; --stone: #6b6a64;
    --brand: #1B365D; --hairline: #dddacc; --border: #e8e6dc;
    --pine: #2F5D50; --ochre: #8C5B2E;
    --font-serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;
    --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--ivory); color: var(--dark-warm);
    font-family: var(--font-serif); font-size: 15px; line-height: 1.6;
    padding: 12px; overflow-x: hidden; -webkit-font-smoothing: antialiased;
  }
  svg { display: block; width: 100%; height: auto; }
  svg text { font-family: var(--font-serif); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
  <svg viewBox="0 0 560 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="半开区间 [lo, hi) 把数组分成三段：左边全部小于目标，中间待查，右边全部不小于目标">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 1 L10 5 L0 9 z" fill="#1B365D"/>
      </marker>
    </defs>

    <text x="196" y="22" text-anchor="middle" font-size="15" fill="#1B365D">lo = 2</text>
    <line x1="196" y1="30" x2="196" y2="52" stroke="#1B365D" stroke-width="1.5" marker-end="url(#arrow)"/>
    <text x="420" y="22" text-anchor="middle" font-size="15" fill="#8C5B2E">hi = 6</text>
    <line x1="420" y1="30" x2="420" y2="52" stroke="#8C5B2E" stroke-width="1.5" marker-end="url(#arrow)"/>

    <rect x="56"  y="56" width="56" height="44" fill="#e8e6dc" stroke="#dddacc" stroke-width="1"/>
    <rect x="112" y="56" width="56" height="44" fill="#e8e6dc" stroke="#dddacc" stroke-width="1"/>
    <rect x="168" y="56" width="56" height="44" fill="#f5f4ed" stroke="#1B365D" stroke-width="1"/>
    <rect x="224" y="56" width="56" height="44" fill="#f5f4ed" stroke="#1B365D" stroke-width="1"/>
    <rect x="280" y="56" width="56" height="44" fill="#f5f4ed" stroke="#1B365D" stroke-width="1"/>
    <rect x="336" y="56" width="56" height="44" fill="#f5f4ed" stroke="#1B365D" stroke-width="1"/>
    <rect x="392" y="56" width="56" height="44" fill="#e8e6dc" stroke="#dddacc" stroke-width="1"/>
    <rect x="448" y="56" width="56" height="44" fill="#e8e6dc" stroke="#dddacc" stroke-width="1"/>

    <text x="84"  y="84" text-anchor="middle" font-size="15" fill="#6b6a64">2</text>
    <text x="140" y="84" text-anchor="middle" font-size="15" fill="#6b6a64">5</text>
    <text x="196" y="84" text-anchor="middle" font-size="15" fill="#141413">8</text>
    <text x="252" y="84" text-anchor="middle" font-size="15" fill="#141413">12</text>
    <text x="308" y="84" text-anchor="middle" font-size="15" fill="#141413">16</text>
    <text x="364" y="84" text-anchor="middle" font-size="15" fill="#141413">23</text>
    <text x="420" y="84" text-anchor="middle" font-size="15" fill="#6b6a64">38</text>
    <text x="476" y="84" text-anchor="middle" font-size="15" fill="#6b6a64">56</text>

    <line x1="56"  y1="112" x2="168" y2="112" stroke="#6b6a64" stroke-width="1"/>
    <line x1="168" y1="112" x2="392" y2="112" stroke="#1B365D" stroke-width="1.5"/>
    <line x1="392" y1="112" x2="504" y2="112" stroke="#6b6a64" stroke-width="1"/>

    <text x="112" y="138" text-anchor="middle" font-size="15" fill="#3d3d3a">全部 &lt; target</text>
    <text x="280" y="138" text-anchor="middle" font-size="15" fill="#1B365D">待查区间 [lo, hi)</text>
    <text x="448" y="138" text-anchor="middle" font-size="15" fill="#3d3d3a">全部 ≥ target</text>

    <text x="280" y="172" text-anchor="middle" font-size="12.5" fill="#6b6a64">hi 指向“已确认 ≥ target”的第一格，所以 hi 本身不在待查区间内</text>
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

左边“全部小于”，右边“全部不小于”，中间还没看。每轮都在把中间那段往两边挤，直到它变空（`lo == hi`），答案就是 `lo`。

```python
def lower_bound(a, target):
    lo, hi = 0, len(a)               # 半开区间 [lo, hi)，hi 取 len(a)
    while lo < hi:                   # 区间非空
        mid = lo + (hi - lo) // 2
        if a[mid] < target:
            lo = mid + 1             # mid 及其左边都 < target
        else:
            hi = mid                 # mid 及其右边都 >= target（mid 保留）
    return lo                        # 第一个 >= target 的位置，可能等于 len(a)
```

和闭区间版相比，只有三处对应着变：`hi` 初值是 `len(a)` 而不是 `len(a) - 1`，循环条件是 `<` 而不是 `<=`，`hi = mid` 而不是 `mid - 1`。三处一起变，是同一个区间约定的三种表现；混着写才会出错。

用它能直接回答几类问题：

| 问题 | 写法 |
|---|---|
| target 存不存在 | `i = lower_bound(a, x)`，然后 `i < len(a) and a[i] == x` |
| 有重复时最左出现的位置 | `lower_bound(a, x)`（存在时） |
| 应该插在哪里才保持有序 | `lower_bound(a, x)` |
| 整数 x 在数组里出现几次 | `lower_bound(a, x + 1) - lower_bound(a, x)` |

## 五、不止于数组

二分的本质不是“数组里查值”，而是在一个**单调的是 / 否判定**上找分界点：只要存在某个阈值，使得一边全是“否”、另一边全是“是”，就能二分。

- 每天最多搬 $x$ 箱，能否在 $D$ 天内搬完？$x$ 越大越容易，对 $x$ 二分，可求最小可行的 $x$。
- 开方、求方程的根：判定是“这个数的平方是否已超过 $n$”。
- 版本回归：第几个提交开始出 bug？`git bisect` 做的就是这件事。

## 练习

- [ ] 把演示里的数组换成有重复元素，手推 `lower_bound` 的返回值。
- [ ] 写出 `upper_bound`（第一个 `> target` 的位置），只改一个比较符号。
- [ ] 为什么闭区间版里 `lo = mid` 会死循环？找一组最小的反例。
- [ ] 用二分求整数平方根 $\lfloor \sqrt{n} \rfloor$，先写出判定函数，再套模板。
