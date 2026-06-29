# 数学输入

`mathInput` 负责教材笔记和节点文档共用的数学字符、公式粘贴和结构化输入能力。模块不直接访问 Electron、文件系统或 MySQL，只输出编辑器可插入的内联元素。

## 当前能力

- 识别 ChatGPT/KaTeX/MathML 复制出的 HTML、TeX 注解和纯文本。
- 将 `\to`、`rightarrow`、`Xarrow Y` 等退化箭头稳定还原为 `→`。
- 将 `\subset`、`\subseteq`、`\in`、`\notin`、`\mathbb{R}`、`\infty` 等常用数学写法还原为 Unicode 数学符号。
- 将 `D_f`、`R_f`、`x^2`、`x^{-1}` 和常见 Unicode 上下标拆成 canvas-editor 原生 `subscript` / `superscript` 元素。

## 使用边界

- 渲染器编辑器只调用本模块解析结果，不在各业务组件内重复维护一套数学粘贴规则。
- 不生成公式图片，不保存渲染后的 HTML。
- 保存仍走各自已有的 canvas-editor snapshot 和数据库链路。
