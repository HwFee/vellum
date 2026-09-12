import { Config } from "@remotion/cli/config";

// 逐帧截图的格式：jpeg 更快，但本片有大量细文字与发丝线，png 的锐度值得这点时间。
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
// 本片没有 CSS 过渡/动画（全部由 useCurrentFrame 驱动），单线程确定性渲染即可；
// 帧数拆多一点能把 12 核吃满。
Config.setConcurrency(null);
