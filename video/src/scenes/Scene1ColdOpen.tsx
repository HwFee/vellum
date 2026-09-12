import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { PaperBackground } from "../components/PaperBackground";
import { useCopy, useLocale, useMetaFont } from "../locale";
import { COLORS, SERIF_STACK } from "../theme";

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.42, 0, 0.58, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// 〈素笺〉开场：一支墨笔把横划写出来，标题随后落到纸上。
//
// 落墨用 pathLength="1" 归一化路径长度，这样 strokeDasharray/offset 与 d 的实际
// 长度无关——换个曲线形状不用重算几何。
export const Scene1ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const copy = useCopy();
  const locale = useLocale();
  // 等宽栈没有汉字：中文版的底行退回衬线，宽字距改由 letterSpacing 承担
  const metaFont = useMetaFont();

  const draw = interpolate(frame, [8, 46], [0, 1], { ...clamp, easing: easeInOut });
  const drawThin = interpolate(frame, [16, 54], [0, 1], { ...clamp, easing: easeInOut });

  const titleT = interpolate(frame, [22, 50], [0, 1], { ...clamp, easing: easeOut });
  const zhT = interpolate(frame, [36, 62], [0, 1], { ...clamp, easing: easeOut });
  const tagT = interpolate(frame, [50, 74], [0, 1], { ...clamp, easing: easeOut });
  const subT = interpolate(frame, [66, 92], [0, 1], { ...clamp, easing: easeOut });
  const drift = interpolate(frame, [0, 120], [1, 1.022], { ...clamp, easing: easeInOut });

  return (
    <PaperBackground>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${drift})`,
        }}
      >
        <svg
          width={980}
          height={120}
          viewBox="0 0 980 120"
          style={{ marginBottom: -26, overflow: "visible" }}
        >
          <path
            d="M 18 66 C 190 40, 400 84, 620 52 C 760 32, 880 58, 962 46"
            fill="none"
            stroke={COLORS.primary}
            strokeWidth={9}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - draw}
            opacity={0.92}
          />
          <path
            d="M 60 84 C 250 62, 470 96, 700 70"
            fill="none"
            stroke={COLORS.primary}
            strokeWidth={3.2}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - drawThin}
            opacity={0.4}
          />
        </svg>

        <div
          style={{
            fontFamily: SERIF_STACK,
            fontWeight: 500,
            fontSize: 152,
            lineHeight: 1,
            letterSpacing: 2,
            color: COLORS.nearBlack,
            opacity: titleT,
            transform: `translateY(${(1 - titleT) * 26}px)`,
          }}
        >
          {copy.title}
        </div>

        <div
          style={{
            fontFamily: SERIF_STACK,
            fontSize: 44,
            color: COLORS.primary,
            marginTop: 22,
            opacity: zhT,
            letterSpacing: interpolate(zhT, [0, 1], [46, 20]),
            transform: `translateX(${(1 - zhT) * 10}px)`,
          }}
        >
          {copy.titleZh}
        </div>

        <div
          style={{
            fontFamily: SERIF_STACK,
            fontSize: 38,
            color: COLORS.darkWarm,
            marginTop: 54,
            opacity: tagT,
            transform: `translateY(${(1 - tagT) * 16}px)`,
          }}
        >
          {copy.tagline}
        </div>

        <div
          style={{
            fontFamily: metaFont,
            fontSize: locale === "zh" ? 19 : 21,
            letterSpacing: locale === "zh" ? 4.6 : 3.4,
            textTransform: "uppercase",
            color: COLORS.stone,
            marginTop: 34,
            opacity: subT * 0.9,
          }}
        >
          {copy.heroMeta}
        </div>
      </div>
    </PaperBackground>
  );
};
