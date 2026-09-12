import React from "react";
import { Composition, Folder } from "remotion";
import { useBrandFontsGate } from "./fonts";
import { SCENES, VIDEO } from "./theme";
import { VellumPromo } from "./VellumPromo";
import { Scene1ColdOpen } from "./scenes/Scene1ColdOpen";
import { Scene2TheWindow } from "./scenes/Scene2TheWindow";
import { Scene3PaperScroll } from "./scenes/Scene3PaperScroll";
import { Scene4OutlineSearch } from "./scenes/Scene4OutlineSearch";
import { Scene5EditInPlace } from "./scenes/Scene5EditInPlace";
import { Scene6LiveBlocks } from "./scenes/Scene6LiveBlocks";
import { Scene7EndCard } from "./scenes/Scene7EndCard";
import { FontProbe } from "./probe-fonts";
import { SocialCard } from "./SocialCard";

const sceneMeta = { fps: VIDEO.fps, width: VIDEO.width, height: VIDEO.height };

export const RemotionRoot: React.FC = () => {
  // 各场景自己也有闸门（PaperBackground）；这里再挂一道，保证 Root 那遍渲染同样等到字体就位
  useBrandFontsGate();

  return (
    <>
      <Folder name="Vellum-Promo-Scenes">
        <Composition
          id="S1-ColdOpen"
          component={Scene1ColdOpen}
          durationInFrames={SCENES.coldOpen}
          {...sceneMeta}
        />
        <Composition
          id="S2-TheWindow"
          component={Scene2TheWindow}
          durationInFrames={SCENES.theWindow}
          {...sceneMeta}
        />
        <Composition
          id="S3-PaperScroll"
          component={Scene3PaperScroll}
          durationInFrames={SCENES.paperScroll}
          {...sceneMeta}
        />
        <Composition
          id="S4-OutlineSearch"
          component={Scene4OutlineSearch}
          durationInFrames={SCENES.outlineSearch}
          {...sceneMeta}
        />
        <Composition
          id="S5-EditInPlace"
          component={Scene5EditInPlace}
          durationInFrames={SCENES.editInPlace}
          {...sceneMeta}
        />
        <Composition
          id="S6-LiveBlocks"
          component={Scene6LiveBlocks}
          durationInFrames={SCENES.liveBlocks}
          {...sceneMeta}
        />
        <Composition
          id="S7-EndCard"
          component={Scene7EndCard}
          durationInFrames={SCENES.endCard}
          {...sceneMeta}
        />
      </Folder>

      <Composition id="FontProbe" component={FontProbe} durationInFrames={2} {...sceneMeta} />

      {/* 社交分享卡：2:1，尺寸与正片不同，故单独声明 */}
      <Composition
        id="SocialCard"
        component={SocialCard}
        durationInFrames={2}
        width={1280}
        height={640}
        fps={VIDEO.fps}
      />

      <Composition
        id="VellumPromo"
        component={VellumPromo}
        durationInFrames={VIDEO.durationInFrames}
        defaultProps={{ music: true }}
        {...sceneMeta}
      />

      <Composition
        id="VellumPromoSilent"
        component={VellumPromo}
        durationInFrames={VIDEO.durationInFrames}
        defaultProps={{ music: false }}
        {...sceneMeta}
      />
    </>
  );
};
