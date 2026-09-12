import React from "react";
import { Caption } from "../components/Caption";
import { Spotlight, WindowShot } from "../components/Frames";
import { PaperBackground } from "../components/PaperBackground";
import { useCopy, useShot } from "../locale";

const WIDTH = 1440;
const LEFT = (1920 - WIDTH) / 2;
const TOP = 34;

/** 阅读面本体：真实窗口截图，缓慢推镜，聚光落在正文列上。 */
export const Scene2TheWindow: React.FC = () => {
  const copy = useCopy();
  const shot = useShot();
  return (
    <PaperBackground>
      <WindowShot
        src={shot("01-window-reading.png")}
        width={WIDTH}
        from={1}
        to={1.055}
        zoomSpan={[20, 180]}
        driftY={-26}
        style={{ left: LEFT, top: TOP }}
      >
        <Spotlight cx={1090} cy={430} radius={720} dim={0.34} at={34} />
      </WindowShot>
      <Caption text={copy.captions.theWindow} from={46} to={178} mono="demo.md" />
    </PaperBackground>
  );
};
