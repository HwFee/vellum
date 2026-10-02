import { act, renderHook } from "@testing-library/react";
import type { DocumentState, LoadedDocument } from "../types";
import { useStartupWindow } from "./useStartupWindow";

const windowShow = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ show: windowShow })),
}));

const note: LoadedDocument = {
  path: "C:/notes/a.md",
  fileName: "a.md",
  parentPath: "C:/notes",
  markdown: "# A",
};

function readyDoc(document: LoadedDocument): DocumentState {
  return { status: "ready", document, wikilinks: new Map() };
}

const frames: FrameRequestCallback[] = [];

function flushFrames(): void {
  while (frames.length > 0) {
    frames.shift()!(performance.now() + 5000);
  }
}

async function settle(): Promise<void> {
  await act(async () => {});
}

function deferFonts(): () => void {
  let resolve!: () => void;
  const ready = new Promise<FontFaceSet>((r) => {
    resolve = r as () => void;
  });
  Object.defineProperty(document, "fonts", {
    value: { ready },
    configurable: true,
  });
  return resolve;
}

function dropFonts(): void {
  Object.defineProperty(document, "fonts", {
    value: undefined,
    configurable: true,
  });
}

beforeEach(() => {
  frames.length = 0;
  windowShow.mockReset();
  windowShow.mockResolvedValue(undefined);
  dropFonts();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("ready document alone never shows the window — only the content-rendered callback counts", async () => {
  const onVisible = vi.fn();
  renderHook(() => useStartupWindow(readyDoc(note), true, onVisible));

  await settle();
  act(flushFrames);
  await settle();

  expect(windowShow).not.toHaveBeenCalled();
  expect(onVisible).not.toHaveBeenCalled();
});

test("ready document callback shows after fonts ready and two frames; coalesced to one show", async () => {
  const resolveFonts = deferFonts();
  const onVisible = vi.fn();
  const { result } = renderHook(() => useStartupWindow(readyDoc(note), false, onVisible));

  act(() => {
    result.current();
    result.current();
  });
  await settle();
  expect(windowShow).not.toHaveBeenCalled();

  await act(async () => {
    resolveFonts();
  });
  expect(windowShow).not.toHaveBeenCalled();

  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(1);
  expect(onVisible).toHaveBeenCalledTimes(1);
});

test("startupResolved=false does not gate a ready document's callback (slow mdlog regression)", async () => {
  const onVisible = vi.fn();
  const { result } = renderHook(() => useStartupWindow(readyDoc(note), false, onVisible));

  act(() => {
    result.current();
  });
  await settle();
  act(flushFrames);
  await settle();

  expect(windowShow).toHaveBeenCalledTimes(1);
  expect(onVisible).toHaveBeenCalledTimes(1);
});

test("empty state waits for startupResolved, then reveals after frames", async () => {
  const { rerender } = renderHook(
    ({ resolved }) => useStartupWindow({ status: "empty" }, resolved),
    { initialProps: { resolved: false } }
  );

  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).not.toHaveBeenCalled();

  rerender({ resolved: true });
  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(1);
});

test("error and empty-library states reveal once resolved", async () => {
  const error = renderHook(
    () => useStartupWindow({ status: "error", message: "boom" }, true),
  );
  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(1);
  error.unmount();

  const emptyLibrary: DocumentState = {
    status: "ready",
    document: { ...note, path: "" },
    wikilinks: new Map(),
  };
  renderHook(() => useStartupWindow(emptyLibrary, true));
  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(2);
});

test("state change while fonts deferred aborts the stale reveal; new state shows", async () => {
  const resolveFonts = deferFonts();
  const doc2 = { ...note, path: "C:/notes/b.md", fileName: "b.md" };
  const { result, rerender } = renderHook(
    ({ state }) => useStartupWindow(state, false),
    { initialProps: { state: readyDoc(note) } }
  );

  act(() => {
    result.current();
  });
  rerender({ state: readyDoc(doc2) });
  await act(async () => {
    resolveFonts();
  });
  act(flushFrames);
  await settle();
  expect(windowShow).not.toHaveBeenCalled();

  act(() => {
    result.current();
  });
  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(1);
});

test("unmount while pending never shows", async () => {
  const resolveFonts = deferFonts();
  const { result, unmount } = renderHook(() =>
    useStartupWindow(readyDoc(note), false)
  );

  act(() => {
    result.current();
  });
  unmount();
  await act(async () => {
    resolveFonts();
  });
  act(flushFrames);
  await settle();
  expect(windowShow).not.toHaveBeenCalled();
});

test("show rejection resets the gate: a later callback retries and still reports once", async () => {
  windowShow.mockRejectedValueOnce(new Error("no window"));
  const onVisible = vi.fn();
  const { result } = renderHook(() => useStartupWindow(readyDoc(note), false, onVisible));

  act(() => {
    result.current();
  });
  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(1);
  expect(onVisible).not.toHaveBeenCalled();

  act(() => {
    result.current();
  });
  await settle();
  act(flushFrames);
  await settle();
  expect(windowShow).toHaveBeenCalledTimes(2);
  expect(onVisible).toHaveBeenCalledTimes(1);
});
