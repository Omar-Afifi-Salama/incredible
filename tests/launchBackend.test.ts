import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { Express } from "express";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

import { launchBackend } from "../src/server/launchBackend.js";
import { defineResource } from "../src/server/defineResource.js";
import { JsonDriver } from "../src/database/JsonDriver.js";

const TEST_DIR = path.join(__dirname, "launch-test-data");

describe("launchBackend Orchestration Tests", () => {
    let app: Express;

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });

        // Boot backend with custom prefix and multiple resources
        app = await launchBackend({
            apiPrefix: "/api/v1",
            driver: new JsonDriver(TEST_DIR),
            resources: {
                notes: defineResource(),
                tasks: defineResource({
                    schema: z.object({ title: z.string().min(1) }),
                }),
            },
        });
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it("GET /api/v1/health returns status ok", async () => {
        const res = await request(app).get("/api/v1/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
        expect(res.body.uptime).toBeDefined();
    });

    it("auto-mounts all resources defined in options", async () => {
        // 1. Create a note on /notes
        const noteRes = await request(app)
            .post("/api/v1/notes")
            .send({ content: "Quick note" });
        expect(noteRes.status).toBe(201);

        // 2. Create a task on /tasks
        const taskRes = await request(app)
            .post("/api/v1/tasks")
            .send({ title: "Important task" });
        expect(taskRes.status).toBe(201);

        // 3. Fetch notes list
        const listRes = await request(app).get("/api/v1/notes");
        expect(listRes.status).toBe(200);
        expect(listRes.body.data.length).toBe(1);
        expect(listRes.body.data[0].content).toBe("Quick note");
    });
});
