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
- MySQL 不可用时，本地兜底文件位于 `state/textbooks/{courseId}__{mindMapId}.json`。
- PDF 阅读走 `aistudy-pdf` 特权协议，不把 PDF 二进制塞进导图或 Word 快照。
- 当前资产记录保存 PDF 文件路径；跨机器迁移前必须重新确认路径相对化和资产复制策略。
- 笔记快照沿用 `aistudy-word`/canvas-editor 结构，载入 Word 文档时走现有 `aistudyKnowledgeDocuments` API。

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

对应主进程实现集中在 `electron/main.ts` 和 `electron/textbookStore.ts`。

## 扩展规则

- 不在教材模块内直接访问 MySQL、文件系统或 Electron API。
- 不新增没有真实接入的教材入口。
- 不把教材文件复制、转码或上传到隐藏位置，除非先明确资产迁移策略。
- 笔记合并到 Word 前必须保存当前笔记，并确认目标节点真实存在。
- 后续做 OCR、划线、批注或页内定位时，应继续绑定到 `textbookId + nodeId + pageStart/pageEnd`，不要改动课程、导图、节点三段主链路。
