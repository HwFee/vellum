import React from "react";
import { Caption } from "../components/Caption";
import { Spotlight, WindowShot } from "../components/Frames";
import { PaperBackground } from "../components/PaperBackground";
import { COPY } from "../theme";

const WIDTH = 1440;
const LEFT = (1920 - WIDTH) / 2;
const TOP = 34;

/** 大纲与全文搜索：镜头向左侧栏偏，聚光压住正文，视线自然落到「寻章」上。 */
export const Scene4OutlineSearch: React.FC = () => {
  return (
    <PaperBackground>
      <WindowShot
        src="capture/03-window-search.png"
        width={WIDTH}
        from={1}
        to={1.14}
        zoomSpan={[10, 150]}
        driftX={-40}
        driftY={-8}
        origin="26% 22%"
        style={{ left: LEFT, top: TOP }}
      >
        <Spotlight cx={190} cy={300} radius={620} dim={0.5} at={16} />
      </WindowShot>
      <Caption text={COPY.captions.outlineSearch} from={26} to={138} mono="⌘K" />
    </PaperBackground>
  );
};
