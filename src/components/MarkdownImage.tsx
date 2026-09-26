import { invoke } from "@tauri-apps/api/core";
import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageViewer } from "./ImageViewer";

type MarkdownImageProps = {
  src?: string;
  alt?: string;
  title?: string;
};

function isRemote(src: string) {
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:");
}

// memo：props 均为字符串，父级因搜索等状态重渲染时图片组件整体跳过，
// 避免重复触发 resolve_asset IPC
export const MarkdownImage = memo(function MarkdownImage({ src, alt = "", title }: MarkdownImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState(() => (src && isRemote(src) ? src : ""));
  const [error, setError] = useState<string | null>(null);
  /// 点击查看器开关：状态留在本组件内（正文 components 映射不因此多 prop），
  /// 查看器本体 createPortal 到 document.body
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    async function resolve() {
      if (!src) {
        setResolvedSrc("");
        return;
      }
      if (isRemote(src)) {
        setResolvedSrc(src);
        return;
      }

      setResolvedSrc("");

      try {
        const resolved = await invoke<string>("resolve_asset", { assetSrc: src });
        if (!cancelled) setResolvedSrc(resolved);
      } catch (resolveError) {
        if (!cancelled) setError(String(resolveError));
      }
    }

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;

  if (error) {
    return (
      <span className="broken-asset" role="note">
        Image unavailable: {src}
      </span>
    );
  }

  if (!resolvedSrc) {
    return <span className="asset-placeholder">{alt}</span>;
  }

  // 点击放大只认「阅读视图里的裸图」：链接包裹的图点击是导航（不拦），
  // 编辑视图里的点击是块激活（不抢）。其余路径不动事件，照常冒泡
  function handleActivate(event: React.MouseEvent<HTMLImageElement>) {
    if (event.currentTarget.closest("a")) return;
    if (event.currentTarget.closest(".document-scroll__content--editing")) return;
    setViewing(true);
  }

  return (
    <>
      <img src={resolvedSrc} alt={alt} title={title} loading="lazy" onClick={handleActivate} />
      {viewing
        ? createPortal(
            <ImageViewer src={resolvedSrc} alt={alt} onClose={() => setViewing(false)} />,
            document.body
          )
        : null}
    </>
  );
});
