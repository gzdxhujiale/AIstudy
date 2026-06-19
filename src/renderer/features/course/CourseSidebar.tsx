import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Edit3, FolderPlus, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import type { Course, CourseSection, CourseSyncStatus } from "./courseTypes";
import { normalizeSectionName, sortByOrderThenUpdated } from "./courseTypes";

type CourseGroup = {
  kind: "section" | "unsectioned";
  id: string;
  name: string;
  collapsed: boolean;
  courses: Course[];
};

type CourseSidebarProps = {
  sections: CourseSection[];
  courses: Course[];
  activeCourseId: string | null;
  isHydrated: boolean;
  syncStatus: CourseSyncStatus;
  onRetrySync: () => void;
  onSelectCourse: (courseId: string) => void;
  onCreateCourse: (sectionId: string | null) => void;
  onEditCourse: (course: Course) => void;
  onDeleteCourse: (course: Course) => void;
  onCreateSection: (name: string) => Promise<void>;
  onRenameSection: (sectionId: string, name: string) => Promise<void>;
  onToggleSection: (sectionId: string, collapsed: boolean) => void;
  onDeleteSection: (section: CourseSection) => void;
  onMoveCourse: (course: Course, sectionId: string | null) => void;
  onReorderCourse: (courseId: string, sectionId: string | null, beforeCourseId: string | null) => void;
  onReorderSection: (sectionId: string, beforeSectionId: string | null) => void;
};

const NEW_SECTION_ID = "__new_section__";
const COURSE_MOVE_MENU_WIDTH = 190;
const COURSE_MOVE_MENU_GAP = 8;
const COURSE_MOVE_MENU_MAX_HEIGHT = 230;
const COURSE_CONTEXT_MENU_WIDTH = 178;
const COURSE_CONTEXT_MENU_GAP = 8;

type CourseMoveMenuAnchor = {
  courseId: string;
  left: number;
  top: number;
};

type CourseContextMenuAnchor = CourseMoveMenuAnchor & {
  copied: boolean;
};

type DraggingSidebarItem = {
  type: "course" | "section";
  id: string;
};

declare global {
  interface Window {
    aistudyClipboard?: {
      writeText: (text: string) => Promise<boolean>;
    };
  }
}

export function CourseSidebar({
  sections,
  courses,
  activeCourseId,
  isHydrated,
  syncStatus,
  onRetrySync,
  onSelectCourse,
  onCreateCourse,
  onEditCourse,
  onDeleteCourse,
  onCreateSection,
  onRenameSection,
  onToggleSection,
  onDeleteSection,
  onMoveCourse,
  onReorderCourse,
  onReorderSection
}: CourseSidebarProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [editingSectionId, setEditingSectionId] = React.useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = React.useState("");
  const [openCourseMoveMenuId, setOpenCourseMoveMenuId] = React.useState<string | null>(null);
  const [courseMoveMenuAnchor, setCourseMoveMenuAnchor] = React.useState<CourseMoveMenuAnchor | null>(null);
  const [courseContextMenuAnchor, setCourseContextMenuAnchor] = React.useState<CourseContextMenuAnchor | null>(null);
  const [isUnsectionedCollapsed, setIsUnsectionedCollapsed] = React.useState(false);
  const [draggingItem, setDraggingItem] = React.useState<DraggingSidebarItem | null>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const canReorder = !normalizedQuery && editingSectionId === null;
  const activeCourse = courses.find((course) => course.id === activeCourseId) ?? null;
  const sectionIds = React.useMemo(() => new Set(sections.map((section) => section.id)), [sections]);
  const visibleCourses = React.useMemo(
    () =>
      normalizedQuery
        ? courses.filter((course) => `${course.name} ${course.description}`.toLowerCase().includes(normalizedQuery))
        : courses,
    [courses, normalizedQuery]
  );
  const groupedSections = React.useMemo<CourseGroup[]>(() => {
    const groups = sortByOrderThenUpdated(sections).map((section) => ({
      kind: "section" as const,
      id: section.id,
      name: section.name,
      collapsed: normalizedQuery ? false : section.collapsed,
      courses: sortByOrderThenUpdated(visibleCourses.filter((course) => course.sectionId === section.id))
    }));
    const unsectionedCourses = sortByOrderThenUpdated(
      visibleCourses.filter((course) => !course.sectionId || !sectionIds.has(course.sectionId))
    );

    return [
      ...groups,
      {
        kind: "unsectioned" as const,
        id: "__unsectioned__",
        name: "未分区",
        collapsed: normalizedQuery ? false : isUnsectionedCollapsed,
        courses: unsectionedCourses
      }
    ].filter((group) => (normalizedQuery ? group.courses.length > 0 : true));
  }, [isUnsectionedCollapsed, normalizedQuery, sectionIds, sections, visibleCourses]);

  React.useEffect(() => {
    if (openCourseMoveMenuId && !courses.some((course) => course.id === openCourseMoveMenuId)) {
      setOpenCourseMoveMenuId(null);
      setCourseMoveMenuAnchor(null);
    }
    if (courseContextMenuAnchor && !courses.some((course) => course.id === courseContextMenuAnchor.courseId)) {
      setCourseContextMenuAnchor(null);
    }
  }, [courseContextMenuAnchor, courses, openCourseMoveMenuId]);

  React.useEffect(() => {
    if (!courseContextMenuAnchor) return;
    function closeMenu(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".course-context-menu")) return;
      setCourseContextMenuAnchor(null);
    }
    window.addEventListener("pointerdown", closeMenu, true);
    return () => window.removeEventListener("pointerdown", closeMenu, true);
  }, [courseContextMenuAnchor]);

  React.useEffect(() => {
    if (!courseContextMenuAnchor) return;
    function closeMenu() {
      setCourseContextMenuAnchor(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [courseContextMenuAnchor]);

  const sectionNameById = React.useMemo(() => new Map(sections.map((section) => [section.id, section.name])), [sections]);

  const activeContextMenuCourse = courseContextMenuAnchor
    ? courses.find((course) => course.id === courseContextMenuAnchor.courseId) ?? null
    : null;

  React.useEffect(() => {
    if (!openCourseMoveMenuId) return;
    function closeMenu(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".course-move-menu") || target?.closest("[data-course-move-trigger='true']")) return;
      setOpenCourseMoveMenuId(null);
      setCourseMoveMenuAnchor(null);
    }
    window.addEventListener("pointerdown", closeMenu, true);
    return () => window.removeEventListener("pointerdown", closeMenu, true);
  }, [openCourseMoveMenuId]);

  React.useEffect(() => {
    if (!openCourseMoveMenuId) return;
    function closeMenu() {
      setOpenCourseMoveMenuId(null);
      setCourseMoveMenuAnchor(null);
    }
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openCourseMoveMenuId]);

  const activeMoveMenuCourse = openCourseMoveMenuId ? courses.find((course) => course.id === openCourseMoveMenuId) ?? null : null;

  function closeCourseMoveMenu() {
    setOpenCourseMoveMenuId(null);
    setCourseMoveMenuAnchor(null);
  }

  function closeCourseContextMenu() {
    setCourseContextMenuAnchor(null);
  }

  function getCoursePath(course: Course) {
    const sectionName = course.sectionId ? sectionNameById.get(course.sectionId) : "";
    return ["知识库", sectionName || "未分区", course.name].join(" / ");
  }

  async function copyCoursePath(course: Course) {
    const pathText = getCoursePath(course);
    if (window.aistudyClipboard?.writeText) {
      await window.aistudyClipboard.writeText(pathText);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(pathText);
    } else {
      throw new Error("复制没有完成，请稍后再试。");
    }
    setCourseContextMenuAnchor((current) => current && current.courseId === course.id ? { ...current, copied: true } : current);
    window.setTimeout(() => {
      setCourseContextMenuAnchor((current) => current && current.courseId === course.id ? null : current);
    }, 700);
  }

  function openCourseContextMenu(event: React.MouseEvent<HTMLElement>, course: Course) {
    event.preventDefault();
    event.stopPropagation();
    closeCourseMoveMenu();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      viewportWidth - COURSE_CONTEXT_MENU_WIDTH - COURSE_CONTEXT_MENU_GAP,
      Math.max(COURSE_CONTEXT_MENU_GAP, event.clientX)
    );
    const top = Math.min(
      viewportHeight - 48 - COURSE_CONTEXT_MENU_GAP,
      Math.max(COURSE_CONTEXT_MENU_GAP, event.clientY)
    );
    setCourseContextMenuAnchor({ courseId: course.id, left, top, copied: false });
  }

  function toggleCourseMoveMenu(course: Course, button: HTMLButtonElement) {
    closeCourseContextMenu();
    if (openCourseMoveMenuId === course.id) {
      closeCourseMoveMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      viewportWidth - COURSE_MOVE_MENU_WIDTH - COURSE_MOVE_MENU_GAP,
      Math.max(COURSE_MOVE_MENU_GAP, rect.right - COURSE_MOVE_MENU_WIDTH)
    );
    const hasRoomBelow = viewportHeight - rect.bottom >= COURSE_MOVE_MENU_MAX_HEIGHT + COURSE_MOVE_MENU_GAP;
    const top = hasRoomBelow
      ? rect.bottom + COURSE_MOVE_MENU_GAP
      : Math.max(COURSE_MOVE_MENU_GAP, rect.top - COURSE_MOVE_MENU_MAX_HEIGHT - COURSE_MOVE_MENU_GAP);
    setOpenCourseMoveMenuId(course.id);
    setCourseMoveMenuAnchor({ courseId: course.id, left, top });
  }

  function startCreateSection() {
    setEditingSectionId(NEW_SECTION_ID);
    setSectionDraft("");
    closeCourseMoveMenu();
    closeCourseContextMenu();
  }

  function startRenameSection(section: CourseSection) {
    setEditingSectionId(section.id);
    setSectionDraft(section.name);
    closeCourseMoveMenu();
    closeCourseContextMenu();
  }

  function cancelSectionEdit() {
    setEditingSectionId(null);
    setSectionDraft("");
  }

  async function submitSectionEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = normalizeSectionName(sectionDraft);
    if (!name) {
      cancelSectionEdit();
      return;
    }

    if (editingSectionId === NEW_SECTION_ID) {
      await onCreateSection(name);
    } else if (editingSectionId) {
      await onRenameSection(editingSectionId, name);
    }
    cancelSectionEdit();
  }

  function handleSectionInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelSectionEdit();
    }
  }

  function startDragCourse(event: React.DragEvent<HTMLElement>, courseId: string) {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    closeCourseMoveMenu();
    closeCourseContextMenu();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", courseId);
    setDraggingItem({ type: "course", id: courseId });
  }

  function startDragSection(event: React.DragEvent<HTMLElement>, sectionId: string) {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    closeCourseMoveMenu();
    closeCourseContextMenu();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sectionId);
    setDraggingItem({ type: "section", id: sectionId });
  }

  function allowCourseDrop(event: React.DragEvent<HTMLElement>) {
    if (draggingItem?.type !== "course") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function allowSectionDrop(event: React.DragEvent<HTMLElement>) {
    if (draggingItem?.type !== "section") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dropCourse(event: React.DragEvent<HTMLElement>, sectionId: string | null, beforeCourseId: string | null) {
    if (draggingItem?.type !== "course") return;
    event.preventDefault();
    event.stopPropagation();
    if (draggingItem.id !== beforeCourseId) {
      onReorderCourse(draggingItem.id, sectionId, beforeCourseId);
    }
    setDraggingItem(null);
  }

  function dropSection(event: React.DragEvent<HTMLElement>, beforeSectionId: string | null) {
    if (draggingItem?.type !== "section") return;
    event.preventDefault();
    event.stopPropagation();
    if (draggingItem.id !== beforeSectionId) {
      onReorderSection(draggingItem.id, beforeSectionId);
    }
    setDraggingItem(null);
  }

  function clearDrag() {
    setDraggingItem(null);
  }

  function renderSectionEditor() {
    return (
      <form className="course-section-editor" onSubmit={submitSectionEdit}>
        <ChevronDown size={15} />
        <input
          value={sectionDraft}
          onChange={(event) => setSectionDraft(event.target.value)}
          onKeyDown={handleSectionInputKeyDown}
          onBlur={() => {
            if (!normalizeSectionName(sectionDraft)) cancelSectionEdit();
          }}
          autoFocus
          maxLength={40}
          placeholder="分区名称"
        />
      </form>
    );
  }

  function renderSyncStatus() {
    const text = (() => {
      if (syncStatus.state === "saving") return "正在保存";
      if (syncStatus.state === "waiting") return syncStatus.pendingCount > 1 ? `${syncStatus.pendingCount} 项已在本机保存，稍后自动同步` : "已在本机保存，稍后自动同步";
      if (syncStatus.state === "attention") return "部分内容暂时没同步";
      return "已保存";
    })();

    return (
      <div className={`course-sync-status ${syncStatus.state}`} aria-live="polite">
        <span aria-hidden="true" />
        <strong>{text}</strong>
        {syncStatus.state === "attention" ? (
          <button type="button" onClick={onRetrySync}>
            再试一次
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="library-pane" aria-label="课程列表">
      <div className="pane-heading">
        <div>
          <p className="section-kicker">知识库</p>
          <h1>知识库</h1>
        </div>
        <div className="pane-heading-actions">
          <button className="icon-button" title="新建分区" aria-label="新建分区" type="button" onClick={startCreateSection}>
            <FolderPlus size={17} strokeWidth={2.1} />
          </button>
          <button
            className="icon-button primary-action"
            title="新建课程"
            aria-label="新建课程"
            type="button"
            onClick={() => onCreateCourse(activeCourse?.sectionId ?? null)}
          >
            <Plus size={17} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <label className="search-box" aria-label="搜索课程">
        <Search size={16} />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索课程"
          aria-label="搜索课程"
        />
      </label>

      {renderSyncStatus()}

      {courses.length === 0 && editingSectionId !== NEW_SECTION_ID ? (
        <div className="pane-empty-state">
          <strong>{isHydrated ? "暂无课程" : "正在读取课程"}</strong>
        </div>
      ) : visibleCourses.length === 0 && normalizedQuery ? (
        <div className="pane-empty-state">
          <strong>没有匹配课程</strong>
        </div>
      ) : (
        <div className="course-list" aria-label="课程">
          {editingSectionId === NEW_SECTION_ID ? renderSectionEditor() : null}
          {groupedSections.map((group) => {
            const isSystemGroup = group.kind === "unsectioned";
            const section = isSystemGroup ? null : sections.find((item) => item.id === group.id) ?? null;
            const isEditingThisSection = editingSectionId === group.id;
            const groupSectionId = section?.id ?? null;

            return (
              <section
                className="course-section-group"
                key={group.id}
                aria-label={group.name}
                onDragOver={allowCourseDrop}
                onDrop={(event) => dropCourse(event, groupSectionId, null)}
              >
                <div
                  className={draggingItem?.type === "section" && draggingItem.id !== group.id && !isSystemGroup ? "course-section-heading drop-ready" : "course-section-heading"}
                  draggable={canReorder && !isSystemGroup}
                  onDragStart={(event) => {
                    if (section) startDragSection(event, section.id);
                  }}
                  onDragOver={!isSystemGroup ? allowSectionDrop : undefined}
                  onDrop={!isSystemGroup ? (event) => dropSection(event, group.id) : undefined}
                  onDragEnd={clearDrag}
                >
                  {isEditingThisSection ? (
                    renderSectionEditor()
                  ) : (
                    <>
                      <button
                        className="course-section-toggle"
                        type="button"
                        onClick={() => {
                          if (isSystemGroup) {
                            setIsUnsectionedCollapsed((current) => !current);
                          } else {
                            onToggleSection(group.id, !group.collapsed);
                          }
                        }}
                        aria-expanded={!group.collapsed}
                      >
                        {group.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                        <span>{group.name}</span>
                        <em>{group.courses.length}</em>
                      </button>
                      <div className="course-section-actions" aria-label={`${group.name} 分区操作`}>
                        <button
                          className="mini-button"
                          type="button"
                          title={`在${group.name}中新建课程`}
                          aria-label={`在${group.name}中新建课程`}
                          onClick={() => onCreateCourse(section?.id ?? null)}
                        >
                          <Plus size={13} />
                        </button>
                        {section ? (
                          <>
                            <button
                              className="mini-button"
                              type="button"
                              title="重命名分区"
                              aria-label={`重命名分区 ${section.name}`}
                              onClick={() => startRenameSection(section)}
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              className="mini-button danger"
                              type="button"
                              title="删除分区"
                              aria-label={`删除分区 ${section.name}`}
                              onClick={() => onDeleteSection(section)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
                {!group.collapsed && !isEditingThisSection ? (
                  group.courses.length > 0 ? (
                    <div className="course-section-courses">
                      {group.courses.map((course) => (
                        <article
                          key={course.id}
                          className={[
                            "course-card",
                            activeCourseId === course.id ? "selected" : "",
                            draggingItem?.type === "course" && draggingItem.id === course.id ? "is-dragging" : "",
                            draggingItem?.type === "course" && draggingItem.id !== course.id ? "drop-ready" : ""
                          ].filter(Boolean).join(" ")}
                          draggable={canReorder}
                          onDragStart={(event) => startDragCourse(event, course.id)}
                          onDragOver={allowCourseDrop}
                          onDrop={(event) => dropCourse(event, course.sectionId && sectionIds.has(course.sectionId) ? course.sectionId : null, course.id)}
                          onDragEnd={clearDrag}
                          onContextMenu={(event) => openCourseContextMenu(event, course)}
                        >
                          <button className="course-main" type="button" onClick={() => onSelectCourse(course.id)}>
                            <span className="course-page-dot" aria-hidden="true" />
                            <span className="course-name">{course.name}</span>
                            {course.description.trim() ? <span className="course-meta">{course.description.trim()}</span> : null}
                          </button>
                          <div className="course-actions" aria-label={`${course.name} 操作`}>
                            <button className="mini-button" type="button" title="重命名课程" aria-label={`重命名 ${course.name}`} onClick={() => onEditCourse(course)}>
                              <Edit3 size={14} />
                            </button>
                            <button className="mini-button danger" type="button" title="删除课程" aria-label={`删除 ${course.name}`} onClick={() => onDeleteCourse(course)}>
                              <Trash2 size={14} />
                            </button>
                            <button
                              className="mini-button"
                              type="button"
                              title="移动到分区"
                              aria-label={`移动 ${course.name} 到分区`}
                              aria-expanded={openCourseMoveMenuId === course.id}
                              data-course-move-trigger="true"
                              onClick={(event) => toggleCourseMoveMenu(course, event.currentTarget)}
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={draggingItem?.type === "course" ? "course-section-empty drop-ready" : "course-section-empty"}
                      onDragOver={allowCourseDrop}
                      onDrop={(event) => dropCourse(event, groupSectionId, null)}
                    >
                      暂无知识库
                    </div>
                  )
                ) : null}
              </section>
            );
          })}
          {canReorder ? (
            <div className="course-section-tail-drop" onDragOver={allowSectionDrop} onDrop={(event) => dropSection(event, null)} aria-hidden="true" />
          ) : null}
        </div>
      )}
      {activeMoveMenuCourse && courseMoveMenuAnchor?.courseId === activeMoveMenuCourse.id ? (
        <div
          className="course-move-menu"
          role="menu"
          aria-label={`移动 ${activeMoveMenuCourse.name} 到分区`}
          style={{ left: courseMoveMenuAnchor.left, top: courseMoveMenuAnchor.top }}
        >
          <span>移动到</span>
          <button
            type="button"
            role="menuitem"
            className={!activeMoveMenuCourse.sectionId || !sectionIds.has(activeMoveMenuCourse.sectionId) ? "active" : ""}
            onClick={() => {
              onMoveCourse(activeMoveMenuCourse, null);
              closeCourseMoveMenu();
            }}
          >
            未分区
          </button>
          {sortByOrderThenUpdated(sections).map((sectionOption) => (
            <button
              key={sectionOption.id}
              type="button"
              role="menuitem"
              className={activeMoveMenuCourse.sectionId === sectionOption.id ? "active" : ""}
              onClick={() => {
                onMoveCourse(activeMoveMenuCourse, sectionOption.id);
                closeCourseMoveMenu();
              }}
            >
              {sectionOption.name}
            </button>
          ))}
        </div>
      ) : null}
      {activeContextMenuCourse && courseContextMenuAnchor ? (
        <div
          className="course-context-menu"
          role="menu"
          aria-label={`${activeContextMenuCourse.name} 操作`}
          style={{ left: courseContextMenuAnchor.left, top: courseContextMenuAnchor.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyCoursePath(activeContextMenuCourse)}
          >
            <Copy size={14} />
            <span>{courseContextMenuAnchor.copied ? "已复制路径" : "复制路径"}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
