import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

import { JsonDriver } from "../src/database/Json/index.js";
import { configurePassport } from "../src/auth/passportConfig.js";
import { createAuthRouter } from "../src/auth/authRouter.js";
import { authenticate } from "../src/auth/authGuard.js";
import { requireRole } from "../src/auth/requireRole.js";
import { createResourceRouter } from "../src/router/createResourceRouter.js";
import type { DatabaseAdapter } from "../src/database/types.js";
import type { BaseUserRecord } from "../src/auth/types.js";

const TEST_DATA_DIR = path.join(__dirname, "test-data");
const JWT_SECRET = "test-jwt-secret-key-1234";

describe("Auth Module Integration Tests", () => {
    let app: Express;
    let driver: JsonDriver;
    let userAdapter: DatabaseAdapter<BaseUserRecord>;

    beforeEach(async () => {
        // 1. Clean up and recreate temporary test storage
        await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DATA_DIR, { recursive: true });

        driver = new JsonDriver(TEST_DATA_DIR);
        userAdapter = driver.getAdapter(
            "users",
        ) as DatabaseAdapter<BaseUserRecord>;

        // 2. Setup fresh Express instance with Session & Passport
        app = express();
        app.use(express.json());
        app.use(
            session({
                secret: "test-session-secret",
                resave: false,
                saveUninitialized: false,
                cookie: { secure: false },
            }),
        );

        const passportInstance = configurePassport({
            userAdapter,
            jwtSecret: JWT_SECRET,
        });
        app.use(passportInstance.initialize());
        app.use(passportInstance.session());

        // 3. Mount Auth Router
        app.use(
            "/api/auth",
            createAuthRouter(userAdapter, {
                jwtSecret: JWT_SECRET,
                registrationSchema: z.object({
                    username: z.string().min(3),
                    password: z.string().min(4),
                    email: z.string().email(),
                    role: z.enum(["user", "admin"]).optional(),
                }),
            }),
        );

        // 4. Mount a protected test resource to test guards
        const postsAdapter = driver.getAdapter("posts");
        const postsRouter = createResourceRouter({
            adapter: postsAdapter,
            middleware: {
                create: [authenticate],
                delete: [authenticate, requireRole("admin")],
            },
        });
        app.use("/api/posts", postsRouter);
    });

    afterAll(async () => {
        await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    });

    // =========================================================================
    // Registration Tests
    // =========================================================================
    describe("POST /api/auth/register", () => {
        it("registers a new user and hashes the password", async () => {
            const res = await request(app).post("/api/auth/register").send({
                username: "testuser",
                password: "securePassword123",
                email: "test@example.com",
                role: "user",
            });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.username).toBe("testuser");
            expect(res.body.data.email).toBe("test@example.com");
            expect(res.body.data.password).toBeUndefined(); // Must never return password

            // Verify file persistence & password hashing
            const savedUsers = await userAdapter.find({
                filter: { username: "testuser" },
            });
            expect(savedUsers.length).toBe(1);
            expect(savedUsers[0]?.password).not.toBe("securePassword123"); // Hashed
        });

        it("rejects duplicate usernames with 409", async () => {
            await request(app).post("/api/auth/register").send({
                username: "samename",
                password: "password123",
                email: "user1@example.com",
            });

            const res = await request(app).post("/api/auth/register").send({
                username: "samename",
                password: "password456",
                email: "user2@example.com",
            });

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toContain("already registered");
        });

        it("rejects payloads failing schema validation with 400", async () => {
            const res = await request(app).post("/api/auth/register").send({
                username: "ab", // Min length is 3
                password: "123", // Min length is 4
                email: "not-an-email",
            });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Validation failed");
        });
    });

    // =========================================================================
    // Login & Token Issuance Tests
    // =========================================================================
    describe("POST /api/auth/login", () => {
        beforeEach(async () => {
            await request(app).post("/api/auth/register").send({
                username: "johndoe",
                password: "mypassword",
                email: "john@example.com",
            });
        });

        it("logs in with valid credentials, setting session cookie and returning JWT", async () => {
            const res = await request(app).post("/api/auth/login").send({
                username: "johndoe",
                password: "mypassword",
            });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.token).toBeDefined();
            expect(res.body.user.username).toBe("johndoe");
            expect(res.body.user.password).toBeUndefined();

            // Session Cookie check
            const cookies = res.headers["set-cookie"];
            expect(cookies).toBeDefined();
            expect(cookies![0]).toContain("connect.sid");
        });

        it("rejects invalid password with 401", async () => {
            const res = await request(app).post("/api/auth/login").send({
                username: "johndoe",
                password: "wrongpassword",
            });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });
    });

    // =========================================================================
    // Guard & Authentication Style Tests (Session vs JWT)
    // =========================================================================
    describe("Route Guards & Authentication Methods", () => {
        let jwtToken: string;
        let sessionCookie: string[];
        let adminToken: string;

        beforeEach(async () => {
            // 1. Create standard user
            await request(app).post("/api/auth/register").send({
                username: "regular_user",
                password: "password123",
                email: "user@example.com",
                role: "user",
            });

            const userLogin = await request(app).post("/api/auth/login").send({
                username: "regular_user",
                password: "password123",
            });
            jwtToken = userLogin.body.token;

            const rawCookie = userLogin.headers["set-cookie"] as unknown as
                | string[]
                | string
                | undefined;

            sessionCookie = Array.isArray(rawCookie)
                ? rawCookie
                : rawCookie
                  ? [rawCookie]
                  : [];

            // 2. Create admin user
            await request(app).post("/api/auth/register").send({
                username: "admin_user",
                password: "password123",
                email: "admin@example.com",
                role: "admin",
            });

            const adminLogin = await request(app).post("/api/auth/login").send({
                username: "admin_user",
                password: "password123",
            });
            adminToken = adminLogin.body.token;
        });

        it("rejects unauthenticated requests to protected endpoints with 401", async () => {
            const res = await request(app)
                .post("/api/posts")
                .send({ title: "New Post" });
            expect(res.status).toBe(401);
        });

        it("allows access via Bearer JWT header", async () => {
            const res = await request(app)
                .post("/api/posts")
                .set("Authorization", `Bearer ${jwtToken}`)
                .send({ title: "Post with JWT" });

            expect(res.status).toBe(201);
            expect(res.body.data.title).toBe("Post with JWT");
        });

        it("allows access via Express Session cookie", async () => {
            const res = await request(app)
                .post("/api/posts")
                .set("Cookie", sessionCookie)
                .send({ title: "Post with Session" });

            expect(res.status).toBe(201);
            expect(res.body.data.title).toBe("Post with Session");
        });

        it("GET /api/auth/me returns current authenticated user payload", async () => {
            const res = await request(app)
                .get("/api/auth/me")
                .set("Authorization", `Bearer ${jwtToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.username).toBe("regular_user");
            expect(res.body.data.role).toBe("user");
        });

        // =========================================================================
        // Role-Based Authorization Tests (RBAC)
        // =========================================================================
        it("blocks regular users from admin-only endpoints with 403 Forbidden", async () => {
            // Create a dummy post
            const post = await driver
                .getAdapter("posts")
                .create({ title: "To Delete" });

            const res = await request(app)
                .delete(`/api/posts/${post.id}`)
                .set("Authorization", `Bearer ${jwtToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain("Forbidden");
        });

        it("allows admin users to delete records on admin-only endpoints", async () => {
            const post = await driver
                .getAdapter("posts")
                .create({ title: "Admin To Delete" });

            const res = await request(app)
                .delete(`/api/posts/${post.id}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
