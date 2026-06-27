import { readLocalSnapshot, writeLocalSnapshot } from "../../lib/localSnapshotStore";
import type {
  ExamAnswerMap,
  ExamAttempt,
  ExamGradeResult,
  ExamOption,
  ExamPaper,
  ExamPaperSection,
  ExamQuestion,
  ExamQuestionType,
  ExamStore
} from "./examTypes";

const EXAM_STORE_KEY = "exam:store";
const STORE_VERSION = 1 as const;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_QUESTION_SCORE = 5;
const DEFAULT_PAPER_SECTION_TITLE = "试卷题目";

export type ExamCourseScope = {
  courseId: string | null;
  courseName: string;
};

export const EXAM_QUESTION_TYPE_LABELS: Record<ExamQuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  short: "简答"
};

export function createEmptyExamStore(): ExamStore {
  return {
    version: STORE_VERSION,
    questions: [],
    papers: [],
    attempts: []
  };
}

function createId(prefix: string) {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCourseId(value: unknown) {
  const text = normalizeString(value);
  return text || null;
}

export function createExamCourseScope(courseId: string | null | undefined, courseName: string | null | undefined): ExamCourseScope {
  return {
    courseId: normalizeCourseId(courseId),
    courseName: normalizeString(courseName) || "未分区"
  };
}

export function isSameExamCourse(left: string | null | undefined, right: string | null | undefined) {
  return normalizeCourseId(left) === normalizeCourseId(right);
}

function normalizeScore(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return DEFAULT_QUESTION_SCORE;
  return Math.max(1, Math.min(100, Math.round(numberValue)));
}

function normalizeDifficulty(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 1;
  return Math.max(1, Math.min(5, Math.round(numberValue)));
}

function normalizeDuration(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return DEFAULT_DURATION_MINUTES;
  return Math.max(1, Math.min(24 * 60, Math.round(numberValue)));
}

function normalizeQuestionType(value: unknown): ExamQuestionType {
  return value === "multiple" || value === "judge" || value === "short" ? value : "single";
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.map(normalizeString).filter(Boolean)));
}

export function createDefaultOptions(type: ExamQuestionType): ExamOption[] {
  if (type === "judge") {
    return [
      { id: "A", text: "正确" },
      { id: "B", text: "错误" }
    ];
  }
  if (type === "short") return [];
  return ["A", "B", "C", "D"].map((id) => ({ id, text: "" }));
}

function normalizeOptions(type: ExamQuestionType, value: unknown): ExamOption[] {
  if (type === "short") return [];
  if (type === "judge") return createDefaultOptions(type);
  const source = Array.isArray(value) ? value : [];
  const fallback = createDefaultOptions(type);
  return fallback.map((option, index) => {
    const candidate = source[index] as Partial<ExamOption> | undefined;
    return {
      id: option.id,
      text: normalizeString(candidate?.text)
    };
  });
}

function normalizeAnswer(type: ExamQuestionType, value: unknown) {
  const source = Array.isArray(value) ? value.map(normalizeString).filter(Boolean) : [normalizeString(value)].filter(Boolean);
  if (type === "multiple") return Array.from(new Set(source.filter((item) => /^[A-D]$/.test(item)))).sort();
  if (type === "single") return source.find((item) => /^[A-D]$/.test(item)) ? [source.find((item) => /^[A-D]$/.test(item)) as string] : [];
  if (type === "judge") return source.find((item) => item === "A" || item === "B") ? [source.find((item) => item === "A" || item === "B") as string] : [];
  return source.length ? [source.join(" ")] : [];
}

function normalizeKeywords(value: unknown) {
  if (Array.isArray(value)) return value.map(normalizeString).filter(Boolean);
  return normalizeString(value)
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeQuestion(value: unknown): ExamQuestion | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExamQuestion>;
  const type = normalizeQuestionType(candidate.type);
  const stem = normalizeString(candidate.stem);
  if (!stem) return null;
  const createdAt = normalizeString(candidate.createdAt) || nowIso();
  const updatedAt = normalizeString(candidate.updatedAt) || createdAt;
  return {
    id: normalizeString(candidate.id) || createId("question"),
    courseId: normalizeCourseId(candidate.courseId),
    courseName: normalizeString(candidate.courseName),
    type,
    stem,
    options: normalizeOptions(type, candidate.options),
    answer: normalizeAnswer(type, candidate.answer),
    keywords: normalizeKeywords(candidate.keywords),
    category: normalizeString(candidate.category) || "默认",
    score: normalizeScore(candidate.score),
    difficulty: normalizeDifficulty(candidate.difficulty),
    createdAt,
    updatedAt
  };
}

function normalizePaperSection(value: unknown, index: number, questionIds: Set<string>): ExamPaperSection {
  const candidate = value && typeof value === "object" ? value as Partial<ExamPaperSection> : {};
  const ids = Array.isArray(candidate.questionIds)
    ? uniqueIds(candidate.questionIds).filter((id) => questionIds.has(id))
    : [];
  return {
    id: normalizeString(candidate.id) || createId("section"),
    title: normalizeString(candidate.title) || `第 ${index + 1} 部分`,
    description: normalizeString(candidate.description),
    questionIds: ids
  };
}

function normalizePaperSections(value: unknown, legacyQuestionIds: string[], questionIds: Set<string>) {
  const source = Array.isArray(value) ? value : [];
  const sections = source.map((section, index) => normalizePaperSection(section, index, questionIds));
  if (sections.length) return sections;
  if (!legacyQuestionIds.length) return [createPaperSectionDraft()];
  return [{
    id: createId("section"),
    title: DEFAULT_PAPER_SECTION_TITLE,
    description: "",
    questionIds: legacyQuestionIds
  }];
}

export function getPaperQuestionIds(paper: Pick<ExamPaper, "questionIds" | "sections">) {
  const sectionIds = Array.isArray(paper.sections)
    ? paper.sections.flatMap((section) => section.questionIds)
    : [];
  return uniqueIds(sectionIds.length ? sectionIds : paper.questionIds);
}

function normalizePaper(value: unknown, questionIds: Set<string>): ExamPaper | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExamPaper>;
  const name = normalizeString(candidate.name);
  if (!name) return null;
  const createdAt = normalizeString(candidate.createdAt) || nowIso();
  const updatedAt = normalizeString(candidate.updatedAt) || createdAt;
  const ids = Array.isArray(candidate.questionIds)
    ? uniqueIds(candidate.questionIds).filter((id) => questionIds.has(id))
    : [];
  const sections = normalizePaperSections(candidate.sections, ids, questionIds);
  const normalizedQuestionIds = getPaperQuestionIds({ questionIds: ids, sections });
  return {
    id: normalizeString(candidate.id) || createId("paper"),
    courseId: normalizeCourseId(candidate.courseId),
    courseName: normalizeString(candidate.courseName),
    name,
    description: normalizeString(candidate.description),
    durationMinutes: normalizeDuration(candidate.durationMinutes),
    questionIds: normalizedQuestionIds,
    sections,
    createdAt,
    updatedAt
  };
}

function normalizeAttempt(value: unknown, questionIds: Set<string>): ExamAttempt | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExamAttempt>;
  const id = normalizeString(candidate.id);
  const paperId = normalizeString(candidate.paperId);
  const submittedAt = normalizeString(candidate.submittedAt);
  if (!id || !paperId || !submittedAt) return null;
  const details = Array.isArray(candidate.details)
    ? candidate.details
        .filter((detail) => detail && typeof detail === "object")
        .map((detail) => {
          const source = detail as ExamAttempt["details"][number];
          return {
            questionId: normalizeString(source.questionId),
            stem: normalizeString(source.stem),
            type: normalizeQuestionType(source.type),
            score: normalizeScore(source.score),
            earnedScore: Math.max(0, Number(source.earnedScore) || 0),
            answer: normalizeAnswer(normalizeQuestionType(source.type), source.answer),
            expectedAnswer: normalizeAnswer(normalizeQuestionType(source.type), source.expectedAnswer),
            isCorrect: Boolean(source.isCorrect)
          };
        })
        .filter((detail) => detail.questionId && questionIds.has(detail.questionId))
    : [];
  return {
    id,
    courseId: normalizeCourseId(candidate.courseId),
    courseName: normalizeString(candidate.courseName),
    paperId,
    paperName: normalizeString(candidate.paperName),
    studentName: normalizeString(candidate.studentName),
    startedAt: normalizeString(candidate.startedAt) || submittedAt,
    submittedAt,
    durationSeconds: Math.max(0, Number(candidate.durationSeconds) || 0),
    totalScore: Math.max(0, Number(candidate.totalScore) || 0),
    earnedScore: Math.max(0, Number(candidate.earnedScore) || 0),
    correctCount: Math.max(0, Number(candidate.correctCount) || 0),
    questionCount: Math.max(0, Number(candidate.questionCount) || details.length),
    details
  };
}

export function normalizeExamStore(value: unknown): ExamStore {
  if (!value || typeof value !== "object") return createEmptyExamStore();
  const candidate = value as Partial<ExamStore>;
  const questions = Array.isArray(candidate.questions)
    ? candidate.questions.map(normalizeQuestion).filter((question): question is ExamQuestion => Boolean(question))
    : [];
  const questionIds = new Set(questions.map((question) => question.id));
  const papers = Array.isArray(candidate.papers)
    ? candidate.papers.map((paper) => normalizePaper(paper, questionIds)).filter((paper): paper is ExamPaper => Boolean(paper))
    : [];
  const attempts = Array.isArray(candidate.attempts)
    ? candidate.attempts.map((attempt) => normalizeAttempt(attempt, questionIds)).filter((attempt): attempt is ExamAttempt => Boolean(attempt))
    : [];
  return {
    version: STORE_VERSION,
    questions,
    papers,
    attempts
  };
}

export async function loadExamStore() {
  const snapshot = await readLocalSnapshot<ExamStore>(EXAM_STORE_KEY);
  return normalizeExamStore(snapshot);
}

export async function saveExamStore(store: ExamStore) {
  await writeLocalSnapshot(EXAM_STORE_KEY, "exam", normalizeExamStore(store));
}

export function createQuestionDraft(scope: ExamCourseScope = createExamCourseScope(null, ""), type: ExamQuestionType = "single"): ExamQuestion {
  const timestamp = nowIso();
  return {
    id: createId("question"),
    courseId: scope.courseId,
    courseName: scope.courseName,
    type,
    stem: "",
    options: createDefaultOptions(type),
    answer: [],
    keywords: [],
    category: "",
    score: DEFAULT_QUESTION_SCORE,
    difficulty: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createPaperSectionDraft(title = DEFAULT_PAPER_SECTION_TITLE, description = ""): ExamPaperSection {
  return {
    id: createId("section"),
    title,
    description,
    questionIds: []
  };
}

export function createPostgraduatePoliticsPaperSections() {
  return [
    createPaperSectionDraft("一、单项选择题", "1-16 小题，每小题 1 分，共 16 分"),
    createPaperSectionDraft("二、多项选择题", "17-33 小题，每小题 2 分，共 34 分"),
    createPaperSectionDraft("三、分析题", "34-38 小题，共 50 分")
  ];
}

export function createPaperDraft(scope: ExamCourseScope = createExamCourseScope(null, "")): ExamPaper {
  const timestamp = nowIso();
  const sections = [createPaperSectionDraft()];
  return {
    id: createId("paper"),
    courseId: scope.courseId,
    courseName: scope.courseName,
    name: "",
    description: "",
    durationMinutes: DEFAULT_DURATION_MINUTES,
    questionIds: [],
    sections,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function upsertQuestion(store: ExamStore, question: ExamQuestion): ExamStore {
  const nextQuestion = normalizeQuestion({ ...question, updatedAt: nowIso() });
  if (!nextQuestion) return store;
  const exists = store.questions.some((item) => item.id === nextQuestion.id);
  return {
    ...store,
    questions: exists
      ? store.questions.map((item) => (item.id === nextQuestion.id ? nextQuestion : item))
      : [nextQuestion, ...store.questions]
  };
}

export function deleteQuestion(store: ExamStore, questionId: string): ExamStore {
  const questionIds = new Set(store.questions.filter((question) => question.id !== questionId).map((question) => question.id));
  return normalizeExamStore({
    ...store,
    questions: store.questions.filter((question) => question.id !== questionId),
    papers: store.papers.map((paper) => ({
      ...paper,
      questionIds: paper.questionIds.filter((id) => id !== questionId),
      sections: paper.sections.map((section) => ({
        ...section,
        questionIds: section.questionIds.filter((id) => id !== questionId)
      })),
      updatedAt: paper.questionIds.includes(questionId) ? nowIso() : paper.updatedAt
    })),
    attempts: store.attempts.map((attempt) => ({
      ...attempt,
      details: attempt.details.filter((detail) => questionIds.has(detail.questionId))
    }))
  });
}

export function upsertPaper(store: ExamStore, paper: ExamPaper): ExamStore {
  const questionIds = new Set(store.questions.map((question) => question.id));
  const nextPaper = normalizePaper({ ...paper, updatedAt: nowIso() }, questionIds);
  if (!nextPaper) return store;
  const exists = store.papers.some((item) => item.id === nextPaper.id);
  return {
    ...store,
    papers: exists ? store.papers.map((item) => (item.id === nextPaper.id ? nextPaper : item)) : [nextPaper, ...store.papers]
  };
}

export function deletePaper(store: ExamStore, paperId: string): ExamStore {
  return {
    ...store,
    papers: store.papers.filter((paper) => paper.id !== paperId),
    attempts: store.attempts.filter((attempt) => attempt.paperId !== paperId)
  };
}

function normalizeAnswerText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function areAnswerSetsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].map(normalizeAnswerText).sort();
  const normalizedRight = [...right].map(normalizeAnswerText).sort();
  return normalizedLeft.every((item, index) => item === normalizedRight[index]);
}

function gradeShortAnswer(question: ExamQuestion, answer: string[]) {
  const value = normalizeAnswerText(answer.join(" "));
  if (!value) return false;
  const expected = normalizeAnswerText(question.answer.join(" "));
  if (expected && value === expected) return true;
  if (!question.keywords.length) return false;
  return question.keywords.every((keyword) => value.includes(normalizeAnswerText(keyword)));
}

export function gradeExam(questions: ExamQuestion[], answers: ExamAnswerMap): ExamGradeResult {
  const details = questions.map((question) => {
    const answer = answers[question.id] ?? [];
    const isCorrect = question.type === "short"
      ? gradeShortAnswer(question, answer)
      : areAnswerSetsEqual(answer, question.answer);
    return {
      questionId: question.id,
      stem: question.stem,
      type: question.type,
      score: question.score,
      earnedScore: isCorrect ? question.score : 0,
      answer,
      expectedAnswer: question.answer,
      isCorrect
    };
  });
  return {
    totalScore: details.reduce((sum, detail) => sum + detail.score, 0),
    earnedScore: details.reduce((sum, detail) => sum + detail.earnedScore, 0),
    correctCount: details.filter((detail) => detail.isCorrect).length,
    details
  };
}

export function createAttempt(input: {
  paper: ExamPaper;
  studentName: string;
  questions: ExamQuestion[];
  answers: ExamAnswerMap;
  startedAt: string;
}): ExamAttempt {
  const submittedAt = nowIso();
  const grade = gradeExam(input.questions, input.answers);
  return {
    id: createId("attempt"),
    courseId: input.paper.courseId,
    courseName: input.paper.courseName,
    paperId: input.paper.id,
    paperName: input.paper.name,
    studentName: input.studentName.trim(),
    startedAt: input.startedAt,
    submittedAt,
    durationSeconds: Math.max(0, Math.round((Date.parse(submittedAt) - Date.parse(input.startedAt)) / 1000)),
    totalScore: grade.totalScore,
    earnedScore: grade.earnedScore,
    correctCount: grade.correctCount,
    questionCount: input.questions.length,
    details: grade.details
  };
}

export function appendAttempt(store: ExamStore, attempt: ExamAttempt): ExamStore {
  return {
    ...store,
    attempts: [attempt, ...store.attempts].slice(0, 500)
  };
}

export function getQuestionsForPaper(store: ExamStore, paper: ExamPaper) {
  const questionMap = new Map(store.questions.map((question) => [question.id, question]));
  return getPaperQuestionIds(paper).map((id) => questionMap.get(id)).filter((question): question is ExamQuestion => Boolean(question));
}

export function getScopedExamStore(store: ExamStore, scope: ExamCourseScope): ExamStore {
  const questions = store.questions.filter((question) => isSameExamCourse(question.courseId, scope.courseId));
  const questionIds = new Set(questions.map((question) => question.id));
  const papers = store.papers
    .filter((paper) => isSameExamCourse(paper.courseId, scope.courseId))
    .map((paper) => ({
      ...paper,
      questionIds: getPaperQuestionIds(paper).filter((questionId) => questionIds.has(questionId)),
      sections: paper.sections.map((section) => ({
        ...section,
        questionIds: section.questionIds.filter((questionId) => questionIds.has(questionId))
      }))
    }));
  const paperIds = new Set(papers.map((paper) => paper.id));
  const attempts = store.attempts.filter((attempt) => isSameExamCourse(attempt.courseId, scope.courseId) && paperIds.has(attempt.paperId));
  return {
    version: STORE_VERSION,
    questions,
    papers,
    attempts
  };
}

export function assignUnscopedExamItemsToCourse(store: ExamStore, scope: ExamCourseScope): ExamStore {
  if (!scope.courseId) return store;
  let changed = false;
  const questions = store.questions.map((question) => {
    if (question.courseId) return question;
    changed = true;
    return { ...question, courseId: scope.courseId, courseName: scope.courseName, updatedAt: nowIso() };
  });
  const papers = store.papers.map((paper) => {
    if (paper.courseId) return paper;
    changed = true;
    return { ...paper, courseId: scope.courseId, courseName: scope.courseName, updatedAt: nowIso() };
  });
  const attempts = store.attempts.map((attempt) => {
    if (attempt.courseId) return attempt;
    changed = true;
    return { ...attempt, courseId: scope.courseId, courseName: scope.courseName };
  });
  return changed ? { ...store, questions, papers, attempts } : store;
}

export function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const rest = safeSeconds % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
