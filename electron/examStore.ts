import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type ExamMysqlRuntime = {
  pool: Pool;
  examQuestionTable: string;
  examPaperTable: string;
  examPaperSectionTable: string;
  examPaperQuestionTable: string;
  examAttemptTable: string;
};

type ExamQuestionType = "single" | "multiple" | "judge" | "short";

type ExamOption = {
  id: string;
  text: string;
};

type ExamQuestion = {
  id: string;
  courseId: string | null;
  courseName: string;
  type: ExamQuestionType;
  stem: string;
  options: ExamOption[];
  answer: string[];
  keywords: string[];
  category: string;
  score: number;
  difficulty: number;
  createdAt: string;
  updatedAt: string;
};

type ExamPaperSection = {
  id: string;
  title: string;
  description: string;
  questionIds: string[];
};

type ExamPaper = {
  id: string;
  courseId: string | null;
  courseName: string;
  name: string;
  description: string;
  durationMinutes: number;
  questionIds: string[];
  sections: ExamPaperSection[];
  createdAt: string;
  updatedAt: string;
};

type ExamAttemptDetail = {
  questionId: string;
  stem: string;
  type: ExamQuestionType;
  score: number;
  earnedScore: number;
  answer: string[];
  expectedAnswer: string[];
  isCorrect: boolean;
};

type ExamAttempt = {
  id: string;
  courseId: string | null;
  courseName: string;
  paperId: string;
  paperName: string;
  studentName: string;
  startedAt: string;
  submittedAt: string;
  durationSeconds: number;
  totalScore: number;
  earnedScore: number;
  correctCount: number;
  questionCount: number;
  details: ExamAttemptDetail[];
};

export type ExamStore = {
  version: 1;
  questions: ExamQuestion[];
  papers: ExamPaper[];
  attempts: ExamAttempt[];
};

type ExamQuestionRow = RowDataPacket & {
  id: string;
  courseId: string | null;
  courseName: string;
  type: string;
  stem: string;
  optionsJson: string;
  answerJson: string;
  keywordsJson: string;
  category: string;
  score: number;
  difficulty: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ExamPaperRow = RowDataPacket & {
  id: string;
  courseId: string | null;
  courseName: string;
  name: string;
  description: string;
  durationMinutes: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ExamPaperSectionRow = RowDataPacket & {
  id: string;
  paperId: string;
  title: string;
  description: string;
  sortOrder: number;
};

type ExamPaperQuestionRow = RowDataPacket & {
  paperId: string;
  sectionId: string;
  questionId: string;
  sortOrder: number;
};

type ExamAttemptRow = RowDataPacket & {
  id: string;
  courseId: string | null;
  courseName: string;
  paperId: string;
  paperName: string;
  studentName: string;
  startedAt: Date | string;
  submittedAt: Date | string;
  durationSeconds: number;
  totalScore: number;
  earnedScore: number;
  correctCount: number;
  questionCount: number;
  detailsJson: string;
};

const EXAM_STORE_VERSION = 1 as const;
const ANONYMOUS_EXAM_STUDENT_NAME = "匿名考试";

function toIsoTimestamp(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toMysqlDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function createEmptyExamStore(): ExamStore {
  return { version: EXAM_STORE_VERSION, questions: [], papers: [], attempts: [] };
}

function normalizeExamString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExamCourseId(value: unknown) {
  const text = normalizeExamString(value);
  return text || null;
}

function normalizeExamQuestionType(value: unknown): ExamQuestionType {
  return value === "multiple" || value === "judge" || value === "short" ? value : "single";
}

function normalizeExamNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function readJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeExamStringArray(value: unknown) {
  return readJsonArray(value).map(normalizeExamString).filter(Boolean);
}

function normalizeExamOptions(value: unknown): ExamOption[] {
  return readJsonArray(value)
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const option = item as Partial<ExamOption>;
      return { id: normalizeExamString(option.id), text: normalizeExamString(option.text) };
    })
    .filter((option) => option.id);
}

function normalizeExamQuestion(value: unknown): ExamQuestion | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExamQuestion>;
  const id = normalizeExamString(candidate.id);
  const stem = normalizeExamString(candidate.stem);
  if (!id || !stem) return null;
  const createdAt = normalizeExamString(candidate.createdAt) || new Date().toISOString();
  return {
    id,
    courseId: normalizeExamCourseId(candidate.courseId),
    courseName: normalizeExamString(candidate.courseName),
    type: normalizeExamQuestionType(candidate.type),
    stem,
    options: normalizeExamOptions(candidate.options),
    answer: normalizeExamStringArray(candidate.answer),
    keywords: normalizeExamStringArray(candidate.keywords),
    category: normalizeExamString(candidate.category) || "默认",
    score: normalizeExamNumber(candidate.score, 5, 1, 100),
    difficulty: normalizeExamNumber(candidate.difficulty, 1, 1, 5),
    createdAt,
    updatedAt: normalizeExamString(candidate.updatedAt) || createdAt
  };
}

function uniqueExamIds(values: string[]) {
  return Array.from(new Set(values.map(normalizeExamString).filter(Boolean)));
}

function normalizeExamPaperSection(value: unknown, questionIds: Set<string>, index: number): ExamPaperSection {
  const candidate = value && typeof value === "object" ? value as Partial<ExamPaperSection> : {};
  return {
    id: normalizeExamString(candidate.id) || `section_${randomUUID()}`,
    title: normalizeExamString(candidate.title) || `第 ${index + 1} 部分`,
    description: normalizeExamString(candidate.description),
    questionIds: Array.isArray(candidate.questionIds)
      ? uniqueExamIds(candidate.questionIds).filter((id) => questionIds.has(id))
      : []
  };
}

function getExamPaperQuestionIds(paper: Pick<ExamPaper, "questionIds" | "sections">) {
  const sectionIds = Array.isArray(paper.sections) ? paper.sections.flatMap((section) => section.questionIds) : [];
  return uniqueExamIds(sectionIds.length ? sectionIds : paper.questionIds);
}

function normalizeExamPaper(value: unknown, questionIds: Set<string>): ExamPaper | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExamPaper>;
  const id = normalizeExamString(candidate.id);
  const name = normalizeExamString(candidate.name);
  if (!id || !name) return null;
  const createdAt = normalizeExamString(candidate.createdAt) || new Date().toISOString();
  const legacyIds = Array.isArray(candidate.questionIds) ? uniqueExamIds(candidate.questionIds).filter((questionId) => questionIds.has(questionId)) : [];
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.map((section, index) => normalizeExamPaperSection(section, questionIds, index))
    : [];
  const normalizedSections = sections.length
    ? sections
    : [{ id: `section_${randomUUID()}`, title: "试卷题目", description: "", questionIds: legacyIds }];
  const normalizedQuestionIds = getExamPaperQuestionIds({ questionIds: legacyIds, sections: normalizedSections });
  return {
    id,
    courseId: normalizeExamCourseId(candidate.courseId),
    courseName: normalizeExamString(candidate.courseName),
    name,
    description: normalizeExamString(candidate.description),
    durationMinutes: normalizeExamNumber(candidate.durationMinutes, 60, 1, 24 * 60),
    questionIds: normalizedQuestionIds,
    sections: normalizedSections,
    createdAt,
    updatedAt: normalizeExamString(candidate.updatedAt) || createdAt
  };
}

function normalizeExamAttemptDetails(value: unknown, questionIds: Set<string>): ExamAttemptDetail[] {
  return readJsonArray(value)
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const detail = item as Partial<ExamAttemptDetail>;
      return {
        questionId: normalizeExamString(detail.questionId),
        stem: normalizeExamString(detail.stem),
        type: normalizeExamQuestionType(detail.type),
        score: normalizeExamNumber(detail.score, 0, 0, 100),
        earnedScore: normalizeExamNumber(detail.earnedScore, 0, 0, 100),
        answer: normalizeExamStringArray(detail.answer),
        expectedAnswer: normalizeExamStringArray(detail.expectedAnswer),
        isCorrect: detail.isCorrect === true
      };
    })
    .filter((detail) => detail.questionId && questionIds.has(detail.questionId));
}

function normalizeExamAttempt(value: unknown, questionIds: Set<string>): ExamAttempt | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExamAttempt>;
  const id = normalizeExamString(candidate.id);
  const paperId = normalizeExamString(candidate.paperId);
  const submittedAt = normalizeExamString(candidate.submittedAt);
  if (!id || !paperId || !submittedAt) return null;
  const details = normalizeExamAttemptDetails(candidate.details, questionIds);
  return {
    id,
    courseId: normalizeExamCourseId(candidate.courseId),
    courseName: normalizeExamString(candidate.courseName),
    paperId,
    paperName: normalizeExamString(candidate.paperName),
    studentName: normalizeExamString(candidate.studentName) || ANONYMOUS_EXAM_STUDENT_NAME,
    startedAt: normalizeExamString(candidate.startedAt) || submittedAt,
    submittedAt,
    durationSeconds: normalizeExamNumber(candidate.durationSeconds, 0, 0, 24 * 60 * 60),
    totalScore: normalizeExamNumber(candidate.totalScore, 0, 0, 10000),
    earnedScore: normalizeExamNumber(candidate.earnedScore, 0, 0, 10000),
    correctCount: normalizeExamNumber(candidate.correctCount, 0, 0, 10000),
    questionCount: normalizeExamNumber(candidate.questionCount, details.length, 0, 10000),
    details
  };
}

function normalizeExamStore(value: unknown): ExamStore {
  if (!value || typeof value !== "object") return createEmptyExamStore();
  const candidate = value as Partial<ExamStore>;
  const questions = Array.isArray(candidate.questions)
    ? candidate.questions.map(normalizeExamQuestion).filter((question): question is ExamQuestion => Boolean(question))
    : [];
  const questionIds = new Set(questions.map((question) => question.id));
  const papers = Array.isArray(candidate.papers)
    ? candidate.papers.map((paper) => normalizeExamPaper(paper, questionIds)).filter((paper): paper is ExamPaper => Boolean(paper))
    : [];
  const attempts = Array.isArray(candidate.attempts)
    ? candidate.attempts.map((attempt) => normalizeExamAttempt(attempt, questionIds)).filter((attempt): attempt is ExamAttempt => Boolean(attempt))
    : [];
  return { version: EXAM_STORE_VERSION, questions, papers, attempts };
}

function stringifyExamJson(value: unknown) {
  return JSON.stringify(value ?? []);
}

async function markMissingExamRowsDeleted(connection: PoolConnection, table: string, idColumn: string, ids: string[], deletedAt: Date) {
  if (!ids.length) {
    await connection.execute(`UPDATE ${table} SET deleted_at = ? WHERE deleted_at IS NULL`, [deletedAt]);
    return;
  }
  const placeholders = ids.map(() => "?").join(", ");
  await connection.execute(`UPDATE ${table} SET deleted_at = ? WHERE ${idColumn} NOT IN (${placeholders}) AND deleted_at IS NULL`, [deletedAt, ...ids]);
}

export async function ensureExamTables(
  pool: Pool,
  questionTable: string,
  paperTable: string,
  sectionTable: string,
  paperQuestionTable: string,
  attemptTable: string
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${questionTable} (
      id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NULL,
      course_name VARCHAR(255) NOT NULL,
      type VARCHAR(24) NOT NULL,
      stem TEXT NOT NULL,
      options_json TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      category VARCHAR(120) NOT NULL,
      score INT NOT NULL DEFAULT 5,
      difficulty INT NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_exam_question_course (course_id, updated_at),
      KEY idx_exam_question_category (course_id, category, deleted_at),
      KEY idx_exam_question_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${paperTable} (
      id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NULL,
      course_name VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 60,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_exam_paper_course (course_id, updated_at),
      KEY idx_exam_paper_name (name),
      KEY idx_exam_paper_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${sectionTable} (
      id VARCHAR(64) NOT NULL,
      paper_id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_exam_section_paper (paper_id, sort_order),
      KEY idx_exam_section_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${paperQuestionTable} (
      paper_id VARCHAR(64) NOT NULL,
      section_id VARCHAR(64) NOT NULL,
      question_id VARCHAR(64) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (paper_id, section_id, question_id),
      KEY idx_exam_paper_question_section (paper_id, section_id, sort_order),
      KEY idx_exam_paper_question_question (question_id, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${attemptTable} (
      id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NULL,
      course_name VARCHAR(255) NOT NULL,
      paper_id VARCHAR(64) NOT NULL,
      paper_name VARCHAR(255) NOT NULL,
      student_name VARCHAR(120) NOT NULL,
      started_at DATETIME(3) NOT NULL,
      submitted_at DATETIME(3) NOT NULL,
      duration_seconds INT NOT NULL DEFAULT 0,
      total_score INT NOT NULL DEFAULT 0,
      earned_score INT NOT NULL DEFAULT 0,
      correct_count INT NOT NULL DEFAULT 0,
      question_count INT NOT NULL DEFAULT 0,
      details_json LONGTEXT NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_exam_attempt_course (course_id, submitted_at),
      KEY idx_exam_attempt_paper (paper_id, submitted_at),
      KEY idx_exam_attempt_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function readExamStoreFromMysql(runtime: ExamMysqlRuntime): Promise<ExamStore> {
  const [questionRows] = await runtime.pool.execute<ExamQuestionRow[]>(
    `SELECT id, course_id AS courseId, course_name AS courseName, type, stem,
            options_json AS optionsJson, answer_json AS answerJson, keywords_json AS keywordsJson,
            category, score, difficulty, created_at AS createdAt, updated_at AS updatedAt
     FROM ${runtime.examQuestionTable}
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC`
  );
  const questions = questionRows.map((row) => normalizeExamQuestion({
    id: row.id,
    courseId: row.courseId,
    courseName: row.courseName,
    type: row.type,
    stem: row.stem,
    options: readJsonArray(row.optionsJson),
    answer: readJsonArray(row.answerJson),
    keywords: readJsonArray(row.keywordsJson),
    category: row.category,
    score: row.score,
    difficulty: row.difficulty,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt)
  })).filter((question): question is ExamQuestion => Boolean(question));
  const questionIds = new Set(questions.map((question) => question.id));

  const [paperRows] = await runtime.pool.execute<ExamPaperRow[]>(
    `SELECT id, course_id AS courseId, course_name AS courseName, name, description,
            duration_minutes AS durationMinutes, created_at AS createdAt, updated_at AS updatedAt
     FROM ${runtime.examPaperTable}
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC`
  );
  const [sectionRows] = await runtime.pool.execute<ExamPaperSectionRow[]>(
    `SELECT id, paper_id AS paperId, title, description, sort_order AS sortOrder
     FROM ${runtime.examPaperSectionTable}
     WHERE deleted_at IS NULL
     ORDER BY paper_id ASC, sort_order ASC`
  );
  const [linkRows] = await runtime.pool.execute<ExamPaperQuestionRow[]>(
    `SELECT paper_id AS paperId, section_id AS sectionId, question_id AS questionId, sort_order AS sortOrder
     FROM ${runtime.examPaperQuestionTable}
     WHERE deleted_at IS NULL
     ORDER BY paper_id ASC, section_id ASC, sort_order ASC`
  );

  const sectionQuestionIds = new Map<string, string[]>();
  for (const row of linkRows) {
    if (!questionIds.has(row.questionId)) continue;
    const key = `${row.paperId}\u0000${row.sectionId}`;
    const ids = sectionQuestionIds.get(key) ?? [];
    ids.push(row.questionId);
    sectionQuestionIds.set(key, ids);
  }
  const sectionsByPaper = new Map<string, ExamPaperSection[]>();
  for (const row of sectionRows) {
    const sections = sectionsByPaper.get(row.paperId) ?? [];
    sections.push({
      id: row.id,
      title: row.title,
      description: row.description,
      questionIds: uniqueExamIds(sectionQuestionIds.get(`${row.paperId}\u0000${row.id}`) ?? [])
    });
    sectionsByPaper.set(row.paperId, sections);
  }
  const papers = paperRows.map((row) => normalizeExamPaper({
    id: row.id,
    courseId: row.courseId,
    courseName: row.courseName,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    questionIds: [],
    sections: sectionsByPaper.get(row.id) ?? [],
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt)
  }, questionIds)).filter((paper): paper is ExamPaper => Boolean(paper));

  const [attemptRows] = await runtime.pool.execute<ExamAttemptRow[]>(
    `SELECT id, course_id AS courseId, course_name AS courseName, paper_id AS paperId, paper_name AS paperName,
            student_name AS studentName, started_at AS startedAt, submitted_at AS submittedAt,
            duration_seconds AS durationSeconds, total_score AS totalScore, earned_score AS earnedScore,
            correct_count AS correctCount, question_count AS questionCount, details_json AS detailsJson
     FROM ${runtime.examAttemptTable}
     WHERE deleted_at IS NULL
     ORDER BY submitted_at DESC
     LIMIT 500`
  );
  const attempts = attemptRows.map((row) => normalizeExamAttempt({
    id: row.id,
    courseId: row.courseId,
    courseName: row.courseName,
    paperId: row.paperId,
    paperName: row.paperName,
    studentName: row.studentName,
    startedAt: toIsoTimestamp(row.startedAt),
    submittedAt: toIsoTimestamp(row.submittedAt),
    durationSeconds: row.durationSeconds,
    totalScore: row.totalScore,
    earnedScore: row.earnedScore,
    correctCount: row.correctCount,
    questionCount: row.questionCount,
    details: readJsonArray(row.detailsJson)
  }, questionIds)).filter((attempt): attempt is ExamAttempt => Boolean(attempt));

  return { version: EXAM_STORE_VERSION, questions, papers, attempts };
}

export async function writeExamStoreToMysql(runtime: ExamMysqlRuntime, value: unknown): Promise<ExamStore> {
  const store = normalizeExamStore(value);
  const now = new Date();
  const connection = await runtime.pool.getConnection();
  try {
    await connection.beginTransaction();
    await markMissingExamRowsDeleted(connection, runtime.examQuestionTable, "id", store.questions.map((question) => question.id), now);
    await markMissingExamRowsDeleted(connection, runtime.examPaperTable, "id", store.papers.map((paper) => paper.id), now);
    await markMissingExamRowsDeleted(connection, runtime.examPaperSectionTable, "id", store.papers.flatMap((paper) => paper.sections.map((section) => section.id)), now);
    await connection.execute(`UPDATE ${runtime.examPaperQuestionTable} SET deleted_at = ? WHERE deleted_at IS NULL`, [now]);
    await markMissingExamRowsDeleted(connection, runtime.examAttemptTable, "id", store.attempts.map((attempt) => attempt.id), now);

    for (const question of store.questions) {
      await connection.execute(
        `INSERT INTO ${runtime.examQuestionTable}
          (id, course_id, course_name, type, stem, options_json, answer_json, keywords_json, category, score, difficulty, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
          course_id = VALUES(course_id), course_name = VALUES(course_name), type = VALUES(type), stem = VALUES(stem),
          options_json = VALUES(options_json), answer_json = VALUES(answer_json), keywords_json = VALUES(keywords_json),
          category = VALUES(category), score = VALUES(score), difficulty = VALUES(difficulty),
          updated_at = VALUES(updated_at), deleted_at = NULL`,
        [
          question.id,
          question.courseId,
          question.courseName,
          question.type,
          question.stem,
          stringifyExamJson(question.options),
          stringifyExamJson(question.answer),
          stringifyExamJson(question.keywords),
          question.category,
          question.score,
          question.difficulty,
          toMysqlDate(question.createdAt),
          toMysqlDate(question.updatedAt)
        ]
      );
    }

    for (const paper of store.papers) {
      await connection.execute(
        `INSERT INTO ${runtime.examPaperTable}
          (id, course_id, course_name, name, description, duration_minutes, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
          course_id = VALUES(course_id), course_name = VALUES(course_name), name = VALUES(name), description = VALUES(description),
          duration_minutes = VALUES(duration_minutes), updated_at = VALUES(updated_at), deleted_at = NULL`,
        [
          paper.id,
          paper.courseId,
          paper.courseName,
          paper.name,
          paper.description,
          paper.durationMinutes,
          toMysqlDate(paper.createdAt),
          toMysqlDate(paper.updatedAt)
        ]
      );

      for (const [sectionIndex, section] of paper.sections.entries()) {
        await connection.execute(
          `INSERT INTO ${runtime.examPaperSectionTable}
            (id, paper_id, title, description, sort_order, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
           ON DUPLICATE KEY UPDATE
            paper_id = VALUES(paper_id), title = VALUES(title), description = VALUES(description),
            sort_order = VALUES(sort_order), updated_at = VALUES(updated_at), deleted_at = NULL`,
          [section.id, paper.id, section.title, section.description, sectionIndex, toMysqlDate(paper.createdAt), toMysqlDate(paper.updatedAt)]
        );

        for (const [questionIndex, questionId] of section.questionIds.entries()) {
          await connection.execute(
            `INSERT INTO ${runtime.examPaperQuestionTable}
              (paper_id, section_id, question_id, sort_order, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE
              sort_order = VALUES(sort_order), updated_at = VALUES(updated_at), deleted_at = NULL`,
            [paper.id, section.id, questionId, questionIndex, toMysqlDate(paper.createdAt), toMysqlDate(paper.updatedAt)]
          );
        }
      }
    }

    for (const attempt of store.attempts) {
      await connection.execute(
        `INSERT INTO ${runtime.examAttemptTable}
          (id, course_id, course_name, paper_id, paper_name, student_name, started_at, submitted_at,
           duration_seconds, total_score, earned_score, correct_count, question_count, details_json, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
          course_id = VALUES(course_id), course_name = VALUES(course_name), paper_id = VALUES(paper_id), paper_name = VALUES(paper_name),
          student_name = VALUES(student_name), started_at = VALUES(started_at), submitted_at = VALUES(submitted_at),
          duration_seconds = VALUES(duration_seconds), total_score = VALUES(total_score), earned_score = VALUES(earned_score),
          correct_count = VALUES(correct_count), question_count = VALUES(question_count), details_json = VALUES(details_json), deleted_at = NULL`,
        [
          attempt.id,
          attempt.courseId,
          attempt.courseName,
          attempt.paperId,
          attempt.paperName,
          attempt.studentName,
          toMysqlDate(attempt.startedAt),
          toMysqlDate(attempt.submittedAt),
          attempt.durationSeconds,
          attempt.totalScore,
          attempt.earnedScore,
          attempt.correctCount,
          attempt.questionCount,
          stringifyExamJson(attempt.details)
        ]
      );
    }

    await connection.commit();
    return store;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
