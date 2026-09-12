import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { PaperBackground } from "./components/PaperBackground";
import { COLORS, COPY, MONO_STACK, SERIF_STACK } from "./theme";

/**
 * 社交分享卡（Open Graph / GitHub Social Preview）：1280 × 640。
 *
 * 不是把 16:9 的正片帧裁一刀——标题会被裁掉。这里的版式是给 2:1 重新排的：
 * 左侧品牌与一句话主张，右侧一张真实窗口截图。整张卡仍走同一套纸墨 token，
 * 与正片、与应用同源。
 *
 * 尺寸取自 GitHub 的建议值（1280×640，容器最宽 1200 时也好看）。
 */
export const SocialCard: React.FC = () => {
  return (
    <PaperBackground intensity={0.85}>
      <AbsoluteFill style={{ padding: "0 0 0 92px", justifyContent: "center" }}>
        {/* ------------------------------------------------------- 左：品牌 */}
        <div style={{ width: 470 }}>
          <svg width={300} height={40} viewBox="0 0 980 120" style={{ marginBottom: 26, overflow: "visible" }}>
            <path
              d="M 18 66 C 190 40, 400 84, 620 52 C 760 32, 880 58, 962 46"
              fill="none"
              stroke={COLORS.primary}
              strokeWidth={9}
              strokeLinecap="round"
              opacity={0.92}
            />
            <path
              d="M 60 84 C 250 62, 470 96, 700 70"
              fill="none"
              stroke={COLORS.primary}
              strokeWidth={3.2}
              strokeLinecap="round"
              opacity={0.4}
            />
          </svg>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 18,
              fontFamily: SERIF_STACK,
            }}
          >
            <span style={{ fontSize: 82, fontWeight: 500, lineHeight: 1, color: COLORS.nearBlack }}>
              {COPY.title}
            </span>
            <span style={{ fontSize: 30, color: COLORS.primary, letterSpacing: 8 }}>
              {COPY.titleZh}
            </span>
          </div>

          <div
            style={{
              marginTop: 24,
              fontFamily: SERIF_STACK,
              fontSize: 25,
              lineHeight: 1.5,
              color: COLORS.darkWarm,
            }}
          >
            给 Markdown 一张纸。
          </div>

          <div
            style={{
              marginTop: 22,
              fontFamily: MONO_STACK,
              fontSize: 13.5,
              letterSpacing: 2.2,
              textTransform: "uppercase" as const,
              color: COLORS.stone,
            }}
          >
            Windows 10 / 11 · offline · MIT
          </div>
        </div>
      </AbsoluteFill>

      {/* ------------------------------------------------------- 右：窗口 */}
      <div
        style={{
          position: "absolute",
          left: 596,
          top: 96,
          width: 640,
          borderRadius: 10,
          overflow: "hidden",
          border: `1px solid ${COLORS.hairline}`,
          boxShadow: "0 18px 48px rgba(61,61,58,0.12), 0 2px 6px rgba(61,61,58,0.05)",
        }}
      >
        <Img
          src={staticFile("capture/01-window-reading.png")}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </div>
    </PaperBackground>
  );
};
