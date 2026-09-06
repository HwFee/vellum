<!-- mdlog:v1 s=acceptance-demo -->

> **你** · 21:30
>
> 演示一下傅里叶方波。

<!-- mdlog:m=a1b2c3d4 -->

<p class="mdlog-who"><strong>Pi</strong> · 21:31</p>

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>验收·傅里叶方波</title>
  <style>
    :root { --parchment:#f5f4ed; --ivory:#faf9f5; --near-black:#141413; --dark-warm:#3d3d3a; --stone:#6b6a64; --brand:#1B365D; --hairline:#dddacc; }
    body { margin:0; padding:14px; background:var(--parchment); color:var(--dark-warm); font-family:"TsangerJinKai02","Source Han Serif SC","Songti SC",serif; font-size:15px; line-height:1.6; }
    .box { background:var(--ivory); border:1px solid var(--hairline); border-radius:4px; padding:16px; }
    .head { font-size:16px; font-weight:500; color:var(--near-black); border-bottom:1px solid var(--hairline); padding-bottom:8px; margin-bottom:10px; }
    canvas { display:block; width:100%; height:120px; }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
  </style>
</head>
<body>
  <div class="box">
    <div class="head">方波谐波合成 · N=5 中文渲染核验</div>
    <canvas id="c"></canvas>
  </div>
  <script>
    (function() {
      function report() {
        const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
      }
      window.addEventListener("load", report);
      if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
      const c = document.getElementById('c'), ctx = c.getContext('2d');
      function draw() {
        const r = c.getBoundingClientRect(); c.width = r.width; c.height = r.height;
        ctx.strokeStyle = '#1B365D'; ctx.lineWidth = 1.8; ctx.beginPath();
        for (let x = 0; x < c.width; x++) {
          const t = (x / (c.width / 2)) * 2 * Math.PI; let s = 0;
          for (let k = 1; k <= 5; k++) s += Math.sin((2*k-1)*t) / (2*k-1);
          const y = c.height/2 - s*(4/Math.PI)*c.height*0.35;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      window.addEventListener('resize', draw);
      draw();
    })();
  </script>
</body>
</html>
```

以上是 N=5 的方波合成，靛青主线即叠加结果。
