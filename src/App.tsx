import { Suspense, lazy } from "react";
import { BlockEditor } from "./components/BlockEditor";
import { CustomScrollbar } from "./components/CustomScrollbar";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { JumpToBottom } from "./components/JumpToBottom";
import { OutlinePanel } from "./components/OutlinePanel";
import { SettingsNav } from "./components/SettingsNav";
import { SettingsView } from "./components/SettingsView";
import { ExportPdfView } from "./components/ExportPdfView";
import { TopBar } from "./components/TopBar";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useAppRuntime } from "./hooks/useAppRuntime";
import { useDocumentEditor } from "./hooks/useDocumentEditor";
import { useDocumentLoader } from "./hooks/useDocumentLoader";
import { useFullScreenViews } from "./hooks/useFullScreenViews";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useLayoutShift } from "./hooks/useLayoutShift";
import { useMdlog } from "./hooks/useMdlog";
import { useNavHistory } from "./hooks/useNavHistory";
import { useOutline } from "./hooks/useOutline";
import { useOutlineOpen } from "./hooks/useOutlineOpen";
import { OUTLINE_WIDTH_DEFAULT, useOutlineWidth } from "./hooks/useOutlineWidth";
import { usePinnedLayoutActions } from "./hooks/usePinnedLayoutActions";
import { usePlatformBindings } from "./hooks/usePlatformBindings";
import { useReaderSettings } from "./hooks/useReaderSettings";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { useScrollMemory } from "./hooks/useScrollMemory";
import { useScrollPosition } from "./hooks/useScrollPosition";
import { useSearchState } from "./hooks/useSearchState";
import { useSmoothNav } from "./hooks/useSmoothNav";
import { fileNameToTitle } from "./lib/path";

// 代码分割：react-markdown + rehype/remark + 语法高亮是体积最大的依赖，
// 懒加载后首屏（顶栏/空状态）先行渲染，文档引擎在后台加载。
const MarkdownDocument = lazy(() => import("./components/MarkdownDocument"));

/**
 * 应用外壳：只负责「runtime 创建 → 领域 hooks 按依赖序接线 → JSX」。
 * 跨域共享 ref 集中在 `rt`（见 hooks/useAppRuntime.ts 的总线注释）；
 * 每个领域 hook 的实现与裁定注释都在各自文件里逐字保留。
 */
export default function App() {
  const rt = useAppRuntime();
  const { scrollRef, contentRef, documentContentRef, searchInputRef } = rt.dom;
  const { loadPathRef } = rt.doc;

  const [isOutlineOpen, toggleOutline, setIsOutlineOpen] = useOutlineOpen(false);
  const isNarrow = useIsNarrow();
  const [outlineWidth, setOutlineWidth] = useOutlineWidth();
  // 阅读设置（字号 / 栏宽 / 行高）：变量覆写挂在 documentElement，与文档无关
  const [readerSettings, setReaderSettings] = useReaderSettings();
  // 界面行为偏好（启动时展开侧栏 / 启动时自动检查更新）：与阅读设置同一个 settings.json Store
  const [preferences, setPreferences] = useAppPreferences();

  // 布局过渡窗 + 宽度过渡期视口钉住
  const { isLayoutShifting, noteLayoutShift, beginWidthTransition } = useLayoutShift(rt, {
    isOutlineOpen,
    outlineWidth,
    readerSettings,
  });

  // ===== 搜索状态 =====
  const {
    searchQuery,
    deferredSearchQuery,
    searchQueryPending,
    activeMatchIndex,
    matchCount,
    handleSearchChange,
    handleNextMatch,
    handlePrevMatch,
    handleMatchCountChange,
  } = useSearchState();

  // 最近打开列表（新→旧）：空态列表与「启动恢复上一篇」共用同一份状态
  const {
    recentFiles,
    addRecentTop,
    removeRecentTop,
    clearRecent: handleClearRecent,
    loadRecent,
  } = useRecentFiles();

  // 阅读位置的测量与落盘
  const { currentScrollRecord, persistCurrentScroll } = useScrollPosition(rt);

  // ===== 整页视图（设置 / 导出为 PDF） =====
  const {
    isSettingsOpen,
    settingsSectionId,
    setSettingsSectionId,
    exportDoc,
    isExportOpen,
    closeSettings,
    handleToggleSettings,
    closeExport,
    toggleExport,
  } = useFullScreenViews(rt, { getScrollRecord: currentScrollRecord });

  // 「先钉视口再改布局」的全部入口（红线 8 收口）
  const {
    toggleOutlinePinned,
    setOutlineOpenPinned,
    handleReaderSettingsChange,
    handleSidebarResizeStart,
    isSidebarResizing,
  } = usePinnedLayoutActions({
    toggleOutline,
    setIsOutlineOpen,
    isOutlineOpen,
    isNarrow,
    outlineWidth,
    setOutlineWidth,
    setReaderSettings,
    beginWidthTransition,
    noteLayoutShift,
    isSettingsOpen,
    isExportOpen,
  });

  // 程序化滚动与文档内导航
  const { scrollHeadingIntoView, handleSelectSettingsSection } = useSmoothNav(rt, {
    setSettingsSectionId,
  });

  // mdlog 现场日志
  const { mdlogState, isMdlogActive, setMdlogState, applyLoadedState, resetForDocumentSwitch } =
    useMdlog(rt, { persistCurrentScroll });

  // ===== wikilink 前进/后退历史 =====
  const { navHistory, pushNavEntry, resetForwardStack, handleNavBack, handleNavForward } =
    useNavHistory(rt);

  // 文档加载管线（状态机 / 热重载 / wikilink 解析 / 打开对话框）
  const {
    state,
    setState,
    activeDocument,
    reloadTick,
    showReloadNote,
    loadPath,
    reloadCurrent,
    handleOpen,
    applyMarkdown,
    saveMarkdown,
    handleActivateUnit,
    handleOpenWikilink,
    handleToggleEdit,
    handleToggleTask,
  } = useDocumentLoader(rt, {
    closeSettings,
    currentScrollRecord,
    scrollHeadingIntoView,
    pushNavEntry,
    resetForwardStack,
    addRecentTop,
    removeRecentTop,
    applyLoadedMdlogState: applyLoadedState,
    setMdlogState,
    resetMdlogForSwitch: resetForDocumentSwitch,
  });

  // 编辑会话（在 activeDocument 之后创建）：回调与 effect 经 editorRef 读到最新一份，
  // 既避免闭包过期，也让传给 memo 化 MarkdownDocument 的回调保持引用稳定
  const editor = useDocumentEditor({
    markdown: activeDocument?.markdown ?? "",
    mdlogActive: isMdlogActive,
    onMarkdownChange: applyMarkdown,
    save: saveMarkdown,
    // 传 getter 而不是值：装入路径递增的是上面那个 ref，此刻渲染尚未提交，
    // 值快照会让 hook 在「递增 → 提交」的调度窗里仍按旧代际判断（勾选回滚可能写坏新文档）
    getDocumentGeneration: () => rt.doc.documentGenerationRef.current,
  });
  rt.doc.editorRef.current = editor;

  // 阅读位置记忆与热重载滚动仲裁
  const { handleContentRendered } = useScrollMemory(rt, {
    persistCurrentScroll,
    scrollHeadingIntoView,
    markdown: activeDocument?.markdown,
    reloadTick,
  });

  // 文档大纲
  const { headings, activeHeadingId, handleSelectHeading } = useOutline(rt, {
    markdown: activeDocument?.markdown,
    // revision 传视图标识：设置视图期间正文整块退出 DOM，回来时标题是新元素——
    // 观察器不按它重挂就再也不会回调（大纲高亮会停在设置视图里的空白态）
    revision: isSettingsOpen ? "settings" : isExportOpen ? "export" : "document",
    isNarrow,
    setOutlineOpenPinned,
    scrollHeadingIntoView,
  });

  // 平台侧绑定（拖放 / 启动管线 / file-changed 分流 / 窗口标题）
  const { isDropTarget } = usePlatformBindings(rt, {
    loadPath,
    reloadCurrent,
    setState,
    loadRecent,
    state,
  });

  // 全局快捷键（最后接线：收齐全部 handler）
  useGlobalShortcuts(rt, {
    isOutlineOpen,
    setOutlineOpenPinned,
    toggleOutlinePinned,
    handleNavBack,
    handleNavForward,
    toggleExport,
  });

  return (
    <main
      className={
        "app-shell" +
        (isLayoutShifting ? " app-shell--layout-shifting" : "") +
        (isSidebarResizing ? " app-shell--sidebar-resizing" : "")
      }
    >
      <TopBar
        onOpen={handleOpen}
        isOutlineOpen={isOutlineOpen}
        onToggleOutline={toggleOutlinePinned}
        canGoBack={navHistory.back.length > 0}
        canGoForward={navHistory.forward.length > 0}
        onGoBack={handleNavBack}
        onGoForward={handleNavForward}
        isRecording={isMdlogActive}
        isEditing={editor.viewMode === "editing"}
        canEdit={!isMdlogActive}
        onToggleEdit={handleToggleEdit}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={handleToggleSettings}
        canExport={state.status === "ready" && !isSettingsOpen}
        isExportOpen={isExportOpen}
        onToggleExport={toggleExport}
      />
      <div className={`app-shell__body ${isOutlineOpen ? "app-shell__body--outline-open" : ""}`}>
        {/* 热重载提示（二）：印章，悬浮于窗口中下方、不随文档滚动；key 变化即重播。
            key 带前缀：两个提示都从 1 起计数，裸数字会与下面的 editor-toast 撞 key */}
        {showReloadNote && (
          <div key={`reload-${reloadTick}`} className="reload-note" role="status">
            墨迹未干
          </div>
        )}
        {/* 编辑提示条（HTML/交互块只读、记录中禁用、保存失败）：与「墨迹未干」同一视觉语言，
            由 App 层统一渲染 —— 不放进 memo 化的解析层，避免把提示状态带进正文渲染 */}
        {editor.toast ? (
          <div key={`toast-${editor.toast.id}`} className="editor-toast" role="status">
            {editor.toast.message}
          </div>
        ) : null}
        {/* 重文档软提示（spec D5 / 裁定 F40）：实测提交耗时超阈值后的常驻轻提示，
            只在编辑视图内可见（阅读视图 DOM 不变）；它是文档规模属性，不自动消失 */}
        {editor.viewMode === "editing" && editor.heavyDoc ? (
          <div className="editor-hint" role="status">
            本文档较大，提交可能有不到一秒的停顿
          </div>
        ) : null}
        <aside className={`outline-sidebar ${isOutlineOpen ? "outline-sidebar--open" : ""}`}>
          {/* 同一枚侧栏换内容：设置视图里是「設定」导航（样式、开合、拖宽、默认关全部跟着
              文章大纲那枚走），阅读视图里是文档大纲 */}
          {isSettingsOpen ? (
            <SettingsNav
              activeSectionId={settingsSectionId}
              onSelectSection={handleSelectSettingsSection}
              searchInputRef={searchInputRef}
            />
          ) : (
            <OutlinePanel
              headings={headings}
              activeHeadingId={activeHeadingId}
              onSelectHeading={handleSelectHeading}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              matchCount={matchCount}
              activeMatchIndex={activeMatchIndex}
              searchQueryPending={searchQueryPending}
              onNextMatch={handleNextMatch}
              onPrevMatch={handlePrevMatch}
              searchInputRef={searchInputRef}
            />
          )}
        </aside>
        {/* 侧边栏宽度手柄：骑跨侧栏右缘边线（aside overflow:hidden，须作兄弟节点外置），
            拖拽调宽 200–320px，双击复位默认宽度；窄屏下正文不位移（浮层模式），拖了无意义，不渲染 */}
        {isOutlineOpen && !isNarrow && (
          <div
            className="outline-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调节侧边栏宽度"
            title="拖动调节宽度 · 双击复位"
            onPointerDown={handleSidebarResizeStart}
            onDoubleClick={() => setOutlineWidth(OUTLINE_WIDTH_DEFAULT)}
          />
        )}
        <div
          ref={scrollRef}
          className={"document-scroll" + (isDropTarget ? " document-scroll--drop-target" : "")}
          tabIndex={0}
        >
          <div
            ref={contentRef}
            className={
              "document-scroll__content" +
              (isSettingsOpen ? " document-scroll__content--settings" : "") +
              (isExportOpen ? " document-scroll__content--export" : "") +
              (!isSettingsOpen && editor.viewMode === "editing"
                ? " document-scroll__content--editing"
                : "")
            }
          >
            {/* 正文区整块替换：设置视图打开时正文（含 widget iframe 与就地编辑覆盖层）
                整体退出 DOM —— 阅读位置已在进入时取下、退出时按既有落位管线放回
                （见 openSettings / handleContentRendered） */}
            {isSettingsOpen ? (
              <SettingsView
                settings={readerSettings}
                onSettingsChange={handleReaderSettingsChange}
                preferences={preferences}
                onPreferencesChange={setPreferences}
                currentDocumentPath={activeDocument?.path ?? null}
                recentCount={recentFiles.length}
                onClearRecent={handleClearRecent}
                onExit={closeSettings}
              />
            ) : exportDoc ? (
              <ExportPdfView
                title={exportDoc.title}
                ownTitle={exportDoc.ownTitle}
                bodyHtml={exportDoc.bodyHtml}
                onExit={closeExport}
              />
            ) : (
              <>
                <div ref={documentContentRef} className="document-content">
                  {state.status === "empty" ? (
                    <EmptyState
                      onOpen={handleOpen}
                      recentFiles={recentFiles}
                      onOpenRecent={(path) => void loadPathRef.current(path)}
                    />
                  ) : null}
                  {state.status === "loading" ? (
                    <section className="empty-state" role="status">
                      加载中...
                    </section>
                  ) : null}
                  {state.status === "error" ? (
                    <ErrorState
                      message={state.message}
                      path={state.path}
                      onRetry={handleOpen}
                      recentFiles={recentFiles}
                      onOpenRecent={(path) => void loadPathRef.current(path)}
                    />
                  ) : null}
                  {state.status === "ready" ? (
                    <>
                      {/* 文档标题（Obsidian 的 inline title）：取自文件名，落在正文首行。
                          刻意放在 .markdown-body 之外——它不属于文档内容，也就不进 markdown
                          解析、搜索高亮、块单元与大纲。
                          title 是完整绝对路径：2026-09-20 顶栏纯工具栏化后，路径的归宿只有
                          这里（hover）与设置页「当前文档」 */}
                      <h1 className="document-title" title={state.document.path}>
                        {fileNameToTitle(state.document.fileName)}
                      </h1>
                      <Suspense fallback={null}>
                        <MarkdownDocument
                          markdown={state.document.markdown}
                          headings={headings}
                          onRendered={handleContentRendered}
                          searchQuery={deferredSearchQuery}
                          searchQueryPending={searchQueryPending}
                          activeMatchIndex={activeMatchIndex}
                          onMatchCountChange={handleMatchCountChange}
                          editable={editor.viewMode === "editing"}
                          onActivateUnit={handleActivateUnit}
                          onToggleTask={handleToggleTask}
                          wikilinks={state.wikilinks}
                          onOpenWikilink={handleOpenWikilink}
                        />
                      </Suspense>
                      {mdlogState !== null && (
                        <div className="mdlog-live">记录中 · PI</div>
                      )}
                    </>
                  ) : null}
                </div>
                {/* 就地编辑覆盖层：必须是 .document-scroll__content 的直接子元素（T3 的定位基准），
                    且与正文同级并列 —— 不放进 .markdown-body，避开其 textarea 规则的样式覆盖（裁定 F23）。
                    覆盖层与编辑态类名同一门槛（视图标志 + 活动块）：落盘失败后 toggleView 仍会退回阅读
                    视图（T4 未修 I3），但活动块已重新激活且草稿保留 —— 此时不能留下无标记可依的孤悬
                    覆盖层（units 为空、定位基准缺失），草稿由再按 Ctrl+E 原样带回。
                    设置视图期间它与正文一起退出 DOM：那时没有可标记可依的正文元素 */}
                {editor.viewMode === "editing" && editor.activeUnit ? (
                  <BlockEditor
                    unitIndex={editor.activeUnit.index}
                    value={editor.draft}
                    initialCaret={editor.initialCaret}
                    onChange={editor.updateDraft}
                    onCommit={() => void editor.commitActive()}
                    onCancel={() => void editor.commitActive()}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      <CustomScrollbar containerRef={scrollRef} contentRef={contentRef} />
      {/* 跳底按钮是正文的装置：设置视图里没有「文档底部」可言 */}
      {state.status === "ready" && !isSettingsOpen && !isExportOpen && <JumpToBottom containerRef={scrollRef} />}
      {isOutlineOpen && isNarrow && (
        <div className="outline-scrim" role="presentation" onClick={() => setOutlineOpenPinned(false)} />
      )}
    </main>
  );
}
