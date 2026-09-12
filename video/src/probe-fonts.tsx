// 临时探针：确认字体到底有没有加载成功、以及无头 Chrome 里各族落到谁身上。
//   npx remotion still FontProbe out/probe-fonts.png
import React from "react";
import { AbsoluteFill } from "remotion";
import { fontDiagnostics, useBrandFontsGate } from "./fonts";
import { COLORS, SERIF_STACK } from "./theme";

const SAMPLES: [string, string, number][] = [
  ["Kai 400", "TsangerJinKai02", 400],
  ["Kai 500", "TsangerJinKai02", 500],
  ["Kai + serif", "TsangerJinKai02, serif", 400],
  ["SERIF_STACK", SERIF_STACK, 400],
  ["Georgia", "Georgia, serif", 400],
  ["generic serif", "serif", 400],
  ["JerBrains Mono", "JetBrains Mono, monospace", 400],
];

export const FontProbe: React.FC = () => {
  useBrandFontsGate();

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.parchment, padding: 24 }}>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 17,
          lineHeight: 1.5,
          color: COLORS.primary,
          whiteSpace: "pre-wrap",
          marginBottom: 16,
        }}
      >
        {fontDiagnostics.join("\n")}
      </div>
      {SAMPLES.map(([label, stack, weight], i) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "baseline", gap: 20, height: 78 }}
        >
          <div
            style={{
              width: 230,
              flexShrink: 0,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 18,
              color: COLORS.stone,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: stack,
              fontWeight: weight,
              fontSize: 44,
              color: COLORS.nearBlack,
            }}
          >
            The Paper Interface — 素笺 Vellum
          </div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, color: COLORS.stone }}>
            {i}
          </div>
        </div>
      ))}
    </AbsoluteFill>
  );
};
