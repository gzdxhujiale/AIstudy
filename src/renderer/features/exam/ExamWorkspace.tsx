import React from "react";
import {
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  FileInput,
  FileText,
  PenLine,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
  Trophy,
  Upload,
  X
} from "lucide-react";
import {
  extractTextFromKnowledgeDocumentSnapshot,
  parseQuestionsFromJsonText,
  parseQuestionsFromText,
  serializeQuestionsForExport
} from "./examImportExport";
import {
  appendAttempt,
  assignUnscopedExamItemsToCourse,
  createAttempt,
  createDefaultOptions,
  createExamCourseScope,
  createEmptyExamStore,
  createPaperDraft,
  createQuestionDraft,
  deletePaper,
  deleteQuestion,
  EXAM_QUESTION_TYPE_LABELS,
  formatDuration,
  getQuestionsForPaper,
  getScopedExamStore,
  loadExamStore,
  saveExamStore,
  upsertPaper,
  upsertQuestion
} from "./examService";
import type { ExamAnswerMap, ExamAttempt, ExamOption, ExamPaper, ExamQuestion, ExamQuestionType, ExamStore } from "./examTypes";

type ExamTab = "questions" | "papers" | "take" | "records";
type SaveState = "idle" | "saving" | "saved" | "error";

type ExamWorkspaceProps = {
  activeCourseId: string | null;
  activeCourseName: string;
  activeMindMapId: string | null;
  selectedNodeId: string | null;
  selectedNodeTitle: string;
};

type ExamSession = {
  paper: ExamPaper;
  questions: ExamQuestion[];
  studentName: string;
  startedAt: string;
  answers: ExamAnswerMap;
};

const EXAM_TABS: Array<{ id: ExamTab; label: string; icon: React.ReactNode }> = [
  { id: "questions", label: "题库", icon: <ClipboardList size={15} /> },
  { id: "papers", label: "试卷", icon: <FileText size={15} /> },
  { id: "take", label: "考试", icon: <Play size={15} /> },
  { id: "records", label: "成绩", icon: <Trophy size={15} /> }
];

function cloneQuestion(question: ExamQuestion): ExamQuestion {
  return {
    ...question,
    options: question.options.map((option) => ({ ...option })),
    answer: [...question.answer],
    keywords: [...question.keywords]
  };
}

function clonePaper(paper: ExamPaper): ExamPaper {
  return {
    ...paper,
    questionIds: [...paper.questionIds]
  };
}

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function toPercent(attempt: Pick<ExamAttempt, "earnedScore" | "totalScore">) {
  if (!attempt.totalScore) return 0;
  return Math.round((attempt.earnedScore / attempt.totalScore) * 100);
}

function answerLabel(question: ExamQuestion) {
  if (question.type === "short") return question.answer.join("；") || question.keywords.join("；");
  return question.answer.join("、");
}

function getPaperQuestionSummary(paper: ExamPaper, store: ExamStore) {
  const questions = getQuestionsForPaper(store, paper);
  const totalScore = questions.reduce((sum, question) => sum + question.score, 0);
  return { count: questions.length, totalScore };
}

function getQuestionById(store: ExamStore, questionId: string) {
  return store.questions.find((question) => question.id === questionId) ?? null;
}

function normalizeKeywordDraft(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateOption(options: ExamOption[], optionId: string, text: string) {
  return options.map((option) => (option.id === optionId ? { ...option, text } : option));
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort();
}

function validateQuestion(question: ExamQuestion) {
  if (!question.stem.trim()) return "题干不能为空";
  if (question.type !== "short") {
    const availableOptions = question.options.filter((option) => option.text.trim());
    if (availableOptions.length < 2) return "至少需要两个选项";
    if (!question.answer.length) return "请选择正确答案";
    if (question.answer.some((answer) => !availableOptions.some((option) => option.id === answer))) return "正确答案不在有效选项内";
  } else if (!question.answer.join("").trim() && !question.keywords.length) {
    return "简答题需要标准答案或关键词";
  }
  return "";
}

function getAvailableCategories(questions: ExamQuestion[]) {
  return Array.from(new Set(questions.map((question) => question.category).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function ExamWorkspace({ activeCourseId, activeCourseName, activeMindMapId, selectedNodeId, selectedNodeTitle }: ExamWorkspaceProps) {
  const scope = React.useMemo(
    () => createExamCourseScope(activeCourseId, activeCourseName),
    [activeCourseId, activeCourseName]
  );
  const jsonFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [store, setStore] = React.useState<ExamStore>(() => createEmptyExamStore());
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [notice, setNotice] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<ExamTab>("papers");
  const [questionDraft, setQuestionDraft] = React.useState<ExamQuestion | null>(null);
  const [questionSearch, setQuestionSearch] = React.useState("");
  const [questionCategory, setQuestionCategory] = React.useState("全部");
  const [paperDraft, setPaperDraft] = React.useState<ExamPaper>(() => createPaperDraft(scope));
  const [paperQuestionSearch, setPaperQuestionSearch] = React.useState("");
  const [selectedPaperId, setSelectedPaperId] = React.useState("");
  const [studentName, setStudentName] = React.useState("");
  const [session, setSession] = React.useState<ExamSession | null>(null);
  const [lastAttemptId, setLastAttemptId] = React.useState("");
  const [selectedAttemptId, setSelectedAttemptId] = React.useState("");
  const selectedScopeIdRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    let canceled = false;
    loadExamStore()
      .then((nextStore) => {
        if (canceled) return;
        const scopedInitialStore = assignUnscopedExamItemsToCourse(nextStore, scope);
        const initialScopedView = getScopedExamStore(scopedInitialStore, scope);
        setStore(scopedInitialStore);
        setIsHydrated(true);
        if (scopedInitialStore !== nextStore) void saveExamStore(scopedInitialStore);
        if (initialScopedView.papers[0]) {
          setSelectedPaperId(initialScopedView.papers[0].id);
          setPaperDraft(clonePaper(initialScopedView.papers[0]));
        } else {
          setPaperDraft(createPaperDraft(scope));
        }
        if (initialScopedView.attempts[0]) setSelectedAttemptId(initialScopedView.attempts[0].id);
      })
      .catch((error) => {
        if (canceled) return;
        setNotice(error instanceof Error ? error.message : "考试数据读取失败");
        setIsHydrated(true);
      });
    return () => {
      canceled = true;
    };
  }, [scope]);

  const commitStore = React.useCallback((nextStore: ExamStore, nextNotice = "") => {
    setStore(nextStore);
    setSaveState("saving");
    if (nextNotice) setNotice(nextNotice);
    void saveExamStore(nextStore)
      .then(() => setSaveState("saved"))
      .catch((error) => {
        setSaveState("error");
        setNotice(error instanceof Error ? error.message : "考试数据保存失败");
      });
  }, []);

  const scopedStore = React.useMemo(() => getScopedExamStore(store, scope), [scope, store]);

  React.useEffect(() => {
    if (!isHydrated) return;
    const scopeChanged = selectedScopeIdRef.current !== scope.courseId;
    if (!scopeChanged && selectedPaperId) return;
    selectedScopeIdRef.current = scope.courseId;
    if (scopeChanged) setSession(null);
    const nextPaper = scopedStore.papers[0] ?? null;
    setSelectedPaperId(nextPaper?.id ?? "");
    setPaperDraft(nextPaper ? clonePaper(nextPaper) : createPaperDraft(scope));
    setSelectedAttemptId(scopedStore.attempts[0]?.id ?? "");
  }, [isHydrated, scope, scopedStore.attempts, scopedStore.papers, selectedPaperId]);

  const categories = React.useMemo(() => getAvailableCategories(scopedStore.questions), [scopedStore.questions]);
  const filteredQuestions = React.useMemo(() => {
    const keyword = questionSearch.trim().toLowerCase();
    return scopedStore.questions.filter((question) => {
      const matchesCategory = questionCategory === "全部" || question.category === questionCategory;
      const matchesKeyword = !keyword || `${question.stem} ${question.category}`.toLowerCase().includes(keyword);
      return matchesCategory && matchesKeyword;
    });
  }, [questionCategory, questionSearch, scopedStore.questions]);

  const availablePaperQuestions = React.useMemo(() => {
    const keyword = paperQuestionSearch.trim().toLowerCase();
    return scopedStore.questions.filter((question) => {
      if (paperDraft.questionIds.includes(question.id)) return false;
      if (!keyword) return true;
      return `${question.stem} ${question.category}`.toLowerCase().includes(keyword);
    });
  }, [paperDraft.questionIds, paperQuestionSearch, scopedStore.questions]);

  const selectedPaper = React.useMemo(
    () => scopedStore.papers.find((paper) => paper.id === selectedPaperId) ?? null,
    [scopedStore.papers, selectedPaperId]
  );
  const selectedPaperQuestions = React.useMemo(
    () => (selectedPaper ? getQuestionsForPaper(scopedStore, selectedPaper) : []),
    [scopedStore, selectedPaper]
  );
  const selectedAttempt = React.useMemo(
    () => scopedStore.attempts.find((attempt) => attempt.id === selectedAttemptId) ?? scopedStore.attempts[0] ?? null,
    [scopedStore.attempts, selectedAttemptId]
  );

  function openQuestionEditor(question?: ExamQuestion) {
    setQuestionDraft(question ? cloneQuestion(question) : createQuestionDraft(scope));
    setNotice("");
  }

  function closeQuestionEditor() {
    setQuestionDraft(null);
  }

  function changeQuestionType(type: ExamQuestionType) {
    setQuestionDraft((current) => current
      ? {
          ...current,
          type,
          options: createDefaultOptions(type),
          answer: [],
          keywords: type === "short" ? current.keywords : []
        }
      : current);
  }

  function saveQuestionDraft() {
    if (!questionDraft) return;
    const validation = validateQuestion(questionDraft);
    if (validation) {
      setNotice(validation);
      return;
    }
    const nextStore = upsertQuestion(store, {
      ...questionDraft,
      courseId: scope.courseId,
      courseName: scope.courseName,
      category: questionDraft.category.trim() || "默认",
      options: questionDraft.options.map((option) => ({ ...option, text: option.text.trim() })),
      answer: questionDraft.answer.map((answer) => answer.trim()).filter(Boolean),
      keywords: questionDraft.keywords.map((keyword) => keyword.trim()).filter(Boolean)
    });
    commitStore(nextStore, "题目已保存");
    setQuestionDraft(null);
  }

  function removeQuestion(question: ExamQuestion) {
    if (!window.confirm(`删除题目「${question.stem.slice(0, 28)}」？`)) return;
    commitStore(deleteQuestion(store, question.id), "题目已删除");
    if (paperDraft.questionIds.includes(question.id)) {
      setPaperDraft((current) => ({ ...current, questionIds: current.questionIds.filter((id) => id !== question.id) }));
    }
  }

  function addImportedQuestions(questions: ExamQuestion[], message: string) {
    if (!questions.length) {
      setNotice("没有识别到题目");
      return;
    }
    const nextStore = questions.reduce((next, question) => upsertQuestion(next, {
      ...question,
      courseId: scope.courseId,
      courseName: scope.courseName
    }), store);
    commitStore(nextStore, message);
    setActiveTab("questions");
  }

  async function importJsonQuestions(file: File | null | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const questions = parseQuestionsFromJsonText(text, scope);
      addImportedQuestions(questions, `已导入 ${questions.length} 道题`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "题库导入失败");
    } finally {
      if (jsonFileInputRef.current) jsonFileInputRef.current.value = "";
    }
  }

  function exportCurrentQuestions() {
    if (!scopedStore.questions.length) {
      setNotice("当前课程暂无题目");
      return;
    }
    const blob = new Blob([serializeQuestionsForExport(scopedStore.questions)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${scope.courseName || "考试"}-题库.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importQuestionsFromCurrentDocument() {
    if (!activeCourseId || !activeMindMapId || !selectedNodeId) {
      setNotice("请选择导图节点");
      return;
    }
    if (!window.aistudyKnowledgeDocuments?.load) {
      setNotice("文档读取接口不可用");
      return;
    }
    try {
      const documentRecord = await window.aistudyKnowledgeDocuments.load({
        courseId: activeCourseId,
        mindMapId: activeMindMapId,
        nodeId: selectedNodeId
      });
      const text = extractTextFromKnowledgeDocumentSnapshot(documentRecord?.snapshot);
      const questions = parseQuestionsFromText(text, scope);
      addImportedQuestions(questions, `从「${selectedNodeTitle || "当前文档"}」导入 ${questions.length} 道题`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "当前文档导入失败");
    }
  }

  function startNewPaper() {
    const draft = createPaperDraft(scope);
    setPaperDraft(draft);
    setSelectedPaperId("");
    setNotice("");
  }

  function editPaper(paper: ExamPaper) {
    setSelectedPaperId(paper.id);
    setPaperDraft(clonePaper(paper));
    setNotice("");
  }

  function savePaperDraft() {
    if (!paperDraft.name.trim()) {
      setNotice("试卷名称不能为空");
      return;
    }
    const nextPaper = {
      ...paperDraft,
      courseId: scope.courseId,
      courseName: scope.courseName,
      name: paperDraft.name.trim(),
      description: paperDraft.description.trim()
    };
    const nextStore = upsertPaper(store, nextPaper);
    commitStore(nextStore, "试卷已保存");
    setSelectedPaperId(nextPaper.id);
    setPaperDraft(clonePaper(nextPaper));
  }

  function removePaper(paper: ExamPaper) {
    if (!window.confirm(`删除试卷「${paper.name}」？`)) return;
    const nextStore = deletePaper(store, paper.id);
    commitStore(nextStore, "试卷已删除");
    const nextPaper = getScopedExamStore(nextStore, scope).papers[0];
    setSelectedPaperId(nextPaper?.id ?? "");
    setPaperDraft(nextPaper ? clonePaper(nextPaper) : createPaperDraft());
  }

  function addQuestionToPaper(questionId: string) {
    setPaperDraft((current) => current.questionIds.includes(questionId)
      ? current
      : { ...current, questionIds: [...current.questionIds, questionId] });
  }

  function removeQuestionFromPaper(questionId: string) {
    setPaperDraft((current) => ({ ...current, questionIds: current.questionIds.filter((id) => id !== questionId) }));
  }

  function startExam() {
    if (!selectedPaper) {
      setNotice("请选择试卷");
      return;
    }
    if (!studentName.trim()) {
      setNotice("请输入考生姓名");
      return;
    }
    if (!selectedPaperQuestions.length) {
      setNotice("当前试卷没有题目");
      return;
    }
    setSession({
      paper: selectedPaper,
      questions: selectedPaperQuestions,
      studentName: studentName.trim(),
      startedAt: new Date().toISOString(),
      answers: {}
    });
    setNotice("");
  }

  function updateSessionAnswer(question: ExamQuestion, value: string) {
    setSession((current) => {
      if (!current) return current;
      const currentAnswer = current.answers[question.id] ?? [];
      const nextAnswer = question.type === "multiple"
        ? toggleValue(currentAnswer, value)
        : value.trim()
          ? [value]
          : [];
      return {
        ...current,
        answers: {
          ...current.answers,
          [question.id]: nextAnswer
        }
      };
    });
  }

  function submitExam() {
    if (!session) return;
    const unansweredCount = session.questions.filter((question) => !(session.answers[question.id] ?? []).length).length;
    if (unansweredCount > 0 && !window.confirm(`还有 ${unansweredCount} 题未作答，确认交卷？`)) return;
    const attempt = createAttempt({
      paper: session.paper,
      studentName: session.studentName,
      questions: session.questions,
      answers: session.answers,
      startedAt: session.startedAt
    });
    const nextStore = appendAttempt(store, attempt);
    commitStore(nextStore, "已自动评阅");
    setLastAttemptId(attempt.id);
    setSelectedAttemptId(attempt.id);
    setSession(null);
    setActiveTab("records");
  }

  if (!isHydrated) {
    return <main className="exam-page" aria-label="考试" />;
  }

  return (
    <main className="exam-page" aria-label="考试">
      <section className="exam-shell">
        <header className="exam-header">
          <div>
            <h1>考试</h1>
            <span>{saveState === "saving" ? "保存中" : saveState === "error" ? "保存失败" : saveState === "saved" ? "已保存" : scope.courseName}</span>
          </div>
          <nav className="exam-tabs" aria-label="考试模块">
            {EXAM_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </header>

        {notice ? (
          <div className="exam-notice">
            <span>{notice}</span>
            <button type="button" aria-label="关闭" onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        ) : null}

        {activeTab === "questions" ? (
          <QuestionBankView
            categories={categories}
            filteredQuestions={filteredQuestions}
            questionCategory={questionCategory}
            questionSearch={questionSearch}
            onCategoryChange={setQuestionCategory}
            onSearchChange={setQuestionSearch}
            onImportDocument={() => void importQuestionsFromCurrentDocument()}
            onImportJson={() => jsonFileInputRef.current?.click()}
            onExportJson={exportCurrentQuestions}
            canImportDocument={Boolean(activeCourseId && activeMindMapId && selectedNodeId)}
            canExport={scopedStore.questions.length > 0}
            onCreateQuestion={() => openQuestionEditor()}
            onEditQuestion={openQuestionEditor}
            onDeleteQuestion={removeQuestion}
          />
        ) : activeTab === "papers" ? (
          <PaperBuilderView
            store={scopedStore}
            paperDraft={paperDraft}
            paperQuestionSearch={paperQuestionSearch}
            availablePaperQuestions={availablePaperQuestions}
            onPaperDraftChange={setPaperDraft}
            onPaperSearchChange={setPaperQuestionSearch}
            onNewPaper={startNewPaper}
            onEditPaper={editPaper}
            onDeletePaper={removePaper}
            onSavePaper={savePaperDraft}
            onAddQuestion={addQuestionToPaper}
            onRemoveQuestion={removeQuestionFromPaper}
          />
        ) : activeTab === "take" ? (
          <TakeExamView
            store={scopedStore}
            selectedPaperId={selectedPaperId}
            studentName={studentName}
            selectedPaper={selectedPaper}
            selectedPaperQuestions={selectedPaperQuestions}
            session={session}
            lastAttempt={scopedStore.attempts.find((attempt) => attempt.id === lastAttemptId) ?? null}
            onPaperChange={setSelectedPaperId}
            onStudentNameChange={setStudentName}
            onStartExam={startExam}
            onCancelSession={() => setSession(null)}
            onAnswerChange={updateSessionAnswer}
            onSubmitExam={submitExam}
          />
        ) : (
          <ExamRecordsView
            attempts={scopedStore.attempts}
            selectedAttempt={selectedAttempt}
            onSelectAttempt={setSelectedAttemptId}
          />
        )}
      </section>

      {questionDraft ? (
        <QuestionEditorDialog
          draft={questionDraft}
          onChange={setQuestionDraft}
          onTypeChange={changeQuestionType}
          onClose={closeQuestionEditor}
          onSave={saveQuestionDraft}
        />
      ) : null}
      <input
        ref={jsonFileInputRef}
        className="exam-hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void importJsonQuestions(event.target.files?.[0])}
      />
    </main>
  );
}

function QuestionBankView({
  categories,
  filteredQuestions,
  questionCategory,
  questionSearch,
  onCategoryChange,
  onSearchChange,
  onImportDocument,
  onImportJson,
  onExportJson,
  canImportDocument,
  canExport,
  onCreateQuestion,
  onEditQuestion,
  onDeleteQuestion
}: {
  categories: string[];
  filteredQuestions: ExamQuestion[];
  questionCategory: string;
  questionSearch: string;
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onImportDocument: () => void;
  onImportJson: () => void;
  onExportJson: () => void;
  canImportDocument: boolean;
  canExport: boolean;
  onCreateQuestion: () => void;
  onEditQuestion: (question: ExamQuestion) => void;
  onDeleteQuestion: (question: ExamQuestion) => void;
}) {
  return (
    <section className="exam-workspace">
      <div className="exam-toolbar">
        <div className="exam-filter">
          <select value={questionCategory} onChange={(event) => onCategoryChange(event.target.value)}>
            <option value="全部">全部</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <label>
            <Search size={15} />
            <input value={questionSearch} onChange={(event) => onSearchChange(event.target.value)} />
          </label>
        </div>
        <div className="exam-toolbar-actions">
          <button className="exam-secondary-button" type="button" onClick={onImportDocument} disabled={!canImportDocument}>
            <FileInput size={15} />
            <span>文档导入</span>
          </button>
          <button className="exam-secondary-button" type="button" onClick={onImportJson}>
            <Upload size={15} />
            <span>导入</span>
          </button>
          <button className="exam-secondary-button" type="button" onClick={onExportJson} disabled={!canExport}>
            <Download size={15} />
            <span>导出</span>
          </button>
          <button className="exam-primary-button" type="button" onClick={onCreateQuestion}>
            <Plus size={15} />
            <span>新增题目</span>
          </button>
        </div>
      </div>

      <div className="exam-table">
        <div className="exam-table-head exam-question-grid">
          <span>题干</span>
          <span>类型</span>
          <span>分值</span>
          <span>分类</span>
          <span>答案</span>
          <span />
        </div>
        {filteredQuestions.length ? filteredQuestions.map((question) => (
          <article className="exam-table-row exam-question-grid" key={question.id}>
            <strong>{question.stem}</strong>
            <span>{EXAM_QUESTION_TYPE_LABELS[question.type]}</span>
            <span>{question.score}</span>
            <span>{question.category}</span>
            <span>{answerLabel(question)}</span>
            <div className="exam-row-actions">
              <button type="button" title="编辑" aria-label="编辑" onClick={() => onEditQuestion(question)}>
                <PenLine size={15} />
              </button>
              <button type="button" title="删除" aria-label="删除" onClick={() => onDeleteQuestion(question)}>
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        )) : (
          <div className="exam-empty">暂无题目</div>
        )}
      </div>
    </section>
  );
}

function QuestionEditorDialog({
  draft,
  onChange,
  onTypeChange,
  onClose,
  onSave
}: {
  draft: ExamQuestion;
  onChange: (draft: ExamQuestion) => void;
  onTypeChange: (type: ExamQuestionType) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const keywordText = draft.keywords.join("，");
  const answerText = draft.answer.join(" ");
  return (
    <div className="exam-modal-backdrop" role="presentation">
      <section className="exam-dialog" aria-label="题目编辑">
        <header>
          <h2>{draft.stem ? "编辑题目" : "新增题目"}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="exam-form-grid">
          <label className="wide">
            <span>题干</span>
            <textarea value={draft.stem} onChange={(event) => onChange({ ...draft, stem: event.target.value })} />
          </label>
          <label>
            <span>题型</span>
            <select value={draft.type} onChange={(event) => onTypeChange(event.target.value as ExamQuestionType)}>
              {Object.entries(EXAM_QUESTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>分类</span>
            <input value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value })} />
          </label>
          <label>
            <span>分值</span>
            <input type="number" min={1} max={100} value={draft.score} onChange={(event) => onChange({ ...draft, score: Number(event.target.value) })} />
          </label>
          <label>
            <span>难度</span>
            <input type="number" min={1} max={5} value={draft.difficulty} onChange={(event) => onChange({ ...draft, difficulty: Number(event.target.value) })} />
          </label>
        </div>

        {draft.type !== "short" ? (
          <div className="exam-option-editor">
            {draft.options.map((option) => (
              <label key={option.id}>
                <span>{option.id}</span>
                <input
                  value={option.text}
                  disabled={draft.type === "judge"}
                  onChange={(event) => onChange({ ...draft, options: updateOption(draft.options, option.id, event.target.value) })}
                />
                <input
                  type={draft.type === "multiple" ? "checkbox" : "radio"}
                  name="exam-question-answer"
                  checked={draft.answer.includes(option.id)}
                  onChange={() => onChange({
                    ...draft,
                    answer: draft.type === "multiple" ? toggleValue(draft.answer, option.id) : [option.id]
                  })}
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="exam-form-grid">
            <label className="wide">
              <span>标准答案</span>
              <textarea value={answerText} onChange={(event) => onChange({ ...draft, answer: event.target.value.trim() ? [event.target.value] : [] })} />
            </label>
            <label className="wide">
              <span>关键词</span>
              <input value={keywordText} onChange={(event) => onChange({ ...draft, keywords: normalizeKeywordDraft(event.target.value) })} />
            </label>
          </div>
        )}

        <footer>
          <button type="button" className="exam-secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="exam-primary-button" onClick={onSave}>
            <Save size={15} />
            <span>保存</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function PaperBuilderView({
  store,
  paperDraft,
  paperQuestionSearch,
  availablePaperQuestions,
  onPaperDraftChange,
  onPaperSearchChange,
  onNewPaper,
  onEditPaper,
  onDeletePaper,
  onSavePaper,
  onAddQuestion,
  onRemoveQuestion
}: {
  store: ExamStore;
  paperDraft: ExamPaper;
  paperQuestionSearch: string;
  availablePaperQuestions: ExamQuestion[];
  onPaperDraftChange: (paper: ExamPaper) => void;
  onPaperSearchChange: (value: string) => void;
  onNewPaper: () => void;
  onEditPaper: (paper: ExamPaper) => void;
  onDeletePaper: (paper: ExamPaper) => void;
  onSavePaper: () => void;
  onAddQuestion: (questionId: string) => void;
  onRemoveQuestion: (questionId: string) => void;
}) {
  const selectedQuestions = paperDraft.questionIds.map((id) => getQuestionById(store, id)).filter((question): question is ExamQuestion => Boolean(question));
  const draftTotalScore = selectedQuestions.reduce((sum, question) => sum + question.score, 0);
  return (
    <section className="exam-paper-layout">
      <aside className="exam-paper-list">
        <div className="exam-section-heading">
          <h2>试卷</h2>
          <button type="button" aria-label="新建试卷" onClick={onNewPaper}>
            <Plus size={15} />
          </button>
        </div>
        {store.papers.length ? store.papers.map((paper) => {
          const summary = getPaperQuestionSummary(paper, store);
          return (
            <article className={paper.id === paperDraft.id ? "exam-paper-item active" : "exam-paper-item"} key={paper.id} onClick={() => onEditPaper(paper)}>
              <strong>{paper.name}</strong>
              <span>{summary.count} 题 · {summary.totalScore} 分</span>
              <button type="button" aria-label="删除试卷" onClick={(event) => {
                event.stopPropagation();
                onDeletePaper(paper);
              }}>
                <Trash2 size={14} />
              </button>
            </article>
          );
        }) : <div className="exam-empty compact">暂无试卷</div>}
      </aside>

      <section className="exam-paper-editor">
        <div className="exam-paper-form">
          <label>
            <span>名称</span>
            <input value={paperDraft.name} onChange={(event) => onPaperDraftChange({ ...paperDraft, name: event.target.value })} />
          </label>
          <label>
            <span>时长</span>
            <input type="number" min={1} max={1440} value={paperDraft.durationMinutes} onChange={(event) => onPaperDraftChange({ ...paperDraft, durationMinutes: Number(event.target.value) })} />
          </label>
          <label className="wide">
            <span>说明</span>
            <input value={paperDraft.description} onChange={(event) => onPaperDraftChange({ ...paperDraft, description: event.target.value })} />
          </label>
          <button type="button" className="exam-primary-button" onClick={onSavePaper}>
            <Save size={15} />
            <span>保存试卷</span>
          </button>
        </div>

        <div className="exam-paper-columns">
          <section>
            <div className="exam-mini-heading">
              <h3>试卷题目</h3>
              <span>{selectedQuestions.length} 题 · {draftTotalScore} 分</span>
            </div>
            <div className="exam-question-stack">
              {selectedQuestions.length ? selectedQuestions.map((question, index) => (
                <article key={question.id} className="exam-question-chip">
                  <span>{index + 1}</span>
                  <strong>{question.stem}</strong>
                  <button type="button" aria-label="移除" onClick={() => onRemoveQuestion(question.id)}>
                    <X size={14} />
                  </button>
                </article>
              )) : <div className="exam-empty">暂无题目</div>}
            </div>
          </section>

          <section>
            <div className="exam-mini-heading">
              <h3>题库</h3>
              <label>
                <Search size={14} />
                <input value={paperQuestionSearch} onChange={(event) => onPaperSearchChange(event.target.value)} />
              </label>
            </div>
            <div className="exam-question-stack">
              {availablePaperQuestions.length ? availablePaperQuestions.map((question) => (
                <article key={question.id} className="exam-question-chip">
                  <span>{EXAM_QUESTION_TYPE_LABELS[question.type]}</span>
                  <strong>{question.stem}</strong>
                  <button type="button" aria-label="添加" onClick={() => onAddQuestion(question.id)}>
                    <Plus size={14} />
                  </button>
                </article>
              )) : <div className="exam-empty">暂无可选题目</div>}
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}

function TakeExamView({
  store,
  selectedPaperId,
  studentName,
  selectedPaper,
  selectedPaperQuestions,
  session,
  lastAttempt,
  onPaperChange,
  onStudentNameChange,
  onStartExam,
  onCancelSession,
  onAnswerChange,
  onSubmitExam
}: {
  store: ExamStore;
  selectedPaperId: string;
  studentName: string;
  selectedPaper: ExamPaper | null;
  selectedPaperQuestions: ExamQuestion[];
  session: ExamSession | null;
  lastAttempt: ExamAttempt | null;
  onPaperChange: (paperId: string) => void;
  onStudentNameChange: (value: string) => void;
  onStartExam: () => void;
  onCancelSession: () => void;
  onAnswerChange: (question: ExamQuestion, value: string) => void;
  onSubmitExam: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);
  const elapsedSeconds = session ? Math.max(0, Math.round((now - Date.parse(session.startedAt)) / 1000)) : 0;
  const timeLimitSeconds = session ? session.paper.durationMinutes * 60 : 0;
  const remainingSeconds = session ? Math.max(0, timeLimitSeconds - elapsedSeconds) : 0;

  React.useEffect(() => {
    if (session && remainingSeconds === 0) onSubmitExam();
  }, [onSubmitExam, remainingSeconds, session]);

  if (session) {
    const answeredCount = session.questions.filter((question) => (session.answers[question.id] ?? []).length).length;
    return (
      <section className="exam-taking-layout">
        <header className="exam-taking-header">
          <div>
            <h2>{session.paper.name}</h2>
            <span>{answeredCount}/{session.questions.length} · {formatDuration(remainingSeconds)}</span>
          </div>
          <div>
            <button type="button" className="exam-secondary-button" onClick={onCancelSession}>退出</button>
            <button type="button" className="exam-primary-button" onClick={onSubmitExam}>
              <CheckCircle2 size={15} />
              <span>交卷</span>
            </button>
          </div>
        </header>
        <div className="exam-answer-list">
          {session.questions.map((question, index) => (
            <QuestionAnswerCard
              key={question.id}
              index={index}
              question={question}
              answer={session.answers[question.id] ?? []}
              onAnswerChange={(value) => onAnswerChange(question, value)}
            />
          ))}
        </div>
      </section>
    );
  }

  const summary = selectedPaper ? getPaperQuestionSummary(selectedPaper, store) : { count: 0, totalScore: 0 };
  return (
    <section className="exam-start-layout">
      <div className="exam-start-panel">
        <label>
          <span>考生</span>
          <input value={studentName} onChange={(event) => onStudentNameChange(event.target.value)} />
        </label>
        <label>
          <span>试卷</span>
          <select value={selectedPaperId} onChange={(event) => onPaperChange(event.target.value)}>
            <option value="">选择试卷</option>
            {store.papers.map((paper) => (
              <option key={paper.id} value={paper.id}>{paper.name}</option>
            ))}
          </select>
        </label>
        <div className="exam-start-meta">
          <span>{summary.count} 题</span>
          <span>{summary.totalScore} 分</span>
          <span>{selectedPaper?.durationMinutes ?? 0} 分钟</span>
        </div>
        <button type="button" className="exam-primary-button" onClick={onStartExam}>
          <Play size={15} />
          <span>开始考试</span>
        </button>
      </div>
      {lastAttempt ? (
        <div className="exam-result-strip">
          <strong>{lastAttempt.paperName}</strong>
          <span>{lastAttempt.earnedScore}/{lastAttempt.totalScore} · {toPercent(lastAttempt)}%</span>
        </div>
      ) : null}
      <div className="exam-preview-list">
        {selectedPaperQuestions.length ? selectedPaperQuestions.map((question, index) => (
          <article key={question.id}>
            <span>{index + 1}</span>
            <strong>{question.stem}</strong>
            <em>{question.score} 分</em>
          </article>
        )) : <div className="exam-empty">暂无试卷题目</div>}
      </div>
    </section>
  );
}

function QuestionAnswerCard({
  index,
  question,
  answer,
  onAnswerChange
}: {
  index: number;
  question: ExamQuestion;
  answer: string[];
  onAnswerChange: (value: string) => void;
}) {
  return (
    <article className="exam-answer-card">
      <header>
        <span>第 {index + 1} 题</span>
        <em>{EXAM_QUESTION_TYPE_LABELS[question.type]} · {question.score} 分</em>
      </header>
      <p>{question.stem}</p>
      {question.type === "short" ? (
        <textarea value={answer[0] ?? ""} onChange={(event) => onAnswerChange(event.target.value)} />
      ) : (
        <div className="exam-answer-options">
          {question.options.filter((option) => option.text.trim()).map((option) => (
            <label key={option.id}>
              <input
                type={question.type === "multiple" ? "checkbox" : "radio"}
                name={question.id}
                checked={answer.includes(option.id)}
                onChange={() => onAnswerChange(option.id)}
              />
              <span>{option.id}. {option.text}</span>
            </label>
          ))}
        </div>
      )}
    </article>
  );
}

function ExamRecordsView({
  attempts,
  selectedAttempt,
  onSelectAttempt
}: {
  attempts: ExamAttempt[];
  selectedAttempt: ExamAttempt | null;
  onSelectAttempt: (attemptId: string) => void;
}) {
  return (
    <section className="exam-records-layout">
      <aside className="exam-attempt-list">
        {attempts.length ? attempts.map((attempt) => (
          <button
            key={attempt.id}
            type="button"
            className={selectedAttempt?.id === attempt.id ? "active" : ""}
            onClick={() => onSelectAttempt(attempt.id)}
          >
            <strong>{attempt.paperName}</strong>
            <span>{attempt.studentName} · {toPercent(attempt)}%</span>
            <small>{formatDateTime(attempt.submittedAt)}</small>
          </button>
        )) : <div className="exam-empty compact">暂无成绩</div>}
      </aside>
      <section className="exam-attempt-detail">
        {selectedAttempt ? (
          <>
            <header>
              <div>
                <h2>{selectedAttempt.paperName}</h2>
                <span>{selectedAttempt.studentName} · {formatDateTime(selectedAttempt.submittedAt)}</span>
              </div>
              <strong>{selectedAttempt.earnedScore}/{selectedAttempt.totalScore}</strong>
            </header>
            <div className="exam-score-grid">
              <span>正确 {selectedAttempt.correctCount}</span>
              <span>错误 {selectedAttempt.questionCount - selectedAttempt.correctCount}</span>
              <span>用时 {formatDuration(selectedAttempt.durationSeconds)}</span>
              <span>{toPercent(selectedAttempt)}%</span>
            </div>
            <div className="exam-detail-list">
              {selectedAttempt.details.map((detail, index) => (
                <article className={detail.isCorrect ? "correct" : "wrong"} key={`${detail.questionId}-${index}`}>
                  <span>{detail.isCorrect ? <Check size={14} /> : <X size={14} />}</span>
                  <div>
                    <strong>{detail.stem}</strong>
                    <p>作答：{detail.answer.join("、") || "未作答"} · 答案：{detail.expectedAnswer.join("、")}</p>
                  </div>
                  <em>{detail.earnedScore}/{detail.score}</em>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="exam-empty">暂无成绩</div>
        )}
      </section>
    </section>
  );
}
