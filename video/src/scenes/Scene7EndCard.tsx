import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { PaperBackground } from "../components/PaperBackground";
import { useCopy, useMetaFont } from "../locale";
import { COLORS, MONO_STACK, SERIF_STACK } from "../theme";

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 收尾：品牌与下载信息。末段整体淡出，避免最后一帧硬切。 */
export const Scene7EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const copy = useCopy();
  // 等宽栈没有汉字，中文版的元信息行退回衬线（见 locale.tsx 的 useMetaFont）
  const metaFont = useMetaFont();

  const markT = interpolate(frame, [0, 26], [0, 1], { ...clamp, easing: easeOut });
  const zhT = interpolate(frame, [10, 38], [0, 1], { ...clamp, easing: easeOut });
  const lineT = interpolate(frame, [24, 52], [0, 1], { ...clamp, easing: easeOut });
  const metaT = interpolate(frame, [34, 62], [0, 1], { ...clamp, easing: easeOut });
  const ctaT = interpolate(frame, [48, 74], [0, 1], { ...clamp, easing: easeOut });
  const outT = interpolate(frame, [96, 110], [1, 0], { ...clamp });

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
          opacity: outT,
        }}
      >
        <div
          style={{
            fontFamily: SERIF_STACK,
            fontWeight: 500,
            fontSize: 140,
            lineHeight: 1,
            letterSpacing: 2,
            color: COLORS.nearBlack,
            opacity: markT,
            transform: `translateY(${(1 - markT) * 24}px)`,
          }}
        >
          {copy.title}
          <span
            style={{
              fontSize: 46,
              color: COLORS.primary,
              marginLeft: 34,
              letterSpacing: 14,
              opacity: zhT,
            }}
          >
            {copy.titleZh}
          </span>
        </div>

        <div
          style={{
            width: lineT * 520,
            height: 1,
            backgroundColor: COLORS.hairline,
            margin: "46px 0 40px",
          }}
        />

        <div
          style={{
            fontFamily: SERIF_STACK,
            fontSize: 38,
            color: COLORS.darkWarm,
            opacity: metaT,
          }}
        >
          {copy.captions.endCard}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            marginTop: 44,
            fontFamily: metaFont,
            fontSize: 21,
            letterSpacing: 2.2,
            color: COLORS.stone,
            opacity: metaT * 0.95,
          }}
        >
          <span>{copy.end.license}</span>
          <span style={{ color: COLORS.hairline }}>|</span>
          <span>{copy.end.platform}</span>
        </div>

        <div
          style={{
            marginTop: 56,
            fontFamily: MONO_STACK,
            fontSize: 27,
            letterSpacing: 1.6,
            color: COLORS.primary,
            border: `1.5px solid ${COLORS.primary}`,
            borderRadius: 6,
            padding: "14px 30px",
            opacity: ctaT,
            transform: `translateY(${(1 - ctaT) * 12}px)`,
          }}
        >
          {copy.end.repo}
        </div>
      </div>
    </PaperBackground>
  );
};
