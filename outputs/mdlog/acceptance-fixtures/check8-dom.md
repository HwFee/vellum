<!-- mdlog:v1 s=acceptance-dom -->

> **你** · 21:50
>
> 试试从沙箱里摸主窗口。

<!-- mdlog:m=e5f6a7b8 -->

<p class="mdlog-who"><strong>Pi</strong> · 21:50</p>

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>DOM 防穿透核验</title>
<style>body{margin:0;padding:14px;background:#f5f4ed;color:#3d3d3a;font-family:"TsangerJinKai02","Source Han Serif SC","Songti SC",serif;font-size:15px;line-height:1.6;}div{background:#faf9f5;border:1px solid #dddacc;border-radius:4px;padding:14px 16px;}</style>
</head>
<body>
  <div>子帧正在尝试读取主窗口 document（预期被跨域拦截，结果见 Console）…</div>
  <script>
    try {
      var d = parent.document;
      console.error("LEAK: parent.document accessible, title=" + d.title);
    } catch (e) {
      console.log("parent.document blocked:", String(e).slice(0, 110));
    }
    try {
      var t = top.location.href;
      console.error("LEAK: top.location readable: " + t);
    } catch (e) {
      console.log("top.location blocked:", String(e).slice(0, 110));
    }
    (function() {
      function report() {
        var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
      }
      window.addEventListener("load", report);
    })();
  </script>
</body>
</html>
```
