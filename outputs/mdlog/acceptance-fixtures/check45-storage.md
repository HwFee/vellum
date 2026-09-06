<!-- mdlog:v1 s=acceptance-storage -->

> **你** · 21:42
>
> 试试存点东西。

<!-- mdlog:m=c3d4e5f6 -->

<p class="mdlog-who"><strong>Pi</strong> · 21:42</p>

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>存储隔离核验</title>
<style>body{margin:0;padding:14px;background:#f5f4ed;color:#3d3d3a;font-family:"TsangerJinKai02","Source Han Serif SC","Songti SC",serif;font-size:15px;line-height:1.6;}div{background:#faf9f5;border:1px solid #dddacc;border-radius:4px;padding:14px 16px;}</style>
</head>
<body>
  <div>正在尝试 localStorage / sessionStorage / cookie / indexedDB（预期全部抛 SecurityError）…</div>
  <script>
    function trial(name, fn) { try { fn(); console.error("LEAK: " + name + " succeeded"); } catch (e) { console.log(name + " blocked:", String(e).slice(0, 90)); } }
    trial("localStorage", () => localStorage.setItem("k", "v"));
    trial("sessionStorage", () => sessionStorage.getItem("k"));
    trial("cookie", () => { document.cookie = "k=v"; if (document.cookie) throw new Error("cookie readable"); });
    trial("indexedDB", () => { const r = indexedDB.open("t"); r.onsuccess = () => console.error("LEAK: indexedDB opened"); });
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
