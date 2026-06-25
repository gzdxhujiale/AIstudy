import type React from "react";
import type { MindMapCommand } from "./mindMapTypes";

export type MindMapBranchShortcutCommand = Extract<
  MindMapCommand,
  "insert-child" | "insert-sibling" | "insert-parent" | "reset-layout" | "add-relationship" | "add-boundary" | "add-summary"
>;

export type MindMapShortcutSetting = {
  command: MindMapBranchShortcutCommand;
  label: string;
  defaultShortcut: string;
};

export type MindMapShortcutSettings = Record<MindMapBranchShortcutCommand, string>;

export const MIND_MAP_SHORTCUT_SETTINGS_KEY = "aistudy:mindmap-shortcuts:v1";
export const MIND_MAP_SHORTCUTS_CHANGED_EVENT = "aistudy:mindmap-shortcuts-changed";

export const MIND_MAP_BRANCH_SHORTCUTS: MindMapShortcutSetting[] = [
  { command: "insert-child", label: "子主题", defaultShortcut: "Tab" },
  { command: "insert-sibling", label: "同级主题", defaultShortcut: "Enter" },
  { command: "insert-parent", label: "父主题", defaultShortcut: "Shift+Enter" },
  { command: "reset-layout", label: "整理布局", defaultShortcut: "Ctrl+Alt+L" },
  { command: "add-relationship", label: "关系线", defaultShortcut: "Ctrl+Alt+R" },
  { command: "add-boundary", label: "边界", defaultShortcut: "Ctrl+Alt+B" },
  { command: "add-summary", label: "概要", defaultShortcut: "Ctrl+Alt+S" }
];

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function createDefaultShortcutSettings(): MindMapShortcutSettings {
  return Object.fromEntries(
    MIND_MAP_BRANCH_SHORTCUTS.map((item) => [item.command, item.defaultShortcut])
  ) as MindMapShortcutSettings;
}

function normalizeKeyLabel(value: string) {
  if (value === " ") return "Space";
  if (value.length === 1) return value.toUpperCase();
  return value;
}

function normalizeShortcutForMatch(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function readMindMapShortcutSettings(): MindMapShortcutSettings {
  const defaults = createDefaultShortcutSettings();
  try {
    const raw = localStorage.getItem(MIND_MAP_SHORTCUT_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<MindMapBranchShortcutCommand, unknown>>;
    return Object.fromEntries(
      MIND_MAP_BRANCH_SHORTCUTS.map((item) => [
        item.command,
        typeof parsed[item.command] === "string" ? parsed[item.command] : defaults[item.command]
      ])
    ) as MindMapShortcutSettings;
  } catch {
    return defaults;
  }
}

export function writeMindMapShortcutSettings(settings: MindMapShortcutSettings) {
  localStorage.setItem(MIND_MAP_SHORTCUT_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(MIND_MAP_SHORTCUTS_CHANGED_EVENT, { detail: settings }));
}

export function resetMindMapShortcutSettings() {
  const defaults = createDefaultShortcutSettings();
  writeMindMapShortcutSettings(defaults);
  return defaults;
}

export function formatMindMapShortcutFromEvent(event: KeyboardEvent | React.KeyboardEvent) {
  const key = normalizeKeyLabel(event.key);
  if (!key || MODIFIER_KEYS.has(key)) return "";

  const parts = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
    key
  ].filter(Boolean);
  return parts.join("+");
}

export function isMindMapShortcutEvent(event: KeyboardEvent, shortcut: string) {
  const normalizedShortcut = normalizeShortcutForMatch(shortcut);
  if (!normalizedShortcut) return false;

  const current = [
    event.ctrlKey ? "ctrl" : "",
    event.altKey ? "alt" : "",
    event.shiftKey ? "shift" : "",
    event.metaKey ? "meta" : "",
    normalizeKeyLabel(event.key).toLowerCase()
  ].filter(Boolean).join("+");

  return current === normalizedShortcut;
}
