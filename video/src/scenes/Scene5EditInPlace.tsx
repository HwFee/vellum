import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption } from "../components/Caption";
import { WindowShot } from "../components/Frames";
import { PaperBackground } from "../components/PaperBackground";
import { useCopy, useShot } from "../locale";

const WIDTH = 1440;
const LEFT = (1920 - WIDTH) / 2;
const TOP = 34;

const FADE = 16;
// 素材名写裸文件名：前缀由 locale.tsx 的 useShot() 按语言拼（中文版是 zh-*）。
const LAYERS = [
  { src: "09-window-editing.png", start: -40, end: 66, zoom: [1.0, 1.05] },
  { src: "10-window-editing-active.png", start: 54, end: 112, zoom: [1.0, 1.06] },
  { src: "11-window-editing-typed.png", start: 100, end: 220, zoom: [1.0, 1.07] },
];

/** 块级就地编辑：三段真实状态（只读块 / 激活块 / 修订中）交叉溶解。 */
export const Scene5EditInPlace: React.FC = () => {
  const frame = useCurrentFrame();
  const copy = useCopy();
  const shot = useShot();

  return (
    <PaperBackground>
      {LAYERS.map((layer) => {
        const opacity = Math.min(
          interpolate(frame, [layer.start, layer.start + FADE], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          interpolate(frame, [layer.end - FADE, layer.end], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        );
        if (opacity <= 0) return null;
        return (
          <AbsoluteFill key={layer.src} style={{ opacity }}>
            <WindowShot
              src={shot(layer.src)}
              width={WIDTH}
              enterAt={-200}
              from={layer.zoom[0]}
              to={layer.zoom[1]}
              zoomSpan={[layer.start, layer.start + 180]}
              driftY={-14}
              style={{ left: LEFT, top: TOP }}
            />
          </AbsoluteFill>
        );
      })}

      {/* 快捷键不做浮层徽标：窗口推镜后右边缘会涨到 x≈1730，徽标放右上必然压住标题栏。
          改用全片统一的「字幕 + 等宽小签」语汇，键位信息挂在字幕右侧。 */}
      <Caption text={copy.captions.editInPlace} from={28} to={158} mono="Ctrl E" />
    </PaperBackground>
  );
};
