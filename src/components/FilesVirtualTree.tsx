import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import { fileNameToTitle } from "../lib/path";
import type { VisibleFileRow } from "../lib/library";

export type FilesVirtualTreeProps = {
  rows: VisibleFileRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  documentPath: string | null;
  onToggle: (relPath: string) => void;
  onOpenPath: (path: string) => void;
  expanded: ReadonlySet<string>;
  flat: boolean;
  resetKey: string;
  FolderIcon: ComponentType;
};

const TREE_ROW_HEIGHT = 32;
const FLAT_ROW_HEIGHT = 48;
const OVERSCAN = 8;
const FALLBACK_VIEWPORT = 480;

export function FilesVirtualTree({
  rows,
  scrollRef,
  documentPath,
  onToggle,
  onOpenPath,
  expanded,
  flat,
  resetKey,
  FolderIcon,
}: FilesVirtualTreeProps) {
  const rowHeight = flat ? FLAT_ROW_HEIGHT : TREE_ROW_HEIGHT;
  const [viewport, setViewport] = useState({ top: 0, height: FALLBACK_VIEWPORT });
  const rafRef = useRef<number | null>(null);
  const focusRequestedRef = useRef(false);
  const hasFocusRef = useRef(false);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastFocusRowRef = useRef<VisibleFileRow | null>(null);
  const prevResetKeyRef = useRef(resetKey);
  const lastDocRef = useRef(documentPath);
  const initResolvedRef = useRef(documentPath === null);

  const indexByPath = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.node.relPath, index));
    return map;
  }, [rows]);

  const [focusPath, setFocusPath] = useState<string | null>(() => {
    const current = rows.findIndex((row) => row.node.path === documentPath);
    return rows[current >= 0 ? current : 0]?.node.relPath ?? null;
  });

  const setFocusRow = (row: VisibleFileRow) => {
    lastFocusRowRef.current = row;
    setFocusPath(row.node.relPath);
  };

  const readViewport = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const next = {
      top: scroller.scrollTop,
      height: scroller.clientHeight || FALLBACK_VIEWPORT,
    };
    setViewport((prev) =>
      prev.top === next.top && prev.height === next.height ? prev : next
    );
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const scheduleRead = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        readViewport();
      });
    };
    readViewport();
    scroller.addEventListener("scroll", scheduleRead, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleRead);
      observer.observe(scroller);
    } else {
      window.addEventListener("resize", scheduleRead);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      scroller.removeEventListener("scroll", scheduleRead);
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", scheduleRead);
    };
  }, []);

  const scrollToIndex = (index: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const height = scroller.clientHeight || viewport.height;
    const rowTop = index * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < scroller.scrollTop) {
      scroller.scrollTop = rowTop;
    } else if (rowBottom > scroller.scrollTop + height) {
      scroller.scrollTop = rowBottom - height;
    }
    setViewport((prev) => ({
      top: scroller.scrollTop,
      height: scroller.clientHeight || prev.height,
    }));
  };

  useEffect(() => {
    if (documentPath !== lastDocRef.current) {
      lastDocRef.current = documentPath;
      initResolvedRef.current = documentPath === null;
    }
    if (initResolvedRef.current || documentPath === null) return;
    const index = rows.findIndex((row) => row.node.path === documentPath);
    if (index === -1) return;
    initResolvedRef.current = true;
    setFocusRow(rows[index]);
    scrollToIndex(index);
  }, [documentPath, rows, rowHeight, scrollRef]);

  useEffect(() => {
    if (prevResetKeyRef.current === resetKey) return;
    prevResetKeyRef.current = resetKey;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = 0;
    setViewport((prev) => ({ ...prev, top: 0 }));
  }, [resetKey, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const height = scroller.clientHeight || viewport.height;
    const max = Math.max(0, rows.length * rowHeight - height);
    if (scroller.scrollTop > max) {
      scroller.scrollTop = max;
      setViewport({ top: max, height });
    }
  }, [rows, rowHeight, scrollRef, viewport.height]);

  useEffect(() => {
    if (focusPath !== null && indexByPath.has(focusPath)) return;
    let prefix = lastFocusRowRef.current?.parentRelPath;
    let next: string | null = null;
    while (prefix !== undefined) {
      if (indexByPath.has(prefix)) {
        next = prefix;
        break;
      }
      prefix = prefix.includes("/")
        ? prefix.slice(0, prefix.lastIndexOf("/"))
        : undefined;
    }
    if (next === null) next = rows[0]?.node.relPath ?? null;
    const fallback = next === null ? null : rows[indexByPath.get(next)!];
    if (fallback) lastFocusRowRef.current = fallback;
    if (hasFocusRef.current && next !== null) {
      scrollToIndex(indexByPath.get(next)!);
      focusRequestedRef.current = true;
    }
    setFocusPath(next);
  }, [focusPath, indexByPath, rows]);

  useLayoutEffect(() => {
    if (!focusRequestedRef.current) return;
    if (focusPath === null) {
      focusRequestedRef.current = false;
      return;
    }
    const button = buttonRefs.current.get(focusPath);
    if (button) {
      focusRequestedRef.current = false;
      button.focus({ preventScroll: true });
    }
  });

  const moveFocus = (index: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    const target = rows[clamped];
    if (!target) return;
    focusRequestedRef.current = true;
    setFocusRow(target);
    scrollToIndex(clamped);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: VisibleFileRow,
    index: number
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const pageStep = Math.max(1, Math.floor(viewport.height / rowHeight));
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(index - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(rows.length - 1);
        break;
      case "PageDown":
        event.preventDefault();
        moveFocus(index + pageStep);
        break;
      case "PageUp":
        event.preventDefault();
        moveFocus(index - pageStep);
        break;
      case "ArrowRight":
        if (row.node.children) {
          event.preventDefault();
          if (!expanded.has(row.node.relPath)) {
            onToggle(row.node.relPath);
          } else if (rows[index + 1]?.parentRelPath === row.node.relPath) {
            moveFocus(index + 1);
          }
        }
        break;
      case "ArrowLeft":
        if (row.node.children && expanded.has(row.node.relPath)) {
          event.preventDefault();
          onToggle(row.node.relPath);
        } else if (row.parentRelPath !== undefined) {
          const parent = indexByPath.get(row.parentRelPath);
          if (parent !== undefined) {
            event.preventDefault();
            moveFocus(parent);
          }
        }
        break;
      default:
        break;
    }
  };

  const maxTop = Math.max(0, rows.length * rowHeight - viewport.height);
  const boundedTop = Math.min(Math.max(viewport.top, 0), maxTop);
  const start = Math.max(0, Math.floor(boundedTop / rowHeight) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((boundedTop + viewport.height) / rowHeight) + OVERSCAN
  );
  const items: Array<{ row: VisibleFileRow; index: number }> = [];
  for (let index = start; index < end; index += 1) {
    items.push({ row: rows[index], index });
  }
  const focusIndex = focusPath !== null ? indexByPath.get(focusPath) : undefined;
  if (focusIndex !== undefined && (focusIndex < start || focusIndex >= end)) {
    items.push({ row: rows[focusIndex], index: focusIndex });
    items.sort((a, b) => a.index - b.index);
  }

  const bindButton =
    (key: string) => (element: HTMLButtonElement | null) => {
      if (element) buttonRefs.current.set(key, element);
      else buttonRefs.current.delete(key);
    };

  return (
    <ul
      className="library-tree library-tree--virtual"
      role="tree"
      aria-label="库文件列表"
      onFocusCapture={() => {
        hasFocusRef.current = true;
      }}
      onBlurCapture={(event) => {
        const target = event.relatedTarget;
        if (!(target instanceof Node) || !event.currentTarget.contains(target)) {
          hasFocusRef.current = false;
        }
      }}
      style={{
        height: rows.length * rowHeight,
        ["--library-row-height" as string]: `${rowHeight}px`,
      }}
    >
      {items.map(({ row, index }) => {
        const node = row.node;
        const focused = node.relPath === focusPath;
        const rowStyle = {
          position: "absolute" as const,
          top: index * rowHeight,
          left: 0,
          width: "100%",
          height: rowHeight,
          boxSizing: "border-box" as const,
          paddingLeft: row.depth * 19,
          ["--library-row-indent" as string]: `${row.depth * 19}px`,
        };
        return (
          <li key={node.relPath} role="none" style={rowStyle}>
            {node.children ? (
              <button
                type="button"
                role="treeitem"
                aria-level={row.depth + 1}
                aria-posinset={row.indexInParent}
                aria-setsize={row.siblingCount}
                aria-expanded={expanded.has(node.relPath)}
                tabIndex={focused ? 0 : -1}
                className="library-tree__folder"
                ref={bindButton(node.relPath)}
                onFocus={() => setFocusRow(row)}
                onKeyDown={(event) => handleKeyDown(event, row, index)}
                onClick={() => onToggle(node.relPath)}
              >
                <span className="library-tree__chev" aria-hidden="true">
                  ›
                </span>
                <FolderIcon />
                {node.name}
              </button>
            ) : (
              <button
                type="button"
                role="treeitem"
                aria-level={row.depth + 1}
                aria-posinset={row.indexInParent}
                aria-setsize={row.siblingCount}
                aria-selected={node.path === documentPath}
                tabIndex={focused ? 0 : -1}
                className={
                  "outline-panel__link library-tree__file" +
                  (flat ? " library-tree__file--flat" : "") +
                  (node.path === documentPath ? " outline-panel__link--active" : "")
                }
                title={node.relPath}
                ref={bindButton(node.relPath)}
                onFocus={() => setFocusRow(row)}
                onKeyDown={(event) => handleKeyDown(event, row, index)}
                onClick={() => node.path && onOpenPath(node.path)}
              >
                {fileNameToTitle(node.name)}
                {flat ? (
                  <span className="library-tree__dir">{node.relPath}</span>
                ) : null}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
