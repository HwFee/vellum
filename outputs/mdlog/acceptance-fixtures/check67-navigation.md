<!-- mdlog:v1 s=acceptance-nav -->

> **你** · 21:44
>
> 跳个页面看看。

<!-- mdlog:m=d4e5f6a7 -->

<p class="mdlog-who"><strong>Pi</strong> · 21:44</p>

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>导航隔离核验</title>
<style>body{margin:0;padding:14px;background:#f5f4ed;color:#3d3d3a;font-family:"HarmonyOS Sans","PingFang SC","苹方-简","TsangerJinKai02","Source Han Serif SC",serif;font-size:15px;line-height:1.6;}div{background:#faf9f5;border:1px solid #dddacc;border-radius:4px;padding:14px 16px;}button{font:inherit;font-size:12.5px;padding:6px 14px;border:1px solid #dddacc;border-radius:2px;background:#faf9f5;color:#3d3d3a;cursor:pointer;margin-right:8px;}</style>
</head>
<body>
  <div>
    <button id="a">window.open（预期无效）</button>
    <button id="b">location.href 自导航（预期仅本子帧跳走）</button>
  </div>
  <script>
    document.getElementById('a').addEventListener('click', () => { const w = window.open("https://example.com"); console.log("window.open result:", w === null ? "blocked(null)" : "LEAK opened"); });
    document.getElementById('b').addEventListener('click', () => { location.href = "https://example.com"; });
    (function() {
      function report() {
        const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
      }
      window.addEventListener("load", report);
    })();
  </script>
</body>
</html>
```
