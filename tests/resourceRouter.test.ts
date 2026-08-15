import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express, { Express, Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

import { JsonDbAdapter } from "../src/database/JsonDbAdapter.js";
import { createResourceRouter } from "../src/router/createResourceRouter.js";

const TEST_DIR = path.join(__dirname, "router-test-data");

describe("Resource Router Integration Tests", () => {
    let app: Express;
    let adapter: JsonDbAdapter;
    const executionTrail: string[] = [];

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });

        executionTrail.length = 0;
        adapter = new JsonDbAdapter(path.join(TEST_DIR, "products.json"));
        app = express();
        app.use(express.json());

        // Setup router with schema and middleware tracking
        const router = createResourceRouter({
            adapter,
            schema: z.object({
                name: z.string().min(2),
                price: z.number().positive(),
                inStock: z.boolean().default(true),
            }),
            middleware: {
                all: [
                    (req: Request, _res: Response, next: NextFunction) => {
                        executionTrail.push("all-middleware");
                        next();
                    },
                ],
                create: [
                    (req: Request, _res: Response, next: NextFunction) => {
                        executionTrail.push("create-middleware");
                        next();
                    },
                ],
                update: [
                    (req: Request, _res: Response, next: NextFunction) => {
                        executionTrail.push("update-middleware");
                        next();
                    },
                ],
                patch: [
                    (req: Request, _res: Response, next: NextFunction) => {
                        executionTrail.push("patch-middleware");
                        next();
                    },
                ],
            },
        });

        app.use("/api/products", router);
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it("POST / creates a record and runs all + create middleware in order", async () => {
        const res = await request(app)
            .post("/api/products")
            .send({ name: "Keyboard", price: 79 });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe("Keyboard");
        expect(res.body.data.inStock).toBe(true); // Default applied by Zod

        // Check execution order: all -> create
        expect(executionTrail).toEqual(["all-middleware", "create-middleware"]);
    });

    it("POST / fails schema validation on bad payloads", async () => {
        const res = await request(app)
            .post("/api/products")
            .send({ name: "K", price: -10 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("GET / with page/limit returns pagination metadata", async () => {
        // Seed 15 records
        for (let i = 1; i <= 15; i++) {
            await adapter.create({ name: `Product ${i}`, price: i * 10 });
        }

        const res = await request(app).get("/api/products?page=2&limit=5");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.pagination).toEqual({
            totalRecords: 15,
            page: 2,
            limit: 5,
            skip: 5,
            totalPages: 3,
            hasNextPage: true,
            hasPrevPage: true,
        });
        expect(res.body.data.length).toBe(5);
    });

    it("PATCH /:id runs all + update + patch middleware in sequence", async () => {
        const item = await adapter.create({ name: "Mouse", price: 30 });
        executionTrail.length = 0; // Reset tracking

        const res = await request(app)
            .patch(`/api/products/${item.id}`)
            .send({ price: 35 });

        expect(res.status).toBe(200);
        expect(res.body.data.price).toBe(35);
        expect(executionTrail).toEqual([
            "all-middleware",
            "update-middleware",
            "patch-middleware",
        ]);
    });

    it("DELETE /:id removes item or returns 404", async () => {
        const item = await adapter.create({ name: "To Delete", price: 10 });

        const deleteRes = await request(app).delete(`/api/products/${item.id}`);
        expect(deleteRes.status).toBe(200);

        const notFoundRes = await request(app).delete("/api/products/fake-id");
        expect(notFoundRes.status).toBe(404);
    });
});
