# 全分支终审报告 — 块级就地编辑（`848899c` → `05505eb`，14 个提交）

- 方式：只读。**未修改任何文件**（`write` 仅写本报告）；未派发子智能体。
- 读法：先读 `rulings.md` / `progress.md` / spec / 验收报告，再分轮读源码（`editUnits.ts` → `rehypeEditUnits.ts` → `MarkdownDocument.tsx` → `BlockEditor.tsx` / `editorGeometry.ts` → `useDocumentEditor.ts` → `App.tsx` / `TopBar.tsx` → Rust `document.rs` / `main.rs` / `watcher.rs`），最后读全部新增/改动测试；diff 5298 行（含文档）按文件读完，未跳读。
- 独立证据：除跑测试/build/lint 外，我用 Node 24 的类型剥离**直接调用交付的纯函数**（`node -e "import('file:///…/src/lib/editUnits.ts')"`）做探针，并用 `unified+remark-rehype+rehype-raw` + jsdom/React 复刻了管线与事件时序（见文末命令表）。凡结论都给出我亲自跑出的输出或代码位置。

---

## 总体结论

**需先修复再合并**（不改规格，改动量小：一条集合常量 + 一个提交重入闸门 + 一个会话复位）。

依据：整条链路（区间 → 标记 → caret → 就地编辑 → 提交 → 原子落盘）**确实闭合**，测试与文档数字**可复现且诚实**，`npm test` 400/31、`cargo test` 63、`tsc` 与 `build` 均绿，入口 chunk 与验收报告逐字节一致。但存在 **2 条 Critical**：

1. **「HTML / 交互块结构性只读」并不是结构性事实** —— `footnoteDefinition` 不在 `editUnits` 的锁定下钻白名单里，脚注定义内的**块级 HTML 与 `vellum-widget` 围栏可被点击进入编辑并改写源码**（规格 D4 的「无编辑入口、零绕过路径」不成立，验收报告 §1 的「含嵌套在引用/列表内的情形」也不成立）。
2. **`Ctrl+S` 在编辑框内会触发两次 `commitActive`** —— 草稿一旦改变块结构（补一个空行拆段、加标题、加列表项），第二次提交会把草稿**再拼一遍**（实测产出 `…新段。\n\n新段。…`）并**再落盘一次**，两次 `save_document` 与两次整篇重渲染并发；磁盘最终内容可能是被重复的版本。

另有 3 条 Important（落盘失败后切换文档会把上一份文档的草稿写进新文档；进/出编辑视图会重建全部 widget iframe；spec D5 的自适应软提示只到状态层）。

---

## 需求符合性（逐条对 spec 的关键承诺）

| # | 承诺（spec / 裁定） | 判定 | 证据 |
|---|---|---|---|
| 1 | D1 视图门禁：默认阅读视图，`Ctrl+E`/顶栏进编辑视图 | ✅ 例外见 #20 | `src/App.tsx:155-158`（Ctrl+E）、`:851-857`（TopBar props）、`:926`（`editable`）；`src/hooks/useDocumentEditor.ts:183-198` |
| 2 | D2 单元粒度：顶层 + `listItem` + `blockquote` 一层下钻 | ✅ | `src/lib/editUnits.ts:105-118`；`src/lib/editUnits.test.ts`（list/quote 下钻用例） |
| 3 | D3 编辑期间不实时重渲染（键盘输入不进解析管线） | ✅ | 打字只走 `editor.updateDraft`（`src/App.tsx:948`）→ App 重渲染；`MarkdownDocument` 为 `memo`，新 props `editable`(bool)/`units`(memo)/三个 `useCallback([])` 回调全稳定（`src/App.tsx:519-536`），`MarkdownBody` 整段跳过 |
| 4 | D4 块级 HTML / widget / mdlog 头注释**无编辑入口、零绕过路径** | ❌ **Critical-1** | 脚注定义内两条绕过，可复现（见 Issues C1） |
| 5 | D5 提交即落盘（自动保存） | ✅ | `src/hooks/useDocumentEditor.ts:148-170`；`src/App.tsx:502-507`；Rust `main.rs:201-233` + `document.rs:174-236` |
| 6 | D5 `Ctrl+S` == 提交当前块 | ❌ **Critical-2** | `src/App.tsx:149-153` + `src/components/BlockEditor.tsx:176-183`（双路径，见 Issues C2） |
| 7 | D5 自适应软提示（实测提交耗时 > 800ms 挂出） | ⚠️ Important-3 | 只有状态层：`src/hooks/useDocumentEditor.ts:44/152/217`；`grep -rn heavyDoc src --include=*.tsx` 零消费点 |
| 8 | D6 mdlog 记录中一律禁编（三重门禁） | ✅ | 入口 `:94-96`、提交口 `:131-134`、顶栏 `TopBar.tsx:86`、Rust `main.rs:210-233`；App 侧边沿中断 `App.tsx:753-767` |
| 9 | D8 数学块外层包裹（`display: contents`）承载标记 | ✅ | `src/lib/rehypeEditUnits.ts:33-45`、`src/styles/kami.css:1274`；`MarkdownDocument.test.tsx`（katex 替换后包裹层存活） |
| 10 | §5.1 区间不变量（排序/不重叠/⊆[0,len)） | ✅ | 语料 24 例 + 300 次确定性 fuzz（`editUnits.test.ts:52-108`）；我用真实输入复跑 `"- a\n\n  ```\n  x\n  ```- b\n- c\n"` → `[0,26)` 单块，与测试一致 |
| 11 | §5.3 标记与单元索引单一真相源 | ✅（⚠️ Minor-9） | `rehypeEditUnits.ts:29` 复用 `findUnitForRange`（裁定 F1 落地）；同一 markdown 在 App 侧与 lazy 侧各算一次（两份数组实例，靠确定性保持一致） |
| 12 | §6.1 覆盖层渲染在 `.markdown-body` 内 | ❌→按裁定 F23 改为与正文并列 | 裁定优先；spec §14.5 已登记。`src/App.tsx:937-952`、`kami.css:1248` |
| 13 | §6.2 提交不递增 `reloadTick`、不闪印章、不做滚动补偿 | ✅ | `applyMarkdown` 只改 markdown（`App.tsx:495-501`）；滚动仲裁 effect 的 `pendingScrollRef/pendingAnchorRef/shouldStickToBottomRef` 只由 `reloadCurrent` 填充（`App.tsx:287-335`）→ 提交路径全部落空 |
| 14 | §6.2 提交后清理原块内联样式 | ✅ | `src/components/BlockEditor.tsx:117-123`（逐项还原原值）+ 用例「目标原本带内联 height 时还原成原值」 |
| 15 | §6.3 提交触发面（切块/切文档/关窗/Ctrl+E/搜索/大纲） | ✅（⚠️ Minor-6） | 切块=`onBlur`、切文档=`App.tsx:219`、关窗=`App.tsx:394-401`、Ctrl+E=`toggleView`→`commitActive`；**搜索/大纲跳转没有显式提交调用**，靠 `onBlur`（`BlockEditor.tsx:184`）在同一次点击里先提交——真机成立（blur 先于 click），但不是显式契约 |
| 16 | §6.4 取消路径（mdlog 变活跃 / 外部变更） | ✅ | `notifyInterrupted`（`useDocumentEditor.ts:107-116`）+ 裁定 F32 只在确有会话时提示 |
| 17 | §7.1 `save_document`：路径/扩展名/50MB/mdlog 四道闸门 + 原子写 + EOL/BOM 保真 | ✅（⚠️ Minor-12 文档漂移） | `main.rs:201-233`、`document.rs:163-236`；13 条 `save_tests` 断言含 CRLF/LF/BOM/超限/不可读/临时残留/临时名唯一 |
| 18 | §7.2 回声抑制（磁盘 vs 内存，LF 归一） | ✅ | `App.tsx:443-471`；4 条 App 用例（含「外部改成 E 再改回 W」与「mdlog 常态追加不刷提示」） |
| 19 | §7.3 保存失败：草稿留在框里 + 内存回退 + 可重试 | ✅（⚠️ Important-2） | `useDocumentEditor.ts:159-169`；3 条 hook 用例（结构变化重试不重复、同内容重试仍落盘） |
| 20 | §4 TopBar 禁用态：**无文档** / mdlog 记录中 | ❌ 未登记偏差（Minor-1） | `TopBar.tsx:86` `disabled={!canEdit}`；`App.tsx:855` `canEdit={!isMdlogActive}` → 空态/错误态下按钮可点（点了无反应，无提示） |
| 21 | §8 与既有机制共存（滚动/搜索/大纲/跳底/侧栏/widget LRU） | ✅（⚠️ Important-2b） | 未新建内层滚动、未改既有容器；`AGENTS.md` 结构约束逐条对照通过（见下） |
| 22 | §9 样式与设计语言（色板/圆角/字重/无 emoji；区段位置） | ✅ | 新 CSS 全走 `var(--brand)/var(--near-black)/var(--tag-bg)`；无 emoji（`git diff | perl` 扫描仅命中验收报告表格里的 ✅，`src/` 零命中）；`designmd lint` → `errors 0, warnings 4（全为既有 orphaned color）, infos 1`；区段 `kami.css:1236-1312` 在首个 `.mdlog-widget`（1375）之前且不含该字样 |
| 23 | §10 硬线：`npm test`/`cargo test`/`build` 全绿 + 入口 chunk 不显著增长 | ✅ | 实测 31/400、63、build 成功、入口 `158,080 B`（与验收报告 §3 一致）、`MarkdownDocument-*.js 262.93 kB` |
| 24 | §10 真机复核 | ⏳ 未执行且**明确标注未执行**（裁定 F35） | 验收报告 §7「均未执行」+ §10 未解决项 1 |

### AGENTS.md 性能结构约束逐条核对

| 约束 | 判定 | 证据 |
|---|---|---|
| 编辑面沿用 `.document-scroll`，不新建内层滚动 | ✅ | `App.tsx:937-952` 覆盖层是既有宿主容器的绝对定位子元素；`grep -n "overflow" kami.css:1248-1312` 只有覆盖层自身 `overflow: hidden` |
| 提交不递增 `reloadTick`、不播印章、不滚动补偿 | ✅ | 见 #13 |
| 回声由「磁盘 vs 内存（LF 归一）」抑制 | ✅ | `App.tsx:457-459` |
| `.vellum-unit-wrap` 必须 `display: contents`，操作走 `resolveTarget` | ✅ | `kami.css:1274` 规则体内**仅此一条**声明；`BlockEditor.tsx:24-40` `resolveTarget` 走 class 首选 + 高 0 兜底（裁定 F20/F27） |
| 覆盖层选择器 `.document-scroll__content--editing > .block-editor__input` 且不是 `.markdown-body` 后代 | ✅（⚠️ Minor-4：DOM 层守卫不完整） | `kami.css:1248`；`App.test.tsx:1780` 断言父元素是 `.document-scroll__content` |
| mdlog 门禁不得只留入口一处 | ✅ | 见 #8 |
| `CodeBlock` 用 `PrismLight`（死规则） | ✅ 未触碰 | `git diff --stat` 不含 `CodeBlock.tsx`（该约束与 katex 版本同理，未受影响） |
| `MarkdownBody` props 引用稳定 / `components` 是 `useMemo` | ✅ | 见 #3；`MarkdownDocument.tsx:364-511` `components` deps `[resolveHeadingId, isTrustedMdlog]` 未变 |
| `components` 引用稳定性由接线级回归测试保证 | ✅ | 既有 `MarkdownDocument.test.tsx` iframe 接线用例全绿（`npm test`） |
| 入口 chunk 增量记录与 F11 退路 | ✅ | `AGENTS.md` 已写入 +14.32 kB 与退路 |

---

## 跨模块风险

### R0（总评）四环契约的一致性

- **索引语义**：`buildEditUnits` 的 `index` 在 App 侧（`useDocumentEditor.ts:49`）与 lazy 侧（`MarkdownDocument.tsx:613`）由**同一个函数**在两个相同输入上产生 → 逐项一致（我实测同一 markdown 两次调用结果 `JSON.stringify` 相等）。风险仅在于「同值不同实例」，不构成缺陷。
- **LF 归一责任链**：① `buildEditUnits` 按**原始**偏移切区间（含 `\r`）；② `MarkdownDocument.handleClick` 用**归一后**切片算 caret（`:644`）；③ `useDocumentEditor` 用**归一后**切片做草稿与原文比对（`:29-31/135`）；④ Rust `apply_eol` 用 `dominant_eol` 还原（`document.rs:150-166`）。四环语义自洽，我用 CRLF 文档在 ②③ 两侧独立复算（块 `alpha\r\nbeta\r\ngamma` 点块中/块尾 → caret 6/11，与 `MarkdownDocument.test.tsx` 的期望一致；hook 侧 `draft` 无 `\r` 且原样提交为 no-op）。**该环通过。**
- **目标元素解析**：两处独立启发式 —— `BlockEditor.resolveTarget`（class 首选 + 「高 0 且子节点有盒」兜底，`BlockEditor.tsx:24-40`）与 `MarkdownDocument.handleClick` 的测量回退（仅看高度 0，`:637-639`）。对零高真实块（只含未加载 `<img>` 的段落）两者**结论不同**（前者作用在自身、后者量到行内子元素），当前无害（比率都是 0），但属可漂移的重复实现（Minor-5）。

### R1 结构性只读存在脚注绕过（Critical-1，详见 Issues）

### R2 `Ctrl+S` 双提交导致重复写入（Critical-2，详见 Issues）

### R3 落盘失败 + 切换文档 ⇒ 草稿跨文档污染（Important-2，详见 Issues）

### R4 进出编辑视图重建全部 widget iframe（Important-2b，详见 Issues）

### R5 提交路径与热重载/回声抑制的交叉

- 提交后 watcher 回声（`App.tsx:457-459`）与「内存先行、落盘失败回退」不变量自洽，我用「结构变化草稿」复算过 `next` 与磁盘内容逐字符相同 → 回声抑制不会误吞本次提交；反向（外部改成 E 再改回 W）有专门用例且断言可区分（旧快照实现必红）。该环通过。
- 残余（已登记，建议级）：`commitActive` 在 `await save` 期间内存领先磁盘，此时到达的 `file-changed` 会把内存回退为旧内容（F30 明示接受）。

---

## 测试与文档诚实度

**可复现性核对（我实跑）**：验收报告 §2/§3 的每一个数字都对得上 —— `npm test` 31 文件 / 400 用例（报告写 400）✓；`tsc --noEmit` exit 0 ✓；`npm run build` 成功、入口 chunk 恰为 `158,080 B`/`45.05 kB gzip`、`MarkdownDocument-*.js 262.93 kB`、`index-*.css 23.30 kB` ✓；`cargo test` 56(lib)+7(main)=63 ✓；`cargo test` 无新增 warning ✓；`designmd lint` errors 0 ✓。**没有为了变绿而放水的痕迹。**

**做得好的**：

- **F34（恒真用例）用变异注入证明判别力恢复**（报告 §4 给了 A/B 两条变异 + 期望值），我读测试确认新用例的判据非平凡：它经过「同路径重开 → `reloadCurrent` → `reloadTick`」真实路径并断言 `scrollTop 380→1000` 与 `restoreSpy({ratio:1})`，若布局 effect 不跑则停在 380。同一处新增的「无变更为 no-op」用例还断言 `load_document` 被调用 **2 次**，避免「处理器没跑」的假绿。
- **关窗测试替身按真机语义回放 `closeRequested`**（`App.test.tsx:36-118`，含 `replay/settle/recursion`），并附「失败 ⇒ 不关窗、不递归」用例 —— 这是我在本分支里见到的最高质量的一处测试设计（它正是让 C1 类缺陷无法逃逸的机制）。
- **既有恒真断言被主动修正**：`App.test.tsx:1758` 把「记录中点击不激活」的恒真断言改成「块标记未挂载」；`1879-1926` 给「外部改为回声」用例补上真实编辑会话前提。
- **诚实登记**：验收报告 §7「14 项真机手检均未执行」、§8 九条已知限制、spec §14 六条实施期修订，口径与代码事实一致（我逐条抽查：§14.2 未给 schema 追加 `data*` 属实、§14.4 无 `lastSavedMarkdownRef` 残留、§14.6 的 2.4s 属实）。
- **无跳过/无空断言**：`grep -rn "it.skip|it.only|describe.skip|.todo("` 在 `src/` 零命中；新增断言抽查无 `expect(true)`/无「只测 mock 行为而不测被测对象」的用例。

**薄弱处（覆盖真空，非放水）**：

1. **没有任何用例把「编辑框内 `Ctrl+S`」与真实 `commitActive` 接线在一起**（`BlockEditor.test.tsx` 的 Ctrl+S 用 mock `onCommit`；`App.test.tsx:1852-1875` 的 Ctrl+S 打在 **window** 上）→ Critical-2 因此逃逸。
2. **没有任何用例覆盖「落盘失败后再切换文档」** → Important-2 逃逸。
3. **结构性只读用例只覆盖顶层 / 引用 / 列表三种容器**（`editUnits.test.ts` 的三条嵌套用例）→ 脚注逃逸（Critical-1）。这类「安全不变量」建议加一条**遍历式断言**（对语料里每个 `html`/`widget` mdast 节点，断言所有包含它的单元都 `editable === false`），而不是逐容器补例子；本报告 C1 的探针脚本就是这种断言的最小实现。
4. 无 iframe 身份跨越「阅读 ⇄ 编辑」切换的用例（只有热重载场景）→ Important-2b 逃逸。
5. 无 `document-scroll__content--editing > .block-editor__input` 位置断言（`App.test.tsx:1780` 只断言父类是 `.document-scroll__content`，未与 `--editing` 绑定）→ Minor-4。
6. 报告可信度的历史瑕疵（T7 报告称 `kami.css` 为 CRLF 1534 行，实测 CR 计数为 0）已由 T7 审查者当场点出，且未流入验收报告 —— 记录在案，不计入本分支问题。

---

## 遗留项分诊

| 项（出处） | 内容 | 结论 | 理由 |
|---|---|---|---|
| F17（rulings） | 畸形围栏下保留单元的 `end` 伸进被丢弃项 | **下一版** | 仅畸形输入（关闭围栏行带尾随文字）；124 真实文档 + 2951 fuzz 下 `dropped=0`；已登记。**建议**顺手加一层廉价护栏：归一化时给「`end` 跨过被丢弃项起点」的单元打标记并**拒绝激活**（拒绝入口比污染字节便宜），不必重排区间 |
| F26（rulings） | `heavyDoc` 会话内粘性 | **下一版**（保持现状） | 有意为之且只影响文案 |
| heavyDoc 无 UI（验收报告 §8-2） | spec D5 的软提示未可见 | **下一版**（但必须补登记） | 用户可见承诺未落地；目前只在验收报告 §8 登记，**spec §14 未登记**。落地需要一次小接线 + 真机校准阈值（手检 #9） |
| T7 Important-①（F36） | `>` 位置无 DOM 层守卫 | **下一版**（顺手，1 行） | 我在 `App.test.tsx:1780` 找到 `expect(textarea.parentElement).toHaveClass("document-scroll__content")`：T7 审查者所报「无任何位置断言」**不准确**，把 BlockEditor 挪进 `.document-content` 该用例会红。缺的只是「父元素带 `--editing`」这一条显式绑定 |
| T7 Important-②（F36） | 非段落块度量差异未登记 | **下一版**（必须登记 + 手检） | 事实成立但不构成缺陷：标题/引用/代码块的**字号**与渲染态不同（14px mono vs 30/21/17/12px），**高度下限由 `Math.max(scrollHeight, lockedHeight)` 兜住**（`BlockEditor.tsx:69-71`），故审查者「首个按键后高度跳变、下方抽动」的推论**不成立**；真实影响是「编辑态字形比原块小」+ 单子块引用容器（目标=blockquote）会多出 5px 左缩进差（`kami.css:966-970`）。写进手检 #2/#11 即可 |
| T3 残项 a | `textarea.focus()` 在 `useEffect` 而非 layout effect（`BlockEditor.tsx:143-150`） | **下一版** | 影响仅一帧；无数据风险 |
| T3 残项 b | 降级分支（宿主缺失 / 热重载后标记丢失）**无任何提示**，点块静默无反应 | **下一版** | UX 缺口；`BlockEditor.tsx:76-95` 只 `dropOverlay()`。建议复用 `notifyInterrupted`/`toast` 给一句「当前块无法进入编辑」 |
| T3 残项 c | 提交一次性闸门复位依赖「先 close 再 await」的隐式前提 | **合并前一并处理** | 与 Critical-2 同源：闸门只在组件侧、且只在 `unitIndex` 变化时复位；修 C2 时顺手把闸门下沉到 hook（见 C2 建议） |
| T6 重审 U3（=F34） | 既有 `reloadTick` 用例退化 | **已修** ✅ | T8 拆成两条具判别力用例（报告 §4 变异证据），我读测试确认非平凡 |
| T6 重审 建议 2 | F30 在途窗口（内存领先磁盘） | **下一版**（已由 F30 接受） | 损失窗口为单次 IPC 往返；加一条手检即可 |
| T6 重审 建议 3 | 关窗处理器异常分支（`commitActive` 抛出 ⇒ 窗口既不关也不拦） | **下一版** | 可达性极低；建议 `try/catch { event.preventDefault() }` 防御。`App.tsx:394-401` |
| T6 重审 建议 4 | `selfCloseCalls()` 统计所有窗口实例（命名/语义） | **下一版**（测试卫生） | 当前两条用例不经 ✕ 按钮，断言成立；后续易假阳性 |
| T6 重审 建议 5 | toast 2.4s 真实计时器与 `waitFor` 的潜在 flake | **下一版**（测试卫生） | 极慢环境下假红 |
| T1 残项 | 单子块引用容器被打上同索引标记 | **下一版** | 不影响点击/锁定语义（`closest` 取到外层 blockquote，正是该单元自身）；已在 progress 登记 |
| T2 残项 a | `handleClick` 的测量回退未限定 `.vellum-unit-wrap` | **下一版** | 与 `resolveTarget` 语义不完全一致（见 R0） |
| T2 残项 b | 最内层标记元素当测量盒的固有精度 | **下一版** | 行级光标本就是近似（spec §11 已登记） |
| T4 残项 N1/N2 | 失败回退缺版本校验的并发窗口 / 失败路径双整篇重解析 | **下一版** | 均为条件性并发/性能项；N2 与 Critical-2 的「双提交 ⇒ 双整篇重渲染」叠加后更明显，修 C2 后自然缓解 |
| T5 观察 1 | spec §7.1:164 仍写固定临时名 `.<name>.vellum-tmp` | **下一版**（顺手改一行文档） | F29 已改为 uuid 后缀；代码/文档漂移，验收报告 §5 同步表漏了这条 |

---

## Issues

### Critical (Must Fix)

#### C1 · 脚注定义内的块级 HTML / `vellum-widget` 可被编辑（结构性只读被绕过）

- 依据：`src/lib/editUnits.ts:56` 的 `BLOCK_CONTAINERS = new Set(["list", "listItem", "blockquote"])` **不含 `footnoteDefinition`**；`:67-76` 的 `lockedKindOf` 只在这些容器内下钻；`:105-118` 的顶层节点走 `kindOf(node)`（**不看子树**）→ `footnoteDefinition` 落成 `kind: "other"`、`editable: true`。
- 复现（纯函数，我实跑）：

  ```
  输入 A: "text[^1]\n\n[^1]:\n    <div class=\"payload\">raw</div>\n"
    → unit 1 = kind "other", editable=true, src='[^1]:\n    <div class="payload">raw</div>'
  输入 B: "text[^1]\n\n[^1]:\n    ```vellum-widget\n    <b>x</b>\n    ```\n"
    → unit 1 = kind "other", editable=true, src 含完整 widget 围栏
  输入 C: "text[^1]\n\n[^1]:\n    > <div class=\"x\">raw</div>\n"（引用包着 HTML）
    → unit 1 = kind "other", editable=true
  ```

- 渲染层可达性（我用真实 `unified + remark-gfm + remark-rehype + rehype-raw` 复刻管线并打印 hast 位置）：

  ```
  section.footnotes > ol > li [10,80] unit=1(other,EDITABLE)
                            div [20,50] unit=1(other,EDITABLE)      ← 输入 A
                            pre/code [20,57] unit=1(other,EDITABLE) ← 输入 B
  同一 markdown 下 unit=1 由 buildEditUnits 判定 editable=true
  ```

  点击 → `MarkdownDocument.tsx:628-631`（`closest("[data-vellum-unit]")` 命中该 `div`/`li`）→ `unit.editable === true` → `onActivateUnit(1, caret)` → `useDocumentEditor.ts:91-104` 用该单元区间做草稿 → 编辑框里就是**原始 HTML / widget 围栏源码**，改完 `Esc` 即 `spliceUnit` + `save_document` 落盘。
- 真机步骤（1–4 步即可看到编辑框）：① 打开含以下内容的 md：`正文[^1]` + 空行 + `[^1]:` + 缩进 4 空格的 `<div class="payload">raw</div>`；② `Ctrl+E`；③ 滚到文末脚注区点击那个 `div` 的文字；④ 编辑框弹出且内容为 `[^1]:\n    <div class="payload">raw</div>`；⑤ 改一个字 + `Esc` → 磁盘上的原始 HTML 被改写。
- 影响面：违背用户三条诉求中最硬的一条（「保持 HTML 不会改变、不能被修改」）与 spec D4「无编辑入口、零绕过路径」；验收报告 §1 的「含嵌套在引用/列表内的情形」也因此不成立。**注意**：行内 HTML（段落/表格单元内）仍属可编辑文本，是 D4 有意为之，不算此问题。
- 修法（二选一，都很小）：
  - **最小**：`BLOCK_CONTAINERS` 加入 `"footnoteDefinition"` → 该脚注整体变只读（含 widget 时整块不可编辑，粒度偏粗但安全）。
  - **更好**：把 `footnoteDefinition` 视作可下钻容器（与 `blockquote` 同列，在 `collectUnits:109-115` 里加一个分支）→ 脚注正文仍可逐块编辑，而 HTML/widget 子块各自锁死。
  - 无论哪种，请补**遍历式**回归断言（见「测试诚实度」第 3 条），而不是只补三条例子。

#### C2 · 编辑框内 `Ctrl+S` 触发两次 `commitActive`；结构变化草稿会重复写入并二次落盘

- 机制（每一环都有代码位置）：
  1. 焦点在编辑框时按 `Ctrl+S`：`BlockEditor.tsx:176-183` 的 `onKeyDown` → `event.preventDefault(); requestCommit()`（**只 preventDefault，不 stopPropagation**；组件侧一次性闸门 `committedRef`（`:153-158`）只拦这一条路径）；事件继续冒泡到 `window`（`:170` 的 `handleGlobalShortcut` 挂在 window）。
  2. `App.tsx:149-153` 的全局分支**无条件**再调一次 `editorRef.current?.commitActive()`，没有任何去重（未看 `event.defaultPrevented`，也没有 in-flight 闸门）。
  3. 第一次调用在 `useDocumentEditor.ts:148` 执行 `flushSync(() => onMarkdownChange(next))` —— 同步提交 App 渲染 → `App.tsx:518` `editorRef.current = editor` 换成**新闭包**；而 `:154` 的 `closeActive()` 是**普通 setState，尚未 flush**。
  4. 我用 jsdom + 本仓库真实 React 19.2.7 复刻了这段时序（含 `flushSync`）：window 监听器看到的正是「**新 markdown + 旧 activeIndex**」——`commit#2 sees markdown=M1+next1 active=1`，且 window 监听器确实被调用（`commitCalls= 2`）。
  5. 于是第二次调用用「**新 markdown** 的同索引单元」当原文与草稿比对（`:135-137`）。若草稿只替换单段文本，二者相等 → 短路 → 无害；**若草稿改变了块结构**，新索引单元只是草稿的第一块 → 不等 → 继续执行：`next2 = spliceUnit(markdown2, unit2, draft)` **把草稿再拼一遍**，再 `flushSync` + `save(next2)`。
  6. 我用真实纯函数复算（`M = "# 标题\n\n第一段。\n\n第二段。\n"`，激活 unit 1，草稿 `"改过的第一段。\n\n新段。"`）：
     `M2 = "# 标题\n\n改过的第一段。\n\n新段。\n\n第二段。\n"` → `v2.activeUnit.slice = "改过的第一段。"` ≠ 草稿 →
     `M3 = "# 标题\n\n改过的第一段。\n\n新段。\n\n新段。\n\n第二段。\n"`（**`新段。` 出现两次**）。
- 真机步骤：① 打开任意 md，`Ctrl+E`，点击一个段落（焦点自动落在编辑框）；② 在草稿里加一个空行再写一句话（或加 `- ` 列表项 / `# ` 标题）；③ 直接按 `Ctrl+S`（焦点仍在编辑框）；④ 该块内容出现重复段落，`save_document` 被调用两次（DevTools/日志可见两次），磁盘最终内容取决于两次 `rename` 的先后（两次写入**没有互斥**，只有临时名唯一），存在落成重复内容的分支。
- 为什么必须合并前修：`Ctrl+S` 是 spec D5 明写的提交快捷键，且焦点默认就在编辑框（`BlockEditor.tsx:143-150` 自动 focus），触发成本是一次按键 + 一个很自然的草稿（本仓自己的用例就用 `"改过的第一段。\n\n新段。"` 这类结构变化草稿）；后果是**静默的文档内容污染**。
- 修法（任一即可，建议都做）：
  - **A（1 行）**：`App.tsx:143` 的处理器开头加 `if (event.defaultPrevented) return;` —— 编辑框的 `onKeyDown` 已经 `preventDefault()`，`defaultPrevented` 在同一次派发的后续监听器里保持为真。
  - **B（更稳）**：把 F22 的一次性闸门下沉到 `useDocumentEditor`（`committingRef`），使 `commitActive` 在「同一会话已有提交在途」时直接返回 `true`（不重复落盘，也不让关窗被误拦）。当前 hook 内**没有任何 ref 级重入保护**（`grep -n useRef src/hooks/useDocumentEditor.ts` 只有 toast 两个 ref）。
  - **必带回归用例**：把 `Ctrl+S` 打在**编辑框**上（而非 window，`App.test.tsx:1852-1875` 现在打的是 window）、草稿用结构变化文本、断言 `save_document` **恰好一次**且载荷不含重复段落。这条用例在现状下必然红。

### Important (Should Fix)

#### I1 · 落盘失败后切换文档 ⇒ 上一份文档的草稿被写进新文档

- 链路：`App.tsx:219` `await editorRef.current?.commitActive()` 后**无论返回值都继续加载新文档**；失败时 hook 的 F24 分支（`useDocumentEditor.ts:159-169`）会 `setActiveUnitIndex(unitIndex) + setDraft(draft) + setInitialCaret(caret)` 把**会话留在原地**；`useDocumentEditor` 的会话状态（`activeUnitIndex/draft`）**没有任何「文档切换即复位」的逻辑**（全文无 reset；hook 只按 markdown 重算 `units`）。于是新文档加载后：`activeUnit = 新文档 units[i]`（若存在）、`draft = 旧文档草稿`、`App.tsx:941-951` 的条件 `viewMode === "editing" && activeUnit` 仍成立 → 编辑框在新文档的同序号块上挂出、内容却是上一篇的文字；此时任何提交触发（`Esc`/`Ctrl+S`/失焦/再切文档/关窗）都会 `spliceUnit(B, unit_i, draftA)` 并 `save_document(path=B)` —— **把 A 的文字写进 B 文件**。
- 触发前提：A 的一次落盘失败（只读/被删/被占用/磁盘满/>50MB/`Cannot read existing document`）。真机步骤：① 打开 A.md，`Ctrl+E` 改一段；② 把 A.md 设为只读（或删除 A.md）；③ 顶栏「打开文件」选 B.md（B 至少要有与 A 相同索引的块）；④ 观察 B 的该块被隐藏、编辑框里是 A 的草稿；⑤ `Esc` → B 被写入 A 的段落。
- 修法：给 hook 加 `resetSession()`（清 `activeUnitIndex/draft/caret` 的既有 `closeActive` 即可），在 `loadPath` 判定要**切换文档**（`!isSamePath(path, currentPathRef.current)`）时、`setState(loading)` 之前调用；或让会话携带「所属路径」并在 markdown 因换文档而变时自动失效。

#### I2 · 进/出编辑视图会重建**全部** widget iframe 与代码块

- 机制：`.vellum-unit-wrap` 只在 `editable` 为真时由插件插入（`rehypeEditUnits.ts:33-45` + `MarkdownDocument.tsx:351-357`），即 React 树在切换视图时**改变了元素层级**（`<WidgetSandbox/>` → `<div class="vellum-unit-wrap"><WidgetSandbox/></div>`）。React 遇到父元素类型变化必然 unmount/mount。我用 jsdom 复刻验证：`Widget mount #1` → 切换 → `Widget unmount #1` + `Widget mount #2`。
- 影响：每次 `Ctrl+E` 进出编辑视图，全篇 widget 的 iframe 都会销毁重建（对 mdlog 日志/远程 HTML 是重新加载 + `--ready` 淡入闪烁），与项目既有的「热重载不得重建 iframe」不变量（`AGENTS.md`、`MarkdownDocument.test.tsx` 接线用例）形成明显落差，且**任何文档都没登记这条代价**（spec §8 表格只说「编辑期间保持挂载」，验收报告 §8-3 只说提交重渲染时改动块上方可能重建）。
- 修法（下一版）：`components.pre` 把 `data-vellum-unit`/`data-vellum-locked` 像 `h1/h2/h3` 那样显式交还给 DOM（`MarkdownDocument.tsx:370-386` 已有同款写法），只对**数学块**保留包裹层（katex 会替换掉 `pre` 的属性，这一条 `pre` 的包裹确实必要）→ 视图切换不再改变树的形状，iframe 不重建。
- 附带建议：补一条「切换编辑视图前后 iframe 节点 `===` 同一节点」的接线用例。

#### I3 · spec D5 的「自适应软提示」只到状态层（用户不可见）

- `useDocumentEditor.ts:44/152/217` 计算并导出 `heavyDoc`，但 `grep -rn "heavyDoc" src --include=*.tsx` **零消费点**（App/任何组件都不读），因此 >800ms 提交不会挂出任何提示。
- 已登记于验收报告 §8-2「目前无 UI 消费点」，但 **spec §14 未登记**这条落地偏差；spec D5 的正文口径仍写着「实测提交耗时 > 800ms 时挂出」。
- 建议：合并前至少把这条写进 spec §14（一条小改动即可），并保留「待真机校准阈值」（手检 #9）；实现本身可留下一版。

### Minor (Nice to Have)

1. **spec §4「禁用态：无文档」未实现**：`App.tsx:855 canEdit={!isMdlogActive}` + `TopBar.tsx:86 disabled={!canEdit}` → 空态/错误态下编辑按钮可点、点了无反应也无提示（`useDocumentEditor.ts:195-197` 静默 return）。属**未登记偏差**（验收报告 §9 未列）。修法：`canEdit={!isMdlogActive && state.status === "ready"}`。
2. **覆盖层内容相对被编辑块右移 4px**：`kami.css:1251-1254`（`padding: 0 2px` + `border-left: 2px`）+ 全局 `box-sizing: border-box`（`kami.css:49`）→ 宽度不溢出，但文字左缘比渲染态右移 4px；单子块引用容器作目标时另加 5px（`kami.css:966-970`）。真机手检 #2/#11 可判。
3. **F17 畸形围栏的 `end` 越界**（已登记不修）：`spliceUnit(md, units[0], "NEW")` 会把下一个列表项的 `- ` 吞掉（我复算过输入 `"- a\n\n  ```\n  x\n  ```- b\n- c\n"` → 单块 `[0,26)`，`end` 跨过 `- c` 的 `- `）。建议下一版加「跨过被丢弃项 ⇒ 拒绝激活」的护栏。
4. **F23 的 `>` 位置守卫不完整**：`App.test.tsx:1780` 断言父类是 `.document-scroll__content`，但未与同一元素上的 `--editing` 绑定（两者恰好是同一元素）。建议改成 `expect(document.querySelector(".document-scroll__content--editing > textarea.block-editor__input")).not.toBeNull()`。
5. **两处独立的「包裹层/零高」启发式**：`BlockEditor.tsx:24-40` 与 `MarkdownDocument.tsx:637-639`（后者未限定 `.vellum-unit-wrap`）。建议抽一个共享 helper，避免后续漂移。
6. **搜索/大纲跳转前的提交是 blur 的副产物**（`BlockEditor.tsx:184`），非显式契约；若编辑会话存在但焦点不在编辑框（例如重激活后用户已移焦的边沿），跳转不会提交、块保持隐藏而覆盖层停在旧位置。建议在 `handleSelectHeading` / 搜索跳转入口显式 `void editorRef.current?.commitActive()`（一行）。
7. **`heavyDoc` 粘性**（F26）保持 ✓；仅提示“文案不回退”是有意为之。
8. **T3 降级分支无提示**（`BlockEditor.tsx:76-95`）：点块后什么都没发生（无 toast、无控制台信息），真机若真出现「标记丢失」用户会困惑。
9. **同一 markdown 计算两遍单元**：`useDocumentEditor.ts:49` 与 `MarkdownDocument.tsx:613`（各一份 `EditUnit[]` 实例）。功能正确（同函数确定性一致），但编辑视图每次提交多付一次 `buildEditUnits`（对 1MB 散文是毫秒级、可接受）；若后续按 F11 退路把单元计算移回 lazy 侧，这条自然消失。
10. **LF 归一三处重复**：`useDocumentEditor.ts:29-31`、`MarkdownDocument.tsx:644`、`App.tsx:458` 各自 `.replace(/\r\n/g, "\n")`。F9b 要求「草稿与光标必须同一份归一文本」，目前靠约定而非共享函数保证；建议抽 `normalizeEol()`。
11. **关窗处理器异常分支**（`App.tsx:394-401`）：`commitActive()` 抛出 ⇒ 包装层跳过 destroy ⇒ 窗口不关也不拦（安全方向但用户无法退出），建议 `try/catch { event.preventDefault() }`。
12. **文档漂移**：spec §7.1:164 仍写固定临时名 `.<name>.vellum-tmp`（实现为 `.{name}.{uuid8}.vellum-tmp`，`document.rs:180-190`）；`plans/*.md:1336` 同。验收报告 §5 同步表未覆盖这条。
13. **测试卫生**：`selfCloseCalls()` 统计所有窗口实例（`App.test.tsx:1698-1704`，将来易假阳性）；两处依赖真实 2.4s 计时器的 toast 断言在极慢环境下可能假红。
14. **`MarkdownBody` 的 `units` 在阅读视图是 `[]`（新数组每次 markdown 变化）**：`useMemo` 已 memo ✓，仅为记录核对（无缺陷）。

---

## 我实际跑过的命令与输出摘要

| 命令 | 真实输出 |
|---|---|
| `npm test` | `Test Files 31 passed (31)` / `Tests 400 passed (400)` / `Duration 7.95s` |
| `cd src-tauri && cargo test` | `56 passed; 0 failed`（lib）+ `7 passed; 0 failed`（main）+ `0 passed`（doc-tests）；`grep -i warning` **零命中** |
| `npx tsc --noEmit` | 无输出，`exit=0` |
| `npm run build` | `✓ built in 2.19s`；`dist/assets/index-Coyz_cau.js 158.08 kB`（`ls -l` = **158,080 B**）、`MarkdownDocument-CWsRmz5x.js 262.93 kB`、`index-ieLhwIgY.css 23.30 kB` —— 与验收报告 §3 逐项一致 |
| `npx -p @google/design.md designmd lint DESIGN.md` | `"errors": 0, "warnings": 4, "infos": 1`（警告全为既有 orphaned colors） |
| `node -e "import('…/src/lib/editUnits.ts')"`（Node 24 类型剥离，直接调用交付代码） | 畸形围栏 `[0,26)` 单块；`caretOffsetForRatio`/`spliceUnit` 复算；**脚注三例均产 `editable:true` 且区间覆盖 HTML/widget 源码**；**双提交复算产出 `新段。\n\n新段。` 重复** |
| `node -e` + `unified/remark-rehype/rehype-raw`（打印 hast 位置 + `findUnitForRange` 命中） | 脚注区 `li/div/pre` 全部 `unit=1(other, EDITABLE)`；顶层/引用/列表内 HTML·widget 全部 `LOCKED`（对照证明 F8 的修法确实生效、只是容器白名单漏了脚注） |
| `node -e` + jsdom + 真实 React 19.2.7（复刻事件时序） | ① `flushSync` 后 window 监听器读到的是**新 markdown + 旧 activeIndex**，且 window 处理器确实被调用（`commitCalls= 2`）→ C2 前提成立；② 插入包裹层导致 `Widget unmount #1` / `Widget mount #2` → I2 成立 |
| `git diff 848899c..05505eb | perl`（emoji 扫描） | 仅验收报告表格中的 ✅ 命中，`src/` **零命中** |
| `grep -rn "it.skip|it.only|describe.skip|.todo("` | `src/` 零命中 |
| `git status --porcelain` | 仅派发前既有改动（`.pi/agents/*`、`docs/.../plans/*.md`）；本分支提交内容与 diff 文件一致 |
| 只读阅读 | `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md`、`docs/superpowers/plans/2026-09-10-vellum-block-editing.md`、`rulings.md`（F1–F36）、`progress.md`、验收报告、7 份 task 审查/复审报告、`src/**` 全部新增改动文件 |

**未做**（受只读约束）：未新增任何测试文件或临时脚本到仓库（探针全部走 `node -e` / 临时目录）；未执行真机 GUI 手检（裁定 F35，且我无 WebView2 会话）——验收报告 §7 的 14 项仍应由用户在真机完成，其中 #3（自增高推流）、#5（CRLF 保真）、#6（iframe 不重建）、#9（提交耗时校准）是自动化原理上看不见的项。
