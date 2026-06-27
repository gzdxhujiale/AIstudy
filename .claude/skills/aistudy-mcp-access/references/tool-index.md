# AIstudy MCP Tool Index

Keep this file synchronized with `electron/mcp/controller.ts`, `electron/mcp/remoteAccess.ts`, and `scripts/mcp/aistudy-mcp-server.mjs`.

## Control And Discovery

- `mcp_get_started`: first call; returns health, scope, safety rules, resources, prompts, and next steps.
- `mcp_plan_task`: turns user intent into ordered MCP calls.
- `mcp_resolve_target`: resolves course and optional node candidates.
- `health_check`: checks runtime, MySQL, and core tables.
- `copy_config`: in-app helper for copying onboarding config.

## Read Tools

- `read_courses`
- `read_current_mindmap`
- `search_nodes`
- `list_node_documents`
- `read_node_document`

## Course And Section Edits

- `create_course`
- `rename_course`
- `move_course`
- `delete_course`
- `create_course_section`
- `rename_course_section`
- `move_course_section`
- `delete_course_section`

## Mind Map Edits

- `append_mindmap_node`
- `create_mindmap_node`
- `update_mindmap_node_text`
- `move_mindmap_node`
- `delete_mindmap_node`
- `update_mindmap_node_style`
- `update_mindmap_layout`

## Node Document Edits

- `write_node_document`: create new content or replace the whole document only when `replaceExisting: true` is explicitly approved.
- `append_node_document`: append clean text or Markdown-style headings.
- `format_node_document`: style-only cleanup; must preserve every editor element `value` exactly.
- `update_node_document_style`: simple full-document font size, color, bold, italic, or underline changes.

## Locator And Chrome Port Tools

- `resolve_course_locator`: generate local locator files for external agents; database/table values are fixed-boundary metadata, not overrideable runtime config.
- `chrome_ports_status`: inspect fixed Chrome debug ports.
- `chrome_port_open_page`: open or reuse a fixed-port Chrome page for `doubao`, `chatgpt`, `bilibili`, `zhihu`, `zhaopin`, `zhipin`, or `xiaohongshu`.

## Remote Permission Groups

Remote MCP is read-only by default.

- `edit`: global remote edit switch.
- `course`: course and section management.
- `mindmap`: mind map edits.
- `document`: node document writes and formatting.
- `destructive`: delete operations.

Destructive tools require both the relevant edit group and `destructive`.
