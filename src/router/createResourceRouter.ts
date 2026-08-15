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

export interface ResourceRouterOptions {
    adapter: DatabaseAdapter;
    schema?: SchemaValidator | undefined;
    middleware?: RouteMiddleware | undefined;
}

export function createResourceRouter(options: ResourceRouterOptions): Router {
    const { adapter, schema, middleware } = options;
    const router = Router();

    if (middleware?.all && middleware.all.length > 0) {
        router.use(...middleware.all);
    }

    // GET / -> List records
    router.get("/", ...(middleware?.get || []), fetchRecordHandler(adapter));

    // GET /:id -> Single record
    router.get(
        "/:id",
        ...(middleware?.getById || []),
        fetchRecordByIdHandler(adapter),
    );

    // POST / -> Create record
    router.post(
        "/",
        ...(middleware?.create || []),
        createRecordHandler(adapter, schema),
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
        updateRecordHandler(adapter, schema, true),
    );

    // PUT /:id -> Replace record
    router.put(
        "/:id",
        ...putMiddleware,
        updateRecordHandler(adapter, schema, false),
    );

    // DELETE /:id -> Delete record
    router.delete(
        "/:id",
        ...(middleware?.delete || []),
        deleteRecordHandler(adapter),
    );

    return router;
}

function fetchRecordHandler(adapter: DatabaseAdapter) {
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

            // 1. Resolve limit (ensure positive integer if present)
            const limit =
                rawLimit !== undefined && !isNaN(rawLimit)
                    ? Math.max(1, rawLimit)
                    : undefined;

            // 2. Resolve page and skip
            let skip: number | undefined;
            let page: number | undefined;

            if (rawSkip !== undefined && !isNaN(rawSkip)) {
                // Case A: User explicitly provided `skip`
                skip = Math.max(0, rawSkip);
                // Infer current page if limit is present
                page = limit ? Math.floor(skip / limit) + 1 : 1;
            } else if (rawPage !== undefined && !isNaN(rawPage)) {
                // Case B: User provided `page`
                page = Math.max(1, rawPage);
                const effectiveLimit = limit ?? 10; // Default limit when page is requested
                skip = (page - 1) * effectiveLimit;
            }

            // 3. Parse sorting and filtering
            const sort = parseSortParam(req.query.sort as string | undefined);
            const filter = parseFilterParams(req.query);

            // 4. Fetch data (and total count only if pagination parameters are present)
            const isPaginated =
                limit !== undefined || skip !== undefined || page !== undefined;

            if (isPaginated) {
                const effectiveLimit = limit ?? 10;
                const effectiveSkip = skip ?? 0;
                const effectivePage = page ?? 1;

                const [data, totalRecords] = await Promise.all([
                    adapter.find({
                        filter,
                        sort,
                        limit: effectiveLimit,
                        skip: effectiveSkip,
                    } as QueryOptions),
                    adapter.count(filter),
                ]);

                const totalPages = Math.ceil(totalRecords / effectiveLimit);

                return res.status(200).json({
                    success: true,
                    pagination: {
                        totalRecords,
                        page: effectivePage,
                        limit: effectiveLimit,
                        skip: effectiveSkip,
                        totalPages,
                        hasNextPage: effectivePage < totalPages,
                        hasPrevPage: effectivePage > 1,
                    },
                    data,
                });
            }

            // 5. Unpaginated fallback (no limit/page/skip in query)
            const data = await adapter.find({ filter, sort } as QueryOptions);

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

function fetchRecordByIdHandler(adapter: DatabaseAdapter) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const record = await adapter.findById(id as string);

            if (!record) {
                return res.status(404).json({
                    success: false,
                    error: `Record with id '${id}' not found.`,
                });
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

            const newRecord = await adapter.create(payload);

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

            const updated = await adapter.update(id as string, payload);

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    error: `Record with id '${id}' not found.`,
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

function deleteRecordHandler(adapter: DatabaseAdapter) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const success = await adapter.delete(id as string);

            if (!success) {
                return res.status(404).json({
                    success: false,
                    error: `Record with id '${id}' not found.`,
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
