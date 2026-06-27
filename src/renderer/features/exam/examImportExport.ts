import type { KnowledgeDocumentSnapshot } from "../documents/knowledgeDocumentTypes";
import { createDefaultOptions, createQuestionDraft, type ExamCourseScope } from "./examService";
import type { ExamQuestion, ExamQuestionType } from "./examTypes";

type ImportedQuestionCandidate = Record<string, unknown>;

function normalizeText(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u00a0/g, " ").trim()
    : "";
}

function normalizeInlineText(value: unknown) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function normalizeQuestionType(value: unknown): ExamQuestionType {
  const text = normalizeInlineText(value).toLowerCase();
  if (value === "multiple" || /多选|多项|multiple/.test(text)) return "multiple";
  if (value === "judge" || /判断|是非|对错|true|false|judge/.test(text)) return "judge";
  if (value === "short" || /简答|问答|主观|short/.test(text)) return "short";
  return "single";
}

function splitKeywords(value: unknown) {
  if (Array.isArray(value)) return value.map(normalizeInlineText).filter(Boolean);
  return normalizeText(value)
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitAnswerLetters(value: unknown) {
  if (Array.isArray(value)) return value.map(normalizeInlineText).filter(Boolean);
  return normalizeInlineText(value)
    .replace(/[，、；;|\s]+/g, "")
    .split("")
    .map((item) => item.toUpperCase())
    .filter((item) => /^[A-H]$/.test(item));
}

function answerTextToJudgeLetter(value: string) {
  if (/^(正确|对|是|true|yes)$/i.test(value)) return "A";
  if (/^(错误|错|否|false|no)$/i.test(value)) return "B";
  return "";
}

function hasJudgeOptions(optionTexts: string[]) {
  const first = optionTexts[0] ?? "";
  const second = optionTexts[1] ?? "";
  return /^(正确|对|是|true|yes)$/i.test(first) && /^(错误|错|否|false|no)$/i.test(second);
}

function readOptionArrayTexts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return normalizeInlineText(item);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return normalizeInlineText(record.text ?? record.label ?? record.value ?? record.name);
    }
    return "";
  });
}

function createQuestionFromCandidate(candidate: ImportedQuestionCandidate, scope: ExamCourseScope): ExamQuestion | null {
  const stem = normalizeText(candidate.stem ?? candidate["题干"] ?? candidate.question ?? candidate["题目"]);
  if (!stem) return null;
  const explicitType = normalizeQuestionType(candidate.type ?? candidate["题型"]);
  const optionArrayTexts = readOptionArrayTexts(candidate.options ?? candidate["选项"]);
  const optionTexts = [
    candidate.option_a ?? candidate.optionA ?? candidate.a ?? candidate.A ?? candidate["选项A"],
    candidate.option_b ?? candidate.optionB ?? candidate.b ?? candidate.B ?? candidate["选项B"],
    candidate.option_c ?? candidate.optionC ?? candidate.c ?? candidate.C ?? candidate["选项C"],
    candidate.option_d ?? candidate.optionD ?? candidate.d ?? candidate.D ?? candidate["选项D"]
  ].map((value, index) => normalizeInlineText(value) || optionArrayTexts[index] || "");
  const hasOptions = optionTexts.some(Boolean);
  const answerRaw = candidate.answer ?? candidate["答案"] ?? candidate.correctAnswer ?? candidate["正确答案"];
  const answerText = normalizeInlineText(answerRaw);
  const inferredJudge = Boolean(answerTextToJudgeLetter(answerText)) && (!hasOptions || hasJudgeOptions(optionTexts));
  const type = explicitType === "judge" || inferredJudge
    ? "judge"
    : hasOptions
      ? explicitType === "multiple" ? "multiple" : "single"
      : explicitType;
  const draft = createQuestionDraft(scope, type);
  const options = type === "judge"
    ? createDefaultOptions("judge")
    : type === "short"
      ? []
      : createDefaultOptions(type).map((option, index) => ({ ...option, text: optionTexts[index] ?? "" }));
  const answer = type === "short"
    ? answerText ? [answerText] : []
    : type === "judge"
      ? [answerTextToJudgeLetter(answerText) || splitAnswerLetters(answerRaw)[0] || ""].filter(Boolean)
      : splitAnswerLetters(answerRaw);
  if (type === "short" && !answer.length && splitKeywords(candidate.keywords ?? candidate["关键词"] ?? candidate.keyword ?? candidate["关键字"]).length === 0) {
    return null;
  }
  if (type !== "short" && answer.length === 0) return null;
  if (type !== "short" && options.filter((option) => option.text.trim()).length < 2) return null;
  return {
    ...draft,
    stem,
    options,
    answer: type === "multiple" ? Array.from(new Set(answer)).sort() : answer.slice(0, 1),
    keywords: splitKeywords(candidate.keywords ?? candidate["关键词"] ?? candidate.keyword ?? candidate["关键字"]),
    category: normalizeInlineText(candidate.category ?? candidate["分类"]) || "默认",
    score: normalizeNumber(candidate.score ?? candidate["分值"], 5, 1, 100),
    difficulty: normalizeNumber(candidate.difficulty ?? candidate["难度"], 1, 1, 5)
  };
}

export function parseQuestionsFromJsonText(value: string, scope: ExamCourseScope) {
  const parsed = JSON.parse(value) as unknown;
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];
  return source
    .map((item) => item && typeof item === "object" ? createQuestionFromCandidate(item as ImportedQuestionCandidate, scope) : null)
    .filter((question): question is ExamQuestion => Boolean(question));
}

function isQuestionStart(line: string) {
  return /^(\d{1,3}|[一二三四五六七八九十]{1,4})[.、．)]\s*\S/.test(line) || /^题目[:：]\s*\S/.test(line);
}

function stripQuestionPrefix(line: string) {
  return line.replace(/^(\d{1,3}|[一二三四五六七八九十]{1,4})[.、．)]\s*/, "").replace(/^题目[:：]\s*/, "").trim();
}

function parseQuestionBlock(lines: string[], scope: ExamCourseScope): ExamQuestion | null {
  const stemLines: string[] = [];
  const optionMap = new Map<string, string>();
  let answerText = "";
  let keywordText = "";
  let category = "";
  let typeText = "";
  let score = 5;
  let difficulty = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const optionMatch = line.match(/^([A-Ha-h])[\s.、．)]\s*(.+)$/);
    const answerMatch = line.match(/^(?:答案|正确答案|参考答案)[:：]\s*(.+)$/);
    const keywordMatch = line.match(/^(?:关键词|关键字)[:：]\s*(.+)$/);
    const categoryMatch = line.match(/^(?:分类|类别)[:：]\s*(.+)$/);
    const typeMatch = line.match(/^(?:题型|类型)[:：]\s*(.+)$/);
    const scoreMatch = line.match(/^(?:分值|分数)[:：]\s*(\d{1,3})/);
    const difficultyMatch = line.match(/^(?:难度)[:：]\s*([1-5])/);
    if (answerMatch) {
      answerText = answerMatch[1].trim();
    } else if (keywordMatch) {
      keywordText = keywordMatch[1].trim();
    } else if (categoryMatch) {
      category = categoryMatch[1].trim();
    } else if (typeMatch) {
      typeText = typeMatch[1].trim();
    } else if (scoreMatch) {
      score = normalizeNumber(scoreMatch[1], 5, 1, 100);
    } else if (difficultyMatch) {
      difficulty = normalizeNumber(difficultyMatch[1], 1, 1, 5);
    } else if (optionMatch && !answerMatch) {
      optionMap.set(optionMatch[1].toUpperCase(), optionMatch[2].trim());
    } else {
      stemLines.push(stemLines.length === 0 ? stripQuestionPrefix(line) : line);
    }
  }

  const stem = stemLines.join("\n").trim();
  if (!stem) return null;
  const hasOptions = optionMap.size > 0;
  const judgeLetter = answerTextToJudgeLetter(answerText);
  const optionTexts = ["A", "B", "C", "D"].map((letter) => optionMap.get(letter) ?? "");
  const answerLetters = splitAnswerLetters(answerText);
  const explicitType = normalizeQuestionType(typeText);
  const type: ExamQuestionType = explicitType !== "single"
    ? explicitType
    : (judgeLetter || (answerLetters.length === 1 && hasJudgeOptions(optionTexts))) && (!hasOptions || hasJudgeOptions(optionTexts))
      ? "judge"
      : hasOptions
        ? answerLetters.length > 1 ? "multiple" : "single"
        : "short";
  const candidate: ImportedQuestionCandidate = {
    stem,
    type,
    answer: judgeLetter || answerText,
    category,
    score,
    difficulty,
    keywords: keywordText
  };
  for (const letter of ["A", "B", "C", "D"]) {
    if (optionMap.has(letter)) candidate[`option_${letter.toLowerCase()}`] = optionMap.get(letter);
  }
  return createQuestionFromCandidate(candidate, scope);
}

export function parseQuestionsFromText(value: string, scope: ExamCourseScope) {
  const lines = normalizeText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (isQuestionStart(line) && current.length > 0) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks
    .map((block) => parseQuestionBlock(block, scope))
    .filter((question): question is ExamQuestion => Boolean(question));
}

export function extractTextFromKnowledgeDocumentSnapshot(snapshot: KnowledgeDocumentSnapshot | null | undefined) {
  if (!snapshot?.content) return "";
  const result: string[] = [];
  const visited = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.value === "string") result.push(record.value);
    for (const [key, child] of Object.entries(record)) {
      if (key === "value") continue;
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(snapshot.content.header);
  visit(snapshot.content.main);
  visit(snapshot.content.footer);
  return result.map((item) => item.trim()).filter(Boolean).join("\n");
}

export function serializeQuestionsForExport(questions: ExamQuestion[]) {
  return JSON.stringify({
    schema: "aistudy-exam-questions",
    version: 1,
    exportedAt: new Date().toISOString(),
    questions: questions.map((question) => ({
      type: question.type,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      keywords: question.keywords,
      category: question.category,
      score: question.score,
      difficulty: question.difficulty
    }))
  }, null, 2);
}
