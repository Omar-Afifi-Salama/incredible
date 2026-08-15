import { Router } from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { DatabaseAdapter, QueryOptions } from "../database/types.js";
import { parseSortParam } from "./utils/parseSortParam.js";
import { parseFilterParams } from "./utils/parseFilterParams.js";

export interface RouteMiddleware {
    all?: RequestHandler[];
    get?: RequestHandler[];
    getById?: RequestHandler[];
    create?: RequestHandler[];
    update?: RequestHandler[];
    patch?: RequestHandler[];
    put?: RequestHandler[];
    delete?: RequestHandler[];
}

export interface SchemaValidator {
    safeParse?: (data: unknown) => {
        success: boolean;
        data?: any;
        error?: any;
    };
    parse?: (data: unknown) => any;
}

// CRUD hooks
export interface HookContext<T = any> {
    req: Request;
    user?: any;
    data: T;
    id?: string;
}

export interface AfterHookContext<T = any> {
    req: Request;
    user?: any;
    record: T;
    id?: string;
}

// FIND hooks
export interface BeforeFindContext {
    req: Request;
    user?: any | undefined;
    filter: Record<string, any>;
    sort?: Record<string, 1 | -1> | undefined;
    pagination?:
        | {
              limit?: number | undefined;
              skip?: number | undefined;
              page?: number | undefined;
          }
        | undefined;
}

export interface AfterFindContext<T = any> {
    req: Request;
    user?: any | undefined;
    records: T[];
    totalRecords?: number | undefined;
}

export interface BeforeFindByIdContext {
    req: Request;
    user?: any | undefined;
    id: string;
}

export interface AfterFindByIdContext<T = any> {
    req: Request;
    user?: any | undefined;
    id: string;
    record: T;
}

// hooks API
export interface ResourceHooks<T = any> {
    // List Read Hooks
    beforeFind?: (ctx: BeforeFindContext) => Promise<{
        filter?: Record<string, any>;
        sort?: Record<string, 1 | -1>;
    } | void> | void;
    afterFind?: (ctx: AfterFindContext<T>) => Promise<T[] | void> | T[] | void;

    // Single Record Read Hooks
    beforeFindById?: (
        ctx: BeforeFindByIdContext,
    ) => Promise<string | void> | string | void;
    afterFindById?: (
        ctx: AfterFindByIdContext<T>,
    ) => Promise<T | void> | T | void;

    // Pre-CRUD hooks (can mutate data or throw errors)
    beforeCreate?: (ctx: HookContext<T>) => Promise<T | void> | T | void;
    beforeUpdate?: (ctx: HookContext<T>) => Promise<T | void> | T | void;
    beforeDelete?: (ctx: {
        req: Request;
        user?: any;
        id: string;
    }) => Promise<void> | void;

    // Post-CRUD hooks (for side-effects like logging or cache invalidation)
    afterCreate?: (ctx: AfterHookContext<T>) => Promise<void> | void;
    afterUpdate?: (ctx: AfterHookContext<T>) => Promise<void> | void;
    afterDelete?: (ctx: {
        req: Request;
        user?: any;
        id: string;
    }) => Promise<void> | void;
}

export interface ResourceRouterOptions {
    adapter: DatabaseAdapter;
    schema?: SchemaValidator | undefined;
    middleware?: RouteMiddleware | undefined;
    hooks?: ResourceHooks | undefined;
}

export function createResourceRouter(options: ResourceRouterOptions): Router {
    const { adapter, schema, middleware, hooks } = options;
    const router = Router();

    if (middleware?.all && middleware.all.length > 0) {
        router.use(...middleware.all);
    }

    // GET / -> List records
    router.get(
        "/",
        ...(middleware?.get || []),
        fetchRecordHandler(adapter, hooks),
    );

    // GET /:id -> Single record
    router.get(
        "/:id",
        ...(middleware?.getById || []),
        fetchRecordByIdHandler(adapter, hooks),
    );

    // POST / -> Create record
    router.post(
        "/",
        ...(middleware?.create || []),
        createRecordHandler(adapter, schema, hooks),
    );

    // Base shared update middleware
    const baseUpdateMiddleware = middleware?.update || [];

    // Combined pipelines
    const patchMiddleware = [
        ...baseUpdateMiddleware,
        ...(middleware?.patch || []),
    ];
    const putMiddleware = [...baseUpdateMiddleware, ...(middleware?.put || [])];

    // PATCH /:id -> Update record
    router.patch(
        "/:id",
        ...patchMiddleware,
        updateRecordHandler(adapter, schema, hooks, true),
    );

    // PUT /:id -> Replace record
    router.put(
        "/:id",
        ...putMiddleware,
        updateRecordHandler(adapter, schema, hooks, false),
    );

    // DELETE /:id -> Delete record
    router.delete(
        "/:id",
        ...(middleware?.delete || []),
        deleteRecordHandler(adapter, hooks),
    );

    return router;
}

function fetchRecordHandler(adapter: DatabaseAdapter, hooks?: ResourceHooks) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const rawLimit = req.query.limit
                ? parseInt(req.query.limit as string, 10)
                : undefined;
            const rawSkip = req.query.skip
                ? parseInt(req.query.skip as string, 10)
                : undefined;
            const rawPage = req.query.page
                ? parseInt(req.query.page as string, 10)
                : undefined;

            // 1. Resolve limit
            const limit =
                rawLimit !== undefined && !isNaN(rawLimit)
                    ? Math.max(1, rawLimit)
                    : undefined;

            // 2. Resolve page and skip
            let skip: number | undefined;
            let page: number | undefined;

            if (rawSkip !== undefined && !isNaN(rawSkip)) {
                skip = Math.max(0, rawSkip);
                page = limit ? Math.floor(skip / limit) + 1 : 1;
            } else if (rawPage !== undefined && !isNaN(rawPage)) {
                page = Math.max(1, rawPage);
                const effectiveLimit = limit ?? 10;
                skip = (page - 1) * effectiveLimit;
            }

            // 3. Parse sorting and filtering
            let sort = parseSortParam(req.query.sort as string | undefined);
            let filter = parseFilterParams(req.query);

            // ==========================================
            // PRE-HOOK: beforeFind
            // ==========================================
            if (hooks?.beforeFind) {
                const hookResult = await hooks.beforeFind({
                    req,
                    user: req.user,
                    filter,
                    sort,
                    pagination: { limit, skip, page },
                });

                if (hookResult) {
                    if (hookResult.filter !== undefined)
                        filter = hookResult.filter;
                    if (hookResult.sort !== undefined) sort = hookResult.sort;
                }
            }

            // 4. Fetch data
            const isPaginated =
                limit !== undefined || skip !== undefined || page !== undefined;

            let data: any[];
            let totalRecords: number | undefined;
            let paginationMeta: Record<string, any> | undefined;

            if (isPaginated) {
                const effectiveLimit = limit ?? 10;
                const effectiveSkip = skip ?? 0;
                const effectivePage = page ?? 1;

                const [resultData, count] = await Promise.all([
                    adapter.find({
                        filter,
                        sort,
                        limit: effectiveLimit,
                        skip: effectiveSkip,
                    } as QueryOptions),
                    adapter.count(filter),
                ]);

                data = resultData;
                totalRecords = count;

                const totalPages = Math.ceil(totalRecords / effectiveLimit);
                paginationMeta = {
                    totalRecords,
                    page: effectivePage,
                    limit: effectiveLimit,
                    skip: effectiveSkip,
                    totalPages,
                    hasNextPage: effectivePage < totalPages,
                    hasPrevPage: effectivePage > 1,
                };
            } else {
                // 5. Unpaginated fallback
                data = await adapter.find({ filter, sort } as QueryOptions);
            }

            // POST-HOOK: afterFind
            if (hooks?.afterFind) {
                const transformed = await hooks.afterFind({
                    req,
                    user: req.user,
                    records: data,
                    totalRecords,
                });
                if (transformed !== undefined) {
                    data = transformed;
                }
            }

            if (isPaginated) {
                return res.status(200).json({
                    success: true,
                    pagination: paginationMeta,
                    data,
                });
            }

            return res.status(200).json({
                success: true,
                count: data.length,
                data,
            });
        } catch (error) {
            next(error);
        }
    };
}

function fetchRecordByIdHandler(
    adapter: DatabaseAdapter,
    hooks?: ResourceHooks,
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            let { id } = req.params;

            // PRE-HOOK: beforeFindById
            if (hooks?.beforeFindById) {
                const modifiedId = await hooks.beforeFindById({
                    req,
                    user: req.user,
                    id: id as string,
                });
                if (typeof modifiedId === "string") {
                    id = modifiedId;
                }
            }

            let record = await adapter.findById(id as string);

            if (!record) {
                return res.status(404).json({
                    success: false,
                    error: `Record with id '${id}' not found.`,
                });
            }

            // POST-HOOK: afterFindById
            if (hooks?.afterFindById) {
                const transformed = await hooks.afterFindById({
                    req,
                    user: req.user,
                    id: id as string,
                    record,
                });
                if (transformed !== undefined) {
                    record = transformed;
                }
            }

            return res.status(200).json({
                success: true,
                data: record,
            });
        } catch (error) {
            next(error);
        }
    };
}

function createRecordHandler(
    adapter: DatabaseAdapter,
    schema?: ResourceRouterOptions["schema"],
    hooks?: ResourceHooks,
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            let payload = req.body;

            if (schema?.safeParse) {
                const result = schema.safeParse(payload);
                if (!result.success) {
                    return res.status(400).json({
                        success: false,
                        error: "Validation failed",
                        details: result.error?.errors || result.error,
                    });
                }
                payload = result.data;
            }

            // Lifecycle Pre-Hook: beforeCreate
            if (hooks?.beforeCreate) {
                const hookResult = await hooks.beforeCreate({
                    req,
                    user: req.user,
                    data: payload,
                });
                if (hookResult !== undefined) {
                    payload = hookResult;
                }
            }

            const newRecord = await adapter.create(payload);

            // 4. Lifecycle Post-Hook: afterCreate
            if (hooks?.afterCreate) {
                await hooks.afterCreate({
                    req,
                    user: req.user,
                    record: newRecord,
                });
            }

            return res.status(201).json({
                success: true,
                data: newRecord,
            });
        } catch (error) {
            next(error);
        }
    };
}

function updateRecordHandler(
    adapter: DatabaseAdapter,
    schema?: ResourceRouterOptions["schema"],
    hooks?: ResourceHooks,
    isPatch: boolean = false,
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            let payload = req.body;

            if (schema) {
                const activeSchema =
                    isPatch &&
                    "partial" in schema &&
                    typeof (schema as any).partial === "function"
                        ? (schema as any).partial()
                        : schema;

                if (activeSchema?.safeParse) {
                    const result = activeSchema.safeParse(payload);
                    if (!result.success) {
                        return res.status(400).json({
                            success: false,
                            error: "Validation failed",
                            details: result.error?.errors || result.error,
                        });
                    }
                    payload = result.data;
                }
            }

            // Lifecycle Pre-Hook: beforeUpdate
            if (hooks?.beforeUpdate) {
                const hookResult = await hooks.beforeUpdate({
                    req,
                    user: req.user,
                    id: id as string,
                    data: payload,
                });
                if (hookResult !== undefined) {
                    payload = hookResult;
                }
            }

            const updated = await adapter.update(id as string, payload);

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    error: `Record with id '${id}' not found.`,
                });
            }

            // Lifecycle Post-Hook: afterUpdate
            if (hooks?.afterUpdate) {
                await hooks.afterUpdate({
                    req,
                    user: req.user,
                    id: id as string,
                    record: updated,
                });
            }

            return res.status(200).json({
                success: true,
                data: updated,
            });
        } catch (error) {
            next(error);
        }
    };
}

function deleteRecordHandler(adapter: DatabaseAdapter, hooks?: ResourceHooks) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;

            // Lifecycle Pre-Hook: beforeDelete
            if (hooks?.beforeDelete) {
                await hooks.beforeDelete({
                    req,
                    user: req.user,
                    id: id as string,
                });
            }

            const success = await adapter.delete(id as string);

            if (!success) {
                return res.status(404).json({
                    success: false,
                    error: `Record with id '${id}' not found.`,
                });
            }

            // Lifecycle Post-Hook: afterDelete
            if (hooks?.afterDelete) {
                await hooks.afterDelete({
                    req,
                    user: req.user,
                    id: id as string,
                });
            }

            return res.status(200).json({
                success: true,
                message: "Record deleted successfully.",
            });
        } catch (error) {
            next(error);
        }
    };
}
