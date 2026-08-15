import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { Express } from "express";
import fs from "fs/promises";
import path from "path";
import { launchBackend } from "../src/server/launchBackend.js";
import { JsonDriver } from "../src/database/JsonDriver.js";

const TEST_DIR = path.join(__dirname, "launch-full-test-data");

describe("launchBackend with full Auth config", () => {
    let app: Express;

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });

        app = await launchBackend({
            driver: new JsonDriver(TEST_DIR),
            auth: {
                jwtSecret: "jwt-sec",
                sessionSecret: "session-sec",
            },
        });
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it("initializes auth endpoints via launchBackend", async () => {
        const res = await request(app).post("/api/auth/register").send({
            username: "bootstrapped_user",
            password: "password123",
        });
        expect(res.status).toBe(201);
    });
});
