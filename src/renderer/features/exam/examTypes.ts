export type ExamQuestionType = "single" | "multiple" | "judge" | "short";

export type ExamOption = {
  id: string;
  text: string;
};

export type ExamQuestion = {
  id: string;
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

export type ExamPaper = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  questionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ExamAnswerMap = Record<string, string[]>;

export type ExamAttemptDetail = {
  questionId: string;
  stem: string;
  type: ExamQuestionType;
  score: number;
  earnedScore: number;
  answer: string[];
  expectedAnswer: string[];
  isCorrect: boolean;
};

export type ExamAttempt = {
  id: string;
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

export type ExamGradeResult = {
  totalScore: number;
  earnedScore: number;
  correctCount: number;
  details: ExamAttemptDetail[];
};
