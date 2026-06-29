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

async function readDocumentXml(snapshot) {
  const buffer = await createKnowledgeDocumentDocxBuffer({ title: "document-columns-qa", snapshot });
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert(documentXml, "DOCX should contain word/document.xml");
  return documentXml;
}

const columnXml = await readDocumentXml(createSnapshot([
  { value: "分栏前\n" },
  {
    type: "table",
    value: "",
    borderType: "internal",
    aistudyBlockKind: "columns",
    aistudyColumnCount: 2,
    colgroup: [{ width: 300 }, { width: 300 }],
    trList: [
      {
        height: 42,
        tdList: [
          { colspan: 1, rowspan: 1, value: [{ value: "左栏内容" }] },
          { colspan: 1, rowspan: 1, value: [{ value: "右栏内容" }] }
        ]
      }
    ]
  },
  { value: "\n分栏后" }
]));

assert(columnXml.includes("左栏内容") && columnXml.includes("右栏内容"), "column block text should be exported");
assert(columnXml.includes("<w:insideV w:val=\"single\""), "column block should export an internal vertical divider");
assert((columnXml.match(/w:val="none"/g) ?? []).length >= 5, "column block outer borders should export as none");
assert(!columnXml.includes('w:fill="F8FAFC"'), "column block export should not apply normal table first-column shading");

const normalizedColumnSnapshot = normalizeDocumentSnapshot(createSnapshot([
  {
    type: "table",
    value: "",
    borderType: "internal",
    aistudyBlockKind: "columns",
    aistudyColumnCount: 2,
    colgroup: [],
    trList: [
      {
        height: 42,
        tdList: [
          { colspan: 1, rowspan: 1, value: [{ value: "左栏内容\n" }] },
          { colspan: 1, rowspan: 1, value: [{ value: "右栏内容" }] }
        ]
      }
    ]
  }
]));
const normalizedColumnBlock = normalizedColumnSnapshot.content.main[0];
assert(normalizedColumnBlock.aistudyBlockKind === "columns", "MCP snapshot normalization should preserve column block metadata");
assert(normalizedColumnBlock.borderType === "internal", "MCP snapshot normalization should preserve column block dividers");
assert(Array.isArray(normalizedColumnBlock.trList?.[0]?.tdList), "MCP snapshot normalization should preserve table cells");

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
