import React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene1ColdOpen } from "./scenes/Scene1ColdOpen";
import { Scene2TheWindow } from "./scenes/Scene2TheWindow";
import { Scene3PaperScroll } from "./scenes/Scene3PaperScroll";
import { Scene4OutlineSearch } from "./scenes/Scene4OutlineSearch";
import { Scene5EditInPlace } from "./scenes/Scene5EditInPlace";
import { Scene6LiveBlocks } from "./scenes/Scene6LiveBlocks";
import { Scene7EndCard } from "./scenes/Scene7EndCard";
import { SCENES } from "./theme";

// 场景时长之和不等于成片时长：TransitionSeries 的转场与相邻两场**重叠**，
// 所以 7 场比目标时长多出 6 × TRANSITION 帧。
const T = SCENES.TRANSITION;
const timing = linearTiming({ durationInFrames: T });

export type VellumPromoProps = {
  /** README 里要自动播放的静音版：同一条时间线，只抽掉音轨。 */
  music?: boolean;
};

export const VellumPromo: React.FC<VellumPromoProps> = ({ music = true }) => {
  return (
    <AbsoluteFill>
      {music ? (
        <Audio
          src={staticFile("music.wav")}
          volume={(f) =>
            interpolate(f, [0, 26, 830, 900], [0, 0.5, 0.46, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}

      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES.coldOpen}>
          <Scene1ColdOpen />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.theWindow}>
          <Scene2TheWindow />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.paperScroll}>
          <Scene3PaperScroll />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.outlineSearch}>
          <Scene4OutlineSearch />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.editInPlace}>
          <Scene5EditInPlace />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.liveBlocks}>
          <Scene6LiveBlocks />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.endCard}>
          <Scene7EndCard />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
