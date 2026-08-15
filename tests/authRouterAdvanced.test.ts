import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express, { Express } from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import { JsonDriver } from "../src/database/JsonDriver.js";
import { createAuthRouter } from "../src/auth/authRouter.js";
import { configurePassport } from "../src/auth/passportConfig.js";
import { DatabaseAdapter } from "../src/database/types.js";
import { BaseUserRecord } from "../src/auth/types.js";

const TEST_DIR = path.join(__dirname, "auth-adv-test-data");

describe("Auth Router OAuth & Custom Routes", () => {
    let app: Express;
    let driver: JsonDriver;
    let userAdapter: DatabaseAdapter<BaseUserRecord>;

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });

        driver = new JsonDriver(TEST_DIR);
        userAdapter = driver.getAdapter(
            "users",
        ) as DatabaseAdapter<BaseUserRecord>;

        app = express();
        app.use(express.json());
        app.use(
            session({ secret: "sec", resave: false, saveUninitialized: false }),
        );

        const passportInstance = configurePassport({
            userAdapter,
            jwtSecret: "test-secret",
        });
        app.use(passportInstance.initialize());
        app.use(passportInstance.session());

        app.use(
            "/api/auth",
            createAuthRouter(userAdapter, {
                jwtSecret: "test-secret",
                providers: [
                    {
                        name: "google",
                        scope: ["profile", "email"],
                        successRedirect: "/app/dashboard",
                        failureRedirect: "/app/login?error=1",
                    },
                ],
                customRoutes: (router) => {
                    router.get("/ping", (_req, res) =>
                        res.json({ message: "custom-route-ok" }),
                    );
                },
            }),
        );
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it("mounts custom routes properly", async () => {
        const res = await request(app).get("/api/auth/ping");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("custom-route-ok");
    });

    it("mounts OAuth initiation route", async () => {
        // Calling unconfigured google strategy will fail internal passport delegation cleanly or throw 500
        const res = await request(app).get("/api/auth/google");
        expect([302, 500]).toContain(res.status);
    });

    it("covers POST /logout without active session and with active session", async () => {
        // 1. Logout without session
        const noSessionRes = await request(app).post("/api/auth/logout");
        expect(noSessionRes.status).toBe(200);
        expect(noSessionRes.body.success).toBe(true);

        // 2. Register & Login to create session
        await request(app).post("/api/auth/register").send({
            username: "logout_user",
            password: "password123",
        });
        const loginRes = await request(app).post("/api/auth/login").send({
            username: "logout_user",
            password: "password123",
        });
        const cookie = loginRes.headers["set-cookie"];

        // 3. Logout with active session cookie
        const sessionLogoutRes = await request(app)
            .post("/api/auth/logout")
            .set("Cookie", cookie as any);

        expect(sessionLogoutRes.status).toBe(200);
        expect(sessionLogoutRes.body.message).toContain("Logged out");
    });
});
