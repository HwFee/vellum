# Task 1 report — 块单元纯函数 `editUnits`

实施者：控制器主对话（SDD 流程启动前完成，事后补审）
Commit：`2e2c11c`（Base `848899c`）

## 交付

| 文件 | 内容 |
|---|---|
| `src/lib/editUnits.ts` | `buildEditUnits` / `findUnitForRange` / `spliceUnit` / `caretOffsetForRatio` + 类型 `EditUnit` / `EditUnitKind` |
| `src/lib/editUnits.test.ts` | 15 用例（块切分、list/blockquote 下钻、HTML/注释/widget 判定、行内 HTML、`$$` 公式块、CRLF、空文档、拼接幂等、光标落点、区间命中） |
| `package.json` / `package-lock.json` | `mdast-util-math@3.0.0`、`micromark-extension-math@3.1.0` 由传递依赖提为直接依赖（`remark-math` 已安装它们，不新增安装） |

## 实施中的两处偏离（相对计划文本）

1. **解析配置对齐渲染管线**：计划原写只挂 gfm 扩展，实测会让 `$$…$$` 与渲染树（`MarkdownDocument` 挂了 `remark-math`）区间漂移。
   已改为 `extensions: [gfm(), math()]` + `mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]`，并把两个包提为直接依赖。
   计划文档已同步修订（见 `Global Constraints` 的例外条目）。
2. **`caretOffsetForRatio` 语义修正**：原计划测试断言比率 1 落在偏移 10，但该文本行首偏移只有 0/4/8/12，10 不存在。
   改为「忽略尾随换行产生的空行，落最后一个可见行行首 = 8」，实现、测试、计划文档三处同步。

## 验证命令与真实输出

```
$ npx vitest run src/lib/editUnits.test.ts
PASS (15) FAIL (0)

$ npx tsc --noEmit
TypeScript: No errors found

$ npm test
 Test Files  27 passed (27)
      Tests  295 passed (295)
```

## 关注点 / 未决项

- `buildEditUnits` 对无 `position.offset` 的节点选择**跳过**（该块不可编辑）。这是安全方向，但意味着极端文档（解析器给出缺失位置）下部分块会失去编辑入口，且当前无提示文案。是否需要在 Task 2 的锁定提示里区分「不可编辑」与「未映射」，留待审查判断。
- 解析失败时返回空数组（不可编辑任何块）。未做用户可见提示。
