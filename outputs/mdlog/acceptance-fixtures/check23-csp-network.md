<!-- mdlog:v1 s=acceptance-csp -->

> **你** · 21:40
>
> 试一下联网。

<!-- mdlog:m=b2c3d4e5 -->

<p class="mdlog-who"><strong>Pi</strong> · 21:40</p>

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>CSP 隔离核验</title>
<style>body{margin:0;padding:14px;background:#f5f4ed;color:#3d3d3a;font-family:"HarmonyOS Sans","PingFang SC","苹方-简","TsangerJinKai02","Source Han Serif SC",serif;font-size:15px;line-height:1.6;}div{background:#faf9f5;border:1px solid #dddacc;border-radius:4px;padding:14px 16px;}</style>
</head>
<body>
  <div>正在尝试 fetch / XHR / 远程图片（预期全部被 CSP 拦截，按 F12 看 Console 红字）…</div>
  <img src="https://example.com/test.png" alt="远程图片应加载失败" width="120" height="40">
  <script>
    fetch("https://example.com").then(() => console.error("LEAK: fetch succeeded")).catch(e => console.log("fetch blocked:", String(e).slice(0, 80)));
    try { const x = new XMLHttpRequest(); x.open("GET", "https://example.com"); x.send(); } catch (e) { console.log("xhr blocked:", String(e).slice(0, 80)); }
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
