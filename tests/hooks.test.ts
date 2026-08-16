import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { createResourceRouter } from "../src/router/createResourceRouter.js";
import { JsonDbAdapter } from "../src/database/Json/index.js";
import type { DatabaseAdapter } from "../src/database/types.js";

// Mock in-memory DB Adapter for isolated testing
class InMemoryAdapter implements DatabaseAdapter {
    private records: Map<string, any> = new Map();
    private idCounter = 1;

    async find(options: any = {}): Promise<any[]> {
        let items = Array.from(this.records.values());
        if (options.filter) {
            items = items.filter((item) =>
                Object.entries(options.filter).every(
                    ([key, val]) => item[key] === val,
                ),
            );
        }
        if (options.skip) {
            items = items.slice(options.skip);
        }
        if (options.limit) {
            items = items.slice(0, options.limit);
        }
        return items;
    }

    async findById(id: string): Promise<any | null> {
        return this.records.get(id) || null;
    }

    async create(data: any): Promise<any> {
        const id = String(this.idCounter++);
        const record = { id, ...data };
        this.records.set(id, record);
        return record;
    }

    async update(id: string, data: any): Promise<any | null> {
        const existing = this.records.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...data, id };
        this.records.set(id, updated);
        return updated;
    }

    async delete(id: string): Promise<boolean> {
        return this.records.delete(id);
    }

    async count(filter: any = {}): Promise<number> {
        const items = await this.find({ filter });
        return items.length;
    }

    seed(items: any[]) {
        this.records.clear();
        for (const item of items) {
            this.records.set(item.id, item);
        }
    }
}

describe("Resource Lifecycle Hooks", () => {
    let adapter: InMemoryAdapter;
    let app: express.Express;

    const testSchema = z.object({
        title: z.string().min(2),
        content: z.string(),
        authorId: z.string().optional(),
        slug: z.string().optional(),
        tenantId: z.string().optional(),
        isSecret: z.boolean().optional(),
        views: z.number().optional(),
    });

    beforeEach(() => {
        adapter = new InMemoryAdapter();
        app = express();
        app.use(express.json());
    });

    // ----------------------------------------------------
    // 1. CREATE HOOKS
    // ----------------------------------------------------
    describe("create hooks (beforeCreate / afterCreate)", () => {
        it("should mutate payload in beforeCreate and invoke afterCreate side-effect", async () => {
            const sideEffectTracker = vi.fn();

            const router = createResourceRouter({
                adapter,
                schema: testSchema,
                hooks: {
                    beforeCreate: async ({ data }) => {
                        return {
                            ...data,
                            slug: data.title.toLowerCase().replace(/\s+/g, "-"),
                            authorId: "user-123",
                        };
                    },
                    afterCreate: async ({ record }) => {
                        sideEffectTracker(record.id, record.slug);
                    },
                },
            });

            app.use("/articles", router);

            const res = await request(app)
                .post("/articles")
                .send({ title: "Hello World", content: "Great content" });

            expect(res.status).toBe(201);
            expect(res.body.data.slug).toBe("hello-world");
            expect(res.body.data.authorId).toBe("user-123");
            expect(sideEffectTracker).toHaveBeenCalledWith(
                res.body.data.id,
                "hello-world",
            );
        });

        it("should abort creation if beforeCreate throws an error", async () => {
            const router = createResourceRouter({
                adapter,
                schema: testSchema,
                hooks: {
                    beforeCreate: async () => {
                        throw new Error("Blocked by pre-creation rule");
                    },
                },
            });

            app.use("/articles", router);

            // Add Express error-handling middleware
            app.use((err: any, _req: any, res: any, _next: any) => {
                res.status(500).json({ success: false, error: err.message });
            });

            const res = await request(app)
                .post("/articles")
                .send({ title: "Sample Title", content: "Content" });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe("Blocked by pre-creation rule");
        });
    });

    // ----------------------------------------------------
    // 2. READ HOOKS (FIND)
    // ----------------------------------------------------
    describe("list read hooks (beforeFind / afterFind)", () => {
        beforeEach(() => {
            adapter.seed([
                {
                    id: "1",
                    title: "Public Alpha",
                    content: "Visible",
                    tenantId: "org-a",
                    secretField: "1234",
                },
                {
                    id: "2",
                    title: "Public Beta",
                    content: "Visible",
                    tenantId: "org-b",
                    secretField: "5678",
                },
                {
                    id: "3",
                    title: "Org A Special",
                    content: "Visible",
                    tenantId: "org-a",
                    secretField: "9999",
                },
            ]);
        });

        it("should apply tenant filter in beforeFind and strip fields in afterFind", async () => {
            const router = createResourceRouter({
                adapter,
                hooks: {
                    beforeFind: async ({ filter }) => {
                        // Tenant isolation: restrict results to org-a
                        return {
                            filter: { ...filter, tenantId: "org-a" },
                        };
                    },
                    afterFind: async ({ records }) => {
                        // Mask sensitive fields
                        return records.map(({ secretField, ...safe }) => safe);
                    },
                },
            });

            app.use("/articles", router);

            const res = await request(app).get("/articles");

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(
                res.body.data.every((item: any) => item.tenantId === "org-a"),
            ).toBe(true);
            expect(res.body.data[0].secretField).toBeUndefined();
        });
    });

    // ----------------------------------------------------
    // 3. READ HOOKS (FIND BY ID)
    // ----------------------------------------------------
    describe("single read hooks (beforeFindById / afterFindById)", () => {
        beforeEach(() => {
            adapter.seed([
                {
                    id: "doc-1",
                    title: "Original Title",
                    content: "Text",
                    hiddenToken: "secret-token",
                },
            ]);
        });

        it("should transform record in afterFindById", async () => {
            const router = createResourceRouter({
                adapter,
                hooks: {
                    afterFindById: async ({ record }) => {
                        const { hiddenToken, ...safe } = record;
                        return { ...safe, viewCountComputed: 42 };
                    },
                },
            });

            app.use("/articles", router);

            const res = await request(app).get("/articles/doc-1");

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe("doc-1");
            expect(res.body.data.viewCountComputed).toBe(42);
            expect(res.body.data.hiddenToken).toBeUndefined();
        });
    });

    // ----------------------------------------------------
    // 4. UPDATE HOOKS
    // ----------------------------------------------------
    describe("update hooks (beforeUpdate / afterUpdate)", () => {
        beforeEach(() => {
            adapter.seed([
                {
                    id: "item-1",
                    title: "Old Title",
                    content: "Old Content",
                    version: 1,
                },
            ]);
        });

        it("should modify payload during PATCH in beforeUpdate and trigger afterUpdate", async () => {
            const afterUpdateSpy = vi.fn();

            const router = createResourceRouter({
                adapter,
                schema: testSchema,
                hooks: {
                    beforeUpdate: async ({ data, id }) => {
                        return {
                            ...data,
                            lastModified: "2026-08-16",
                            updatedRecordId: id,
                        };
                    },
                    afterUpdate: async ({ record }) => {
                        afterUpdateSpy(record.id, record.title);
                    },
                },
            });

            app.use("/articles", router);

            const res = await request(app)
                .patch("/articles/item-1")
                .send({ title: "Updated Title" });

            expect(res.status).toBe(200);
            expect(res.body.data.title).toBe("Updated Title");
            expect(res.body.data.lastModified).toBe("2026-08-16");
            expect(afterUpdateSpy).toHaveBeenCalledWith(
                "item-1",
                "Updated Title",
            );
        });
    });

    // ----------------------------------------------------
    // 5. DELETE HOOKS
    // ----------------------------------------------------
    describe("delete hooks (beforeDelete / afterDelete)", () => {
        beforeEach(() => {
            adapter.seed([
                { id: "del-1", title: "To Be Deleted", content: "Bye" },
                {
                    id: "protected-root",
                    title: "Protected",
                    content: "Cannot delete",
                },
            ]);
        });

        it("should block deletion in beforeDelete when rule fails", async () => {
            const router = createResourceRouter({
                adapter,
                hooks: {
                    beforeDelete: async ({ id }) => {
                        if (id === "protected-root") {
                            const err = new Error(
                                "Protected root document cannot be deleted.",
                            );
                            (err as any).status = 403;
                            throw err;
                        }
                    },
                },
            });

            app.use("/articles", router);
            app.use((err: any, _req: any, res: any, _next: any) => {
                res.status(err.status || 500).json({
                    success: false,
                    error: err.message,
                });
            });

            const res = await request(app).delete("/articles/protected-root");

            expect(res.status).toBe(403);
            expect(res.body.error).toContain("Protected root document");

            // Verify the record was not deleted
            const checkRecord = await adapter.findById("protected-root");
            expect(checkRecord).not.toBeNull();
        });

        it("should call afterDelete after successful deletion", async () => {
            const afterDeleteSpy = vi.fn();

            const router = createResourceRouter({
                adapter,
                hooks: {
                    afterDelete: async ({ id }) => {
                        afterDeleteSpy(id);
                    },
                },
            });

            app.use("/articles", router);

            const res = await request(app).delete("/articles/del-1");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(afterDeleteSpy).toHaveBeenCalledWith("del-1");

            const checkRecord = await adapter.findById("del-1");
            expect(checkRecord).toBeNull();
        });
    });
});
