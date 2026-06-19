# Course Module

## Scope

Course owns the left knowledge-base sidebar, course sections, course selection, section collapse state, and course/section drag ordering.

Current files:

- `CourseSidebar.tsx`: sidebar UI, search, section grouping, drag/drop, and course actions.
- `courseService.ts`: renderer-facing wrapper around preload course APIs.
- `courseTypes.ts`: shared course, section, command, and sync-status types.

## Boundaries

- Renderer code must not read or write MySQL directly.
- New course and section writes must use command-style IPC through `courseApi`.
- `courses:save` exists only for old compatibility and should not be the default path for new UI.
- Course UI must not know mind-map editor internals or document editor internals.
- `courses.json` is a local mirror and fallback, not the source of truth when MySQL is available.

## User Flow

1. App shell loads the course store through `courseApi.load`.
2. User creates, renames, moves, reorders, selects, or deletes a course or section.
3. The action calls a dedicated IPC command through `courseApi`.
4. Main process writes MySQL first, mirrors to local state, or records a pending operation if MySQL is unavailable.
5. The sidebar shows the latest store and a plain-language sync state.

## Extension Rules

- Add course-related UI here instead of expanding `src/renderer/main.tsx`.
- Add a typed service method before wiring a new sidebar action.
- Drag ordering must keep using `courses:reorder` and `course-sections:reorder`.
- Do not add editor snapshot, asset, AI, or export data to course records.
