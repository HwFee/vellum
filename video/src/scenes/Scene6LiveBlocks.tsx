import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption } from "../components/Caption";
import { WindowShot } from "../components/Frames";
import { PaperBackground } from "../components/PaperBackground";
import { COPY } from "../theme";

const WIDTH = 1440;
const LEFT = (1920 - WIDTH) / 2;
const TOP = 34;

const FADE = 14;
const LAYERS = [
  { src: "capture/06-window-widget-live.png", start: -40, end: 58, zoom: [1.0, 1.06] },
  { src: "capture/13-log-top.png", start: 46, end: 200, zoom: [1.0, 1.05] },
];

/** 现场会话：同文档里渲染出的沙箱交互块 → 一份真实的 mdlog 会话日志。 */
export const Scene6LiveBlocks: React.FC = () => {
  const frame = useCurrentFrame();

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
              src={layer.src}
              width={WIDTH}
              enterAt={-200}
              from={layer.zoom[0]}
              to={layer.zoom[1]}
              zoomSpan={[layer.start, layer.start + 140]}
              driftY={-12}
              style={{ left: LEFT, top: TOP }}
            />
          </AbsoluteFill>
        );
      })}
      <Caption text={COPY.captions.liveBlocks} from={24} to={110} />
    </PaperBackground>
  );
};
