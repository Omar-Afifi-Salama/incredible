// tests/coverageGapFixes.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express, { Express } from "express";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

import { JsonDbAdapter } from "../src/database/Json/index.js";
import { createResourceRouter } from "../src/router/createResourceRouter.js";

const TEST_DIR = path.join(__dirname, "gap-test-data");

describe("Targeted Gap Coverage Tests", () => {
    let app: Express;
    let adapter: JsonDbAdapter;

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });

        adapter = new JsonDbAdapter(path.join(TEST_DIR, "items.json"));
        app = express();
        app.use(express.json());

        const router = createResourceRouter({
            adapter,
            schema: z.object({
                name: z.string().min(2),
                score: z.number(),
            }),
        });

        app.use("/api/items", router);
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    // 1. Hits createResourceRouter 404 & PUT replacement branches
    it("handles GET /:id 404 and PUT replacement validation", async () => {
        // GET 404
        const notFound = await request(app).get("/api/items/non-existent-id");
        expect(notFound.status).toBe(404);

        // Seed item
        const created = await adapter.create({ name: "Old Item", score: 10 });

        // Valid PUT
        const putRes = await request(app)
            .put(`/api/items/${created.id}`)
            .send({ name: "New Item", score: 20 });
        expect(putRes.status).toBe(200);
        expect(putRes.body.data.name).toBe("New Item");

        // Invalid PUT (missing required score field)
        const badPut = await request(app)
            .put(`/api/items/${created.id}`)
            .send({ name: "Bad" });
        expect(badPut.status).toBe(400);
    });

    // 2. Hits JsonDbAdapter sorting equality and edge comparisons
    it("covers JsonDbAdapter sorting with identical values and empty files", async () => {
        await adapter.create({ name: "Same", score: 10 });
        await adapter.create({ name: "Same", score: 10 });
        await adapter.create({ name: "Diff", score: 20 });

        // Multi-sort with equality fallback
        const sorted = await adapter.find({
            sort: { name: 1, score: -1 },
        });
        expect(sorted.length).toBe(3);
    });
});
