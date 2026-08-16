import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express, { Express } from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { authenticate } from "../src/auth/authGuard.js";
import { requireRole } from "../src/auth/requireRole.js";
import { parseFilterParams } from "../src/router/utils/parseFilterParams.js";
import { MongooseDriver } from "../src/database/Mongo/index.js";
import { launchBackend } from "../src/server/launchBackend.js";
import { JsonDriver } from "../src/database/Json/index.js";

const TEST_DIR = path.join(__dirname, "branch-test-data");

describe("Branch Coverage Tests", () => {
    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    // =========================================================================
    // 1. authGuard & requireRole Branch Edges
    // =========================================================================
    describe("Auth Guard & Require Role Branches", () => {
        it("hits requireRole without authenticated user (req.user = undefined)", async () => {
            const app = express();
            app.get("/admin-test", requireRole("admin"), (_req, res) =>
                res.send("ok"),
            );

            const res = await request(app).get("/admin-test");
            expect(res.status).toBe(401);
            expect(res.body.error).toContain("Authentication required");
        });

        it('hits requireRole with user lacking explicit role (defaults to "user")', async () => {
            const app = express();
            app.use((req, _res, next) => {
                // req.user has NO role property
                req.user = { id: "123", username: "norole" } as any;
                next();
            });
            app.get("/admin-only", requireRole("admin"), (_req, res) =>
                res.send("ok"),
            );
            app.get("/user-only", requireRole("user"), (_req, res) =>
                res.send("ok"),
            );

            const adminRes = await request(app).get("/admin-only");
            expect(adminRes.status).toBe(403);

            const userRes = await request(app).get("/user-only");
            expect(userRes.status).toBe(200);
        });
    });

    // =========================================================================
    // 2. parseFilterParams Branch Edges
    // =========================================================================
    describe("parseFilterParams Branches", () => {
        it("handles empty, nullish, or primitive query inputs", () => {
            expect(parseFilterParams(undefined as any)).toEqual({});
            expect(parseFilterParams(null as any)).toEqual({});
            expect(parseFilterParams({})).toEqual({});
        });

        it("handles array values and nested stringified objects in filter params", () => {
            const query = {
                tags: ["tech", "news"],
                title: "sample",
                limit: "10",
                sort: "name",
            };
            const result = parseFilterParams(query);
            expect(result.tags).toEqual(["tech", "news"]);
            expect(result.title).toBe("sample");
            expect(result).not.toHaveProperty("limit");
        });
    });

    // =========================================================================
    // 3. MongooseDriver Branch Edges
    // =========================================================================
    describe("MongooseDriver Connection & Disconnect Branches", () => {
        it("handles connect, disconnect, and adapter reuse branches", async () => {
            const mongoServer = await MongoMemoryServer.create();
            const driver = new MongooseDriver(mongoServer.getUri());

            // 1. Initial connect
            await driver.connect();

            // 2. Secondary connect (should hit branch: already connected)
            await driver.connect();

            // 3. Get adapter with fallback dynamic model creation
            const dynamicAdapter = driver.getAdapter("DynamicCollection");
            expect(dynamicAdapter).toBeDefined();

            // 4. Disconnect
            await driver.disconnect?.();
            await mongoServer.stop();
        });
    });

    // =========================================================================
    // 4. launchBackend Branch Edges
    // =========================================================================
    describe("launchBackend Branch Options", () => {
        it("boots with cors=false, custom onReady, and custom apiPrefix formatting", async () => {
            let readyCalled = false;

            const app = await launchBackend({
                port: 8999,
                cors: false, // Hits `cors === false` branch
                apiPrefix: "api/v2/", // Hits prefix normalization branch
                driver: new JsonDriver(TEST_DIR),
                onReady: (_port) => {
                    readyCalled = true; // Hits custom onReady callback branch
                },
            });

            expect(readyCalled).toBe(true);

            const healthRes = await request(app).get("/api/v2/health");
            expect(healthRes.status).toBe(200);
        });

        it("triggers global error handling middleware branch", async () => {
            const app = await launchBackend({
                driver: new JsonDriver(TEST_DIR),
                resources: {
                    faulty: {
                        middleware: {
                            all: [
                                () => {
                                    throw new Error("Boom!");
                                },
                            ],
                        },
                    },
                },
            });

            const res = await request(app).get("/api/faulty");
            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Boom!");
        });

        it("covers MongooseDriver connect, disconnect, already-connected, and missing-URI branches", async () => {
            const mongoServer = await MongoMemoryServer.create();
            const driver = new MongooseDriver(mongoServer.getUri());

            // 1. Initial connect
            await driver.connect();

            // 2. Already-connected branch (readyState !== 0)
            await driver.connect();

            // 3. Adapter creation with auto-generated schema
            const autoAdapter = driver.getAdapter("Dynamo");
            expect(autoAdapter).toBeDefined();

            // 4. Clean disconnect
            await driver.disconnect();

            // 5. Missing URI when disconnected branch
            const noUriDriver = new MongooseDriver();
            await expect(noUriDriver.connect()).rejects.toThrow(
                /MongoDB URI was not provided/,
            );

            await mongoServer.stop();
        });
    });
});
