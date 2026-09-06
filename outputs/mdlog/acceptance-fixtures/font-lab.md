<!-- mdlog:v1 s=font-lab -->

> **你** · 22:30
>
> 换几种字体对比看看，哪个好看。

<!-- mdlog:m=ff000001 -->

<p class="mdlog-who"><strong>Pi</strong> · 22:30</p>

同一句话在七种本机字体下的渲染（沙箱只能读系统字体；当前默认落「华文宋体」）：

```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><title>字体对比台</title>
<style>
  body { margin:0; padding:16px; background:#faf9f5; color:#3d3d3a; }
  .row { padding:10px 2px 12px; border-bottom:1px solid #dddacc; }
  .row:last-child { border-bottom:none; }
  .name { font-family:Consolas,monospace; font-size:12px; color:#6b6a64; letter-spacing:.05em; margin-bottom:6px; display:flex; justify-content:space-between; }
  .name i { font-style:normal; color:#A63A2B; }
  .sample { font-size:17px; line-height:1.75; color:#141413; }
  .sample b { font-weight:500; color:#1B365D; }
  .f1 { font-family:"TsangerJinKai02","Source Han Serif SC","Songti SC",serif; }
  .f2 { font-family:"KaiTi","STKaiti",serif; }
  .f3 { font-family:"STKaiti","KaiTi",serif; }
  .f4 { font-family:"FangSong","STFangsong",serif; }
  .f5 { font-family:"STZhongsong","STSong",serif; }
  .f6 { font-family:"HYShangWeiShouShuW","hyswlongfangsong","FangSong",serif; }
  .f7 { font-family:"Microsoft YaHei","DengXian",sans-serif; }
</style>
</head>
<body>
  <div class="row"><div class="name"><span>1 · 今楷（本机已装系统字体）</span><i>当前默认</i></div><div class="sample f1">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <div class="row"><div class="name"><span>2 · 楷体 KaiTi</span><i>书本正文感</i></div><div class="sample f2">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <div class="row"><div class="name"><span>3 · 华文楷体 STKaiti</span><i>更饱满的楷</i></div><div class="sample f3">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <div class="row"><div class="name"><span>4 · 仿宋 FangSong</span><i>细劲印刷感</i></div><div class="sample f4">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <div class="row"><div class="name"><span>5 · 华文中宋 STZhongsong</span><i>更挺的宋</i></div><div class="sample f5">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <div class="row"><div class="name"><span>6 · 汉仪长仿宋</span><i>修长秀雅</i></div><div class="sample f6">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <div class="row"><div class="name"><span>7 · 微软雅黑（对照）</span><i>现代黑体</i></div><div class="sample f7">方波可由无穷条<b>正弦谐波</b>叠加合成——Fourier series, N=5, ωt ∈ [0, 2π)。</div></div>
  <script>
    (function() {
      function report() {
        var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
      }
      window.addEventListener("load", report);
      if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
    })();
  </script>
</body>
</html>
```
