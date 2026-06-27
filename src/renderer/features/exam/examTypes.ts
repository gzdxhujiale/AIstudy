export type ExamQuestionType = "single" | "multiple" | "judge" | "short";

export type ExamOption = {
  id: string;
  text: string;
};

export type ExamQuestion = {
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

export type ExamPaperSection = {
  id: string;
  title: string;
  description: string;
  questionIds: string[];
};

export type ExamPaper = {
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

export type ExamGradeResult = {
  totalScore: number;
  earnedScore: number;
  correctCount: number;
  details: ExamAttemptDetail[];
};
