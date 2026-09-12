import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "../components/Caption";
import { PlateScroll } from "../components/Frames";
import { PaperBackground } from "../components/PaperBackground";
import { COLORS, COPY, MONO_STACK } from "../theme";
import { PLATE_ARTICLE } from "../assetSizes";

const FRAME_WIDTH = 1500;
const VIEWPORT_HEIGHT = 800;
const LEFT = (1920 - FRAME_WIDTH) / 2;

/** 通篇推进：一张全高长图，视口自上而下走一遍。左侧墨线是阅读进度。 */
export const Scene3PaperScroll: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = FRAME_WIDTH / PLATE_ARTICLE.width;
  const renderedHeight = PLATE_ARTICLE.height * scale;
  const maxScroll = Math.max(0, renderedHeight - VIEWPORT_HEIGHT);

  const endY = 4300;
  const hold = 18;
  const offset = interpolate(
    frame,
    [hold, durationInFrames - hold],
    [0, Math.min(endY * scale, maxScroll)],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.42, 0, 0.58, 1),
    }
  );
  const progress = maxScroll > 0 ? offset / maxScroll : 0;

  return (
    <PaperBackground intensity={0.8}>
      <PlateScroll
        src="capture/02-article-plate.png"
        nativeWidth={PLATE_ARTICLE.width}
        nativeHeight={PLATE_ARTICLE.height}
        frameWidth={FRAME_WIDTH}
        viewportHeight={VIEWPORT_HEIGHT}
        startY={0}
        endY={endY}
        duration={durationInFrames}
        style={{ left: LEFT, top: 74 }}
      />
      {/* 左侧进度：一道墨线随视口推进生长 */}
      <div
        style={{
          position: "absolute",
          left: LEFT - 42,
          top: 74,
          width: 3,
          height: VIEWPORT_HEIGHT,
          backgroundColor: COLORS.hairline,
          borderRadius: 2,
        }}
      >
        <div
          style={{
            width: "100%",
            height: `${progress * 100}%`,
            backgroundColor: COLORS.primary,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: LEFT - 44,
          // 数字以「右上角为锚、向上生长」，锚点放在视口底边，读数就不会顶到画面外框
          top: 74 + VIEWPORT_HEIGHT,
          fontFamily: MONO_STACK,
          fontSize: 19,
          letterSpacing: 2.4,
          color: COLORS.stone,
          transform: "rotate(90deg)",
          transformOrigin: "right top",
          whiteSpace: "nowrap",
        }}
      >
        {String(Math.round(progress * 100)).padStart(3, "0")} %
      </div>
      <Caption text={COPY.captions.paperScroll} from={30} to={durationInFrames - 6} />
    </PaperBackground>
  );
};
