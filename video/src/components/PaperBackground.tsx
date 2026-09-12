import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useBrandFontsGate } from "../fonts";
import { COLORS } from "../theme";

// 纸张底：暖纸纯色 + 纸纤维噪点（SVG feTurbulence）+ 极轻的暗角。
//
// 噪点用 data URI 内联而不是外部贴图，是为了让渲染进程不需要额外的网络/文件
// 请求——Remotion 对每帧截图，任何异步资源都会变成不确定性。
const GRAIN = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">
     <filter id="g">
       <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/>
       <feColorMatrix type="saturate" values="0"/>
     </filter>
     <rect width="260" height="260" filter="url(#g)" opacity="0.5"/>
   </svg>`
);

export const PaperBackground: React.FC<{
  intensity?: number;
  children?: React.ReactNode;
}> = ({ intensity = 1, children }) => {
  // 每个场景都以 PaperBackground 打底，字体闸门挂在这里就能覆盖全片
  useBrandFontsGate();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // 噪点极缓慢漂移，避免整片静止的"死像素感"
  const drift = interpolate(frame, [0, durationInFrames], [0, -34], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.parchment, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml;charset=utf-8,${GRAIN}")`,
          backgroundRepeat: "repeat",
          backgroundPosition: `${drift}px ${drift * 0.6}px`,
          opacity: 0.16 * intensity,
          mixBlendMode: "multiply",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 50% 42%, rgba(255,255,255,0) 42%, rgba(61,61,58,${0.09 * intensity}) 100%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
