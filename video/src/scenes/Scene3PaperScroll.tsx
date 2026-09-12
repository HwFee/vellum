import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "../components/Caption";
import { PlateScroll } from "../components/Frames";
import { PaperBackground } from "../components/PaperBackground";
import { useCopy, useLocale, useShot } from "../locale";
import { COLORS, MONO_STACK } from "../theme";
import { PLATE_ARTICLE, PLATE_ARTICLE_ZH } from "../assetSizes";

const FRAME_WIDTH = 1500;
const VIEWPORT_HEIGHT = 800;
const LEFT = (1920 - FRAME_WIDTH) / 2;
/**
 * 视口推进距离 = plate 高度的 63%。
 * 以前这里是写死的 4300px，只为英文文档调过；中文文档短一截（约 6434 vs 6856 像素高），
 * 同一个像素值会推进过头或推不够——改成比例，两份文档各自走到该走的地方。
 */
const TRAVEL_RATIO = 0.63;

/** 通篇推进：一张全高长图，视口自上而下走一遍。左侧墨线是阅读进度。 */
export const Scene3PaperScroll: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const plate = useLocale() === "zh" ? PLATE_ARTICLE_ZH : PLATE_ARTICLE;
  const shot = useShot();
  const copy = useCopy();
  const scale = FRAME_WIDTH / plate.width;
  const renderedHeight = plate.height * scale;
  const maxScroll = Math.max(0, renderedHeight - VIEWPORT_HEIGHT);

  const endY = plate.height * TRAVEL_RATIO;
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
        src={shot("02-article-plate.png")}
        nativeWidth={plate.width}
        nativeHeight={plate.height}
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
      <Caption text={copy.captions.paperScroll} from={30} to={durationInFrames - 6} />
    </PaperBackground>
  );
};
