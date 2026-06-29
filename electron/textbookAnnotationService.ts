import { createAppError } from "./appErrors.js";
import {
  deleteTextbookAnnotationFromMysql,
  normalizeTextbookAnnotation,
  readTextbookAnnotationsFromMysql,
  readTextbookStoreFromMysql,
  writeTextbookAnnotationToMysql,
  type TextbookMysqlRuntime
} from "./textbookStore.js";

type TextbookScope = {
  courseId: string;
  mindMapId: string;
};

type TextbookAnnotationScope = TextbookScope & {
  textbookId: string;
  pageStart: number;
  pageEnd: number;
};

type TextbookAnnotationServiceDependencies = {
  getMysqlRuntime: () => Promise<TextbookMysqlRuntime>;
  normalizeTextbookScope: (input: unknown) => TextbookScope;
  normalizeId: (value: unknown, label: string, fallback?: string) => string;
};

function normalizePageBoundary(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function createTextbookAnnotationService(dependencies: TextbookAnnotationServiceDependencies) {
  const normalizeAnnotationScope = (input: unknown): TextbookAnnotationScope => {
    const request = input && typeof input === "object"
      ? input as { assetId?: unknown; textbookId?: unknown; courseId?: unknown; mindMapId?: unknown; pageStart?: unknown; pageEnd?: unknown }
      : {};
    const scope = dependencies.normalizeTextbookScope(request);
    const textbookId = dependencies.normalizeId(request.textbookId ?? request.assetId, "Textbook asset id");
    return {
      ...scope,
      textbookId,
      pageStart: normalizePageBoundary(request.pageStart),
      pageEnd: normalizePageBoundary(request.pageEnd)
    };
  };

  const ensureAnnotationAsset = async (runtime: TextbookMysqlRuntime, scope: TextbookAnnotationScope) => {
    const store = await readTextbookStoreFromMysql(runtime, scope);
    if (!store.assets.some((asset) => asset.id === scope.textbookId)) {
      throw createAppError("APP_INVALID_ARGUMENT", "教材没有同步到数据库，批注没有保存。");
    }
  };

  const load = async (input: unknown) => {
    const scope = normalizeAnnotationScope(input);
    try {
      const runtime = await dependencies.getMysqlRuntime();
      await ensureAnnotationAsset(runtime, scope);
      const annotations = await readTextbookAnnotationsFromMysql(runtime, scope);
      return { databaseAvailable: true, annotations };
    } catch (error) {
      console.warn("Textbook annotation database read failed. Returning empty database-owned state.", error);
      return { databaseAvailable: false, annotations: [] };
    }
  };

  const save = async (input: unknown) => {
    const request = input && typeof input === "object"
      ? input as { annotation?: unknown; assetId?: unknown; textbookId?: unknown; courseId?: unknown; mindMapId?: unknown }
      : {};
    const scope = normalizeAnnotationScope(request);
    const annotation = normalizeTextbookAnnotation(request.annotation ?? request, scope);
    if (!annotation) {
      throw createAppError("APP_INVALID_ARGUMENT", "PDF 批注内容无效。");
    }

    const runtime = await dependencies.getMysqlRuntime();
    await ensureAnnotationAsset(runtime, scope);
    return {
      databaseAvailable: true,
      annotation: await writeTextbookAnnotationToMysql(runtime, annotation, scope)
    };
  };

  const remove = async (input: unknown) => {
    const request = input && typeof input === "object"
      ? input as { annotationId?: unknown; id?: unknown; assetId?: unknown; textbookId?: unknown; courseId?: unknown; mindMapId?: unknown }
      : {};
    const scope = normalizeAnnotationScope(request);
    const annotationId = dependencies.normalizeId(request.annotationId ?? request.id, "Textbook annotation id");
    const runtime = await dependencies.getMysqlRuntime();
    await ensureAnnotationAsset(runtime, scope);
    await deleteTextbookAnnotationFromMysql(runtime, { ...scope, annotationId });
    return { databaseAvailable: true, annotationId };
  };

  return { load, save, remove };
}
