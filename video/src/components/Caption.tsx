import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, MONO_STACK, SERIF_STACK } from "../theme";

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.42, 0, 0.58, 1);

/**
 * 屏上字幕：左侧一道靛青竖轨（与应用大纲的激活指示条同一语汇）+ 衬线正文。
 * in/out 帧段可调，默认在场景首尾各留一段淡入淡出。
 */
export const Caption: React.FC<{
  text: string;
  from?: number;
  to?: number;
  align?: "left" | "center";
  mono?: string;
  style?: React.CSSProperties;
}> = ({ text, from = 0, to = Number.POSITIVE_INFINITY, align = "left", mono, style }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [from, from + 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const exit = interpolate(frame, [to - 16, to], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });
  const t = Math.min(enter, exit);
  if (t <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 130,
        right: 130,
        bottom: 78,
        display: "flex",
        alignItems: "center",
        gap: 26,
        justifyContent: align === "center" ? "center" : "flex-start",
        opacity: t,
        transform: `translateY(${(1 - t) * 22}px)`,
        ...style,
      }}
    >
      <div
        style={{
          width: 4,
          height: 46 * t,
          borderRadius: 2,
          backgroundColor: COLORS.primary,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          fontFamily: SERIF_STACK,
          fontWeight: 500,
          fontSize: 44,
          lineHeight: 1.25,
          color: COLORS.nearBlack,
          letterSpacing: 0.4,
          textShadow: "0 1px 0 rgba(250,249,245,0.9)",
        }}
      >
        {text}
      </div>
      {mono ? (
        <div
          style={{
            fontFamily: MONO_STACK,
            fontSize: 20,
            letterSpacing: 2.4,
            textTransform: "uppercase",
            color: COLORS.stone,
            border: `1px solid ${COLORS.hairline}`,
            borderRadius: 4,
            padding: "5px 11px",
            flexShrink: 0,
          }}
        >
          {mono}
        </div>
      ) : null}
    </div>
  );
};

/** 应用级的「朱文印章」提示：1.8px 靛青描边 + 宽字距，按下-定住-消散。 */
export const SealStamp: React.FC<{
  text: string;
  at: number;
  style?: React.CSSProperties;
}> = ({ text, at, style }) => {
  const frame = useCurrentFrame();
  const local = frame - at;
  if (local < 0) return null;
  const press = interpolate(local, [0, 10], [0.72, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const alpha = interpolate(local, [0, 8, 46, 70], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (alpha <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        fontFamily: SERIF_STACK,
        fontSize: 26,
        letterSpacing: 10,
        color: COLORS.primary,
        border: `1.8px solid ${COLORS.primary}`,
        borderRadius: 4,
        padding: "8px 20px 8px 30px",
        opacity: alpha,
        transform: `scale(${press})`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
