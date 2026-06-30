import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const exportModulePath = path.join(projectRoot, "dist-electron/documentExport.js");
const mcpServerPath = path.join(projectRoot, "scripts/mcp/aistudy-mcp-server.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

if (!fs.existsSync(exportModulePath)) {
  throw new Error("Missing dist-electron/documentExport.js. Run npm run build before document columns QA.");
}

const { createKnowledgeDocumentDocxBuffer } = await import(pathToFileURL(exportModulePath).href);
const { normalizeDocumentSnapshot } = await import(`${pathToFileURL(mcpServerPath).href}?qa=${Date.now()}`);

function createSnapshot(main) {
  return {
    schemaVersion: 1,
    editor: "aistudy-word",
    editorVersion: "qa",
    updatedAt: new Date(0).toISOString(),
    content: { main }
  };
}

function readCellText(cell) {
  return Array.isArray(cell?.value) ? cell.value.map((element) => String(element?.value ?? "")).join("") : "";
}

function mergeColumnBlockTextForPolicy(block) {
  const cells = block.trList?.[0]?.tdList?.filter((cell) => !cell.disabled) ?? [];
  let text = "";
  for (const cell of cells) {
    const value = readCellText(cell);
    if (!value.trim()) continue;
    if (text && !text.endsWith("\n") && !value.startsWith("\n")) text += "\n";
    text += value;
  }
  return text;
}

async function readDocumentXml(snapshot) {
  const buffer = await createKnowledgeDocumentDocxBuffer({ title: "document-columns-qa", snapshot });
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert(documentXml, "DOCX should contain word/document.xml");
  return documentXml;
}

function getFirstTableXml(documentXml) {
  const tableXml = documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)?.[0];
  assert(tableXml, "DOCX should contain a table");
  return tableXml;
}

function getTableCellXml(tableXml) {
  return tableXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
}

const columnXml = await readDocumentXml(createSnapshot([
  { value: "分栏前\n" },
  {
    type: "table",
    value: "",
    borderType: "empty",
    borderColor: "#94a3b8",
    aistudyBlockKind: "columns",
    aistudyColumnCount: 2,
    colgroup: [{ width: 260 }, { width: 40 }, { width: 40 }, { width: 260 }],
    trList: [
      {
        height: 42,
        tdList: [
          { colspan: 1, rowspan: 1, value: [{ value: "aluminium\nhug\nbearing" }] },
          { colspan: 1, rowspan: 1, value: [], disabled: true, deletable: false },
          { colspan: 1, rowspan: 1, value: [], disabled: true, deletable: false, borderTypes: ["left"] },
          { colspan: 1, rowspan: 1, value: [{ value: "responsibility\nbelow\nbasket" }] }
        ]
      }
    ]
  },
  { value: "\n分栏后" }
]));

assert(columnXml.includes("aluminium") && columnXml.includes("responsibility"), "column block text should be exported");
assert(columnXml.includes("<w:insideV w:val=\"single\""), "column block should export an internal vertical divider");
assert((columnXml.match(/w:val="none"/g) ?? []).length >= 5, "column block outer borders should export as none");
const columnCells = getTableCellXml(getFirstTableXml(columnXml));
assert(columnCells.length === 2, "column block spacer cells should not be exported as DOCX columns");
assert((columnCells[0].match(/<w:p(?:\s|>)/g) ?? []).length >= 3, "left column should export one vertical paragraph per pasted line");
assert((columnCells[1].match(/<w:p(?:\s|>)/g) ?? []).length >= 3, "right column should export one vertical paragraph per pasted line");
assert(!columnXml.includes('w:fill="F8FAFC"'), "column block export should not apply normal table first-column shading");

const normalizedColumnSnapshot = normalizeDocumentSnapshot(createSnapshot([
  {
    type: "table",
    value: "",
    borderType: "empty",
    borderColor: "#94a3b8",
    aistudyBlockKind: "columns",
    aistudyColumnCount: 2,
    colgroup: [{ width: 260 }, { width: 40 }, { width: 40 }, { width: 260 }],
    trList: [
      {
        height: 42,
        tdList: [
          { colspan: 1, rowspan: 1, value: [{ value: "左栏内容\n" }] },
          { colspan: 1, rowspan: 1, value: [], disabled: true, deletable: false },
          { colspan: 1, rowspan: 1, value: [], disabled: true, deletable: false, borderTypes: ["left"] },
          { colspan: 1, rowspan: 1, value: [{ value: "右栏内容" }] }
        ]
      }
    ]
  }
]));
const normalizedColumnBlock = normalizedColumnSnapshot.content.main[0];
assert(normalizedColumnBlock.aistudyBlockKind === "columns", "MCP snapshot normalization should preserve column block metadata");
assert(normalizedColumnBlock.borderType === "empty", "MCP snapshot normalization should preserve borderless column block shell");
assert(Array.isArray(normalizedColumnBlock.trList?.[0]?.tdList), "MCP snapshot normalization should preserve table cells");
assert(normalizedColumnBlock.trList[0].tdList[2].borderTypes?.includes("left"), "MCP snapshot normalization should preserve the center divider cell border");
assert(normalizedColumnBlock.trList[0].tdList[1].disabled === true, "MCP snapshot normalization should preserve column spacer cells");
assert(
  mergeColumnBlockTextForPolicy(normalizedColumnBlock) === "左栏内容\n右栏内容",
  "column close policy should merge content columns in reading order and skip spacer cells"
);

const noExtraBreakColumnBlock = {
  ...normalizedColumnBlock,
  trList: [
    {
      height: 42,
      tdList: [
        { colspan: 1, rowspan: 1, value: [{ value: "左栏内容\n" }] },
        { colspan: 1, rowspan: 1, value: [], disabled: true, deletable: false },
        { colspan: 1, rowspan: 1, value: [], disabled: true, deletable: false, borderTypes: ["left"] },
        { colspan: 1, rowspan: 1, value: [{ value: "右栏内容" }] }
      ]
    }
  ]
};
assert(
  mergeColumnBlockTextForPolicy(noExtraBreakColumnBlock) === "左栏内容\n右栏内容",
  "column close policy should not add duplicate line breaks between columns"
);

const normalTableXml = await readDocumentXml(createSnapshot([
  {
    type: "table",
    value: "",
    colgroup: [{ width: 300 }, { width: 300 }],
    trList: [
      {
        height: 42,
        tdList: [
          { colspan: 1, rowspan: 1, value: [{ value: "普通表格" }] },
          { colspan: 1, rowspan: 1, value: [{ value: "第二列" }] }
        ]
      }
    ]
  }
]));

assert(normalTableXml.includes("普通表格") && normalTableXml.includes("第二列"), "normal table text should be exported");
assert((normalTableXml.match(/w:val="single"/g) ?? []).length >= 6, "normal table borders should remain visible");
assert(normalTableXml.includes('w:fill="F8FAFC"'), "normal table first-column shading should remain unchanged");

console.log("document columns export policy: ok");
