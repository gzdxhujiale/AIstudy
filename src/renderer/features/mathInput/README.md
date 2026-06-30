# 数学输入

`mathInput` 负责教材笔记和节点文档共用的数学字符、公式粘贴和结构化输入能力。模块不直接访问 Electron、文件系统或 MySQL，只输出编辑器可插入的内联元素。

## 当前能力

- 识别 ChatGPT/KaTeX/MathML 复制出的 HTML、TeX 注解和纯文本。
- 将 `\to`、`rightarrow`、`Xarrow Y` 等退化箭头稳定还原为 `→`。
- 将 `\subset`、`\subseteq`、`\in`、`\notin`、`\mathbb{R}`、`\infty` 等常用数学写法还原为 Unicode 数学符号。
- 将 `D_f`、`R_f`、`x^2`、`x^{-1}`、`log_a` 和常见 Unicode 上下标拆成 canvas-editor 原生 `subscript` / `superscript` 元素。
- 将 ChatGPT 数学回答中的标题、项目符号、分隔线、独立公式段和普通段落归一化为文档块，再由文档编辑器映射到 canvas-editor 的正式标题、列表、分隔线和居中段落属性。

## 使用边界

- 渲染器编辑器只调用本模块解析结果，不在各业务组件内重复维护一套数学粘贴规则。
- 不生成公式图片，不保存渲染后的 HTML。
- 保存仍走各自已有的 canvas-editor snapshot 和数据库链路。
- 粘贴归一化只保留内容语义，不继承 ChatGPT/WPS/网页 CSS 的外边距、行高和临时样式。
