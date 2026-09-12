import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.42, 0, 0.58, 1);

const clampOpts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * 一张真实窗口截图，当作"浮在纸上的窗口"呈现：10px 圆角 + 发丝描边 +
 * 克制的投影（DESIGN.md 的 Elevation 规则：不许厚重阴影，这里只用 6% 黑）。
 *
 * Ken Burns 由 frame 范围驱动，不使用 CSS transition —— Remotion 逐帧截图，
 * CSS 动画不会被采样。
 */
export const WindowShot: React.FC<{
  src: string;
  width: number;
  /** 入场：起始缩放 */
  from?: number;
  /** 整场推镜的目标缩放 */
  to?: number;
  zoomSpan?: [number, number];
  driftY?: number;
  driftX?: number;
  enterAt?: number;
  radius?: number;
  shadow?: boolean;
  origin?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({
  src,
  width,
  from = 1,
  to = 1.05,
  zoomSpan,
  driftY = -26,
  driftX = 0,
  enterAt = 0,
  radius = 10,
  shadow = true,
  origin = "50% 45%",
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const [z0, z1] = zoomSpan ?? [enterAt, enterAt + 260];

  const enter = interpolate(frame, [enterAt, enterAt + 28], [0, 1], {
    ...clampOpts,
    easing: easeOut,
  });
  const zoom = interpolate(frame, [z0, z1], [from, to], {
    ...clampOpts,
    easing: easeInOut,
  });
  // 入场先从小放大到 1，再接力推镜；两者相乘而不是相加，避免曲线打架
  const enterScale = interpolate(enter, [0, 1], [0.94, 1]);
  const y = interpolate(frame, [z0, z1], [0, driftY], {
    ...clampOpts,
    easing: easeInOut,
  });
  const x = interpolate(frame, [z0, z1], [0, driftX], {
    ...clampOpts,
    easing: easeInOut,
  });

  return (
    <div
      style={{
        position: "absolute",
        width,
        opacity: enter,
        transform: `translate(${x}px, ${y + (1 - enter) * 26}px) scale(${zoom * enterScale})`,
        transformOrigin: origin,
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          borderRadius: radius,
          border: `1px solid ${COLORS.hairline}`,
          boxShadow: shadow
            ? "0 18px 48px rgba(61,61,58,0.10), 0 2px 6px rgba(61,61,58,0.05)"
            : undefined,
        }}
      />
      {children}
    </div>
  );
};

/**
 * 聚光：在截图上压一层「只留一处亮」的径向遮罩。
 *
 * 用柔光而不是硬高亮框——硬框要求像素级对准截图里的控件，一旦偏差就露馅；
 * 柔光的中心即使偏几十像素也读作「视线引导」。
 */
export const Spotlight: React.FC<{
  cx: number;
  cy: number;
  radius: number;
  dim?: number;
  at?: number;
}> = ({ cx, cy, radius, dim = 0.4, at = 0 }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 24], [0, 1], { ...clampOpts, easing: easeOut });
  if (t <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `radial-gradient(circle ${radius}px at ${cx}px ${cy}px, rgba(20,20,19,0) 42%, rgba(20,20,19,${dim * t}) 100%)`,
      }}
    />
  );
};

/**
 * 长图 plate + 视口推进。
 *
 * 为什么不在抓取阶段逐帧录屏：截图的耗时不可控，帧间隔会抖。抓一张全高长图，
 * 在 Remotion 里按帧号推进视口，滚动速度、缓动、是否停顿全部精确到帧。
 *
 * 单位说明：nativeWidth / nativeHeight 是 plate 的像素尺寸，frameWidth 是它在
 * 视频里要占的 CSS 宽度，startY / endY 是视口在 plate 上的起止 y（plate 像素）。
 */
export const PlateScroll: React.FC<{
  src: string;
  nativeWidth: number;
  nativeHeight: number;
  frameWidth: number;
  viewportHeight: number;
  startY: number;
  endY: number;
  at?: number;
  duration: number;
  radius?: number;
  style?: React.CSSProperties;
}> = ({
  src,
  nativeWidth,
  nativeHeight,
  frameWidth,
  viewportHeight,
  startY,
  endY,
  at = 0,
  duration,
  radius = 10,
  style,
}) => {
  const frame = useCurrentFrame();
  const scale = frameWidth / nativeWidth;
  const renderedHeight = nativeHeight * scale;
  // 两端各留一段停顿，中段才推进——一上来就匀速滚动会显得很"PPT"
  const hold = Math.min(18, Math.floor(duration * 0.14));
  const y = interpolate(frame - at, [hold, duration - hold], [startY * scale, endY * scale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });
  const maxY = Math.max(0, renderedHeight - viewportHeight);

  return (
    <div
      style={{
        position: "absolute",
        width: frameWidth,
        height: viewportHeight,
        overflow: "hidden",
        borderRadius: radius,
        border: `1px solid ${COLORS.hairline}`,
        backgroundColor: COLORS.parchment,
        boxShadow: "0 18px 48px rgba(61,61,58,0.10), 0 2px 6px rgba(61,61,58,0.05)",
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: frameWidth,
          height: renderedHeight,
          transform: `translateY(${-Math.min(y, maxY)}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(to bottom, rgba(245,244,237,0.85) 0%, rgba(245,244,237,0) 7%, rgba(245,244,237,0) 93%, rgba(245,244,237,0.85) 100%)",
        }}
      />
    </div>
  );
};

/** 画在截图之上的靛青高亮框：把观众视线钉到某个区域（侧栏 / 搜索框 / 编辑块）。 */
export const Highlight: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  at?: number;
  radius?: number;
  label?: string;
}> = ({ x, y, width, height, at = 0, radius = 6, label }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 20], [0, 1], { ...clampOpts, easing: easeOut });
  if (t <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        borderRadius: radius,
        border: `2px solid ${COLORS.primary}`,
        boxShadow: `0 0 0 4px rgba(27,54,93,${0.08 * t})`,
        opacity: t,
        pointerEvents: "none",
      }}
    >
      {label ? (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: -2,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 17,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: COLORS.primary,
            opacity: 0.85,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};
