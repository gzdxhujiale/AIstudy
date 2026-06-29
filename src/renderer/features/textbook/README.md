# 教材模块

## 范围

教材模块负责把 PDF 教材接入当前知识库导图，并把节点学习笔记沉淀到已有 Word 文档链路。当前版本已经接入知识库工作区的“教材”模式、独立 PDF 阅读窗口、节点笔记、页段绑定和笔记载入文档。

## 用户流程

1. 用户在知识库工作区切换到“教材”。
2. 选择当前课程和导图作用域下的 PDF 教材。
3. 在 PDF 阅读区翻页、缩放或打开独立窗口。
4. 选择目录节点，记录该节点对应的教材页段。
5. 在右侧笔记区写节点教材笔记。
6. 保存后，笔记进入教材存储；需要沉淀时可载入当前节点 Word 文档。

## 数据边界

- 教材作用域是 `courseId + mindMapId`。
- 教材资产由主进程保存，MySQL 表是 `textbook_assets`。
- 节点教材笔记由主进程保存，MySQL 表是 `textbook_notes`。
- MySQL 是正式事实源，本地 JSON 只作为断连缓存，不作为第二套事实源。
- MySQL 不可用时，本地兜底文件位于 `state/textbooks/{courseId}__{mindMapId}.json`，待同步作用域记录在 `state/textbook-pending-scopes.json`，已经被数据库接管的作用域记录在 `state/textbook-database-backed-scopes.json`。
- MySQL 可用时读取、保存和 PDF 字节读取都走 DB-first StorageProvider，并把数据库结果回写本地缓存；只有数据库不可用或该作用域被标记为 dirty 时，本地缓存才会参与恢复。
- 旧版本已经存在的本地教材缓存，如果该作用域尚未被数据库接管且数据库为空，会自动提拔到 MySQL；接管后如果数据库已有内容或缓存未 dirty，不允许旧 JSON 覆盖数据库。
- PDF 阅读走 `aistudy-pdf` 特权协议，不把 PDF 二进制塞进导图或 Word 快照。
- 当前资产记录保存 PDF 文件路径；跨机器迁移前必须重新确认路径相对化和资产复制策略。
- 笔记快照沿用 `aistudy-word`/canvas-editor 结构，载入 Word 文档时走现有 `aistudyKnowledgeDocuments` API。
- 教材笔记支持 canvas-editor 原生上下标元素和常用数学字符模板，`D_f`、`R_f`、`x^2` 等应保存为富文本快照结构，不退化成普通字符串。
- 从 ChatGPT/KaTeX/MathML/HTML/纯文本粘贴到教材笔记的数学内容走 `features/mathInput` 共享清洗，`f:Xarrow Y`、`R_f ⊂ Y`、`X=ℝ`、`[0,+∞)` 等应在粘贴和重开后保持稳定。

## 文件

- `TextbookWorkspace.tsx`：教材工作区、PDF 选择、节点页段、笔记保存、载入 Word。
- `TextbookPdfWindow.tsx`：独立 PDF 阅读窗口。
- `PdfDocumentViewer.tsx`：pdfjs 阅读器、页码同步、缩放、懒渲染和页面缓存。
- `TextbookNoteEditor.tsx`：紧凑版 canvas-editor 笔记编辑器。
- `textbookNoteDocument.ts`：笔记快照创建、文本提取和合并到 Word 文档。
- `textbookService.ts`：preload API 包装、本地规范化。
- `textbookTypes.ts`：教材资产、笔记和 store 类型。

## 主进程接口

Renderer 只通过 preload 调用：

- `aistudyTextbooks.load`
- `aistudyTextbooks.save`
- `aistudyTextbooks.choosePdf`
- `aistudyTextbooks.readPdf`
- `aistudyTextbooks.openPdfWindow`
- `aistudyTextbooks.loadAnnotations`
- `aistudyTextbooks.saveAnnotation`
- `aistudyTextbooks.deleteAnnotation`

对应主进程实现集中在 `electron/main.ts` 和 `electron/textbookStore.ts`。

## PDF 批注数据规则

- PDF 批注是 MySQL-only 数据，表为 `textbook_annotations`，不写入本地 JSON 兜底。
- 数据库不可用时，renderer 必须清空当前批注列表并禁用批注编辑；重新连接后再从 MySQL 自动载入。
- 批注绑定链路是 `courseId + mindMapId + textbookId + nodeId + pageNumber`，坐标使用页面比例值，避免缩放后漂移。
- 查看器按当前页前后页窗读取批注，不一次加载整本教材的全部批注；页面 DOM 也只挂载当前页附近的批注层，避免大量批注造成卡顿。
- PDF 原文件保持只读；高亮、文字等操作保存为批注记录，后续如需导出带批注 PDF，应生成副本，不直接覆盖原教材。

## 扩展规则

- 不在教材模块内直接访问 MySQL、文件系统或 Electron API。
- 不新增没有真实接入的教材入口。
- 不把教材文件复制、转码或上传到隐藏位置，除非先明确资产迁移策略。
- 笔记合并到 Word 前必须保存当前笔记，并确认目标节点真实存在。
- 后续做 OCR、划线、批注或页内定位时，应继续绑定到 `textbookId + nodeId + pageStart/pageEnd`，不要改动课程、导图、节点三段主链路。
