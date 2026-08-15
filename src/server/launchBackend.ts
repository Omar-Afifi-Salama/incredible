import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import session, { Store } from "express-session";
import cors from "cors";

import type { DatabaseDriver, DatabaseAdapter } from "../database/types.js";
import { JsonDriver } from "../database/JsonDriver.js";
import { createResourceRouter } from "../router/createResourceRouter.js";
import type { ResourceDefinition } from "./defineResource.js";

import {
    type AuthConfig,
    type BaseUserRecord,
    configurePassport,
    createAuthRouter,
} from "../auth/index.js";

export interface LaunchBackendOptions {
    port?: number;
    apiPrefix?: string;
    cors?: boolean | cors.CorsOptions;
    driver?: DatabaseDriver;
    auth?: AuthConfig & {
        sessionStore?: Store;
    };
    resources?: Record<string, ResourceDefinition>;
    onReady?: (port: number, app: Express) => void;
}

export async function launchBackend(
    options: LaunchBackendOptions = {},
): Promise<Express> {
    const app = express();
    const port = options.port || 3000;
    const rawPrefix = options.apiPrefix || "/api";
    const apiPrefix = `/${rawPrefix.replace(/^\/+|\/+$/g, "")}`;
    const driver = options.driver || new JsonDriver("./data");

    // 1. Establish Database Connection if required (e.g., MongooseDriver)
    if ("connect" in driver && typeof driver.connect === "function") {
        await driver.connect();
    }

    // 2. Global Request Parsing & CORS
    if (options.cors !== false) {
        app.use(typeof options.cors === "object" ? cors(options.cors) : cors());
    }
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 3. Setup Auth & Sessions (if auth configuration is supplied)
    if (options.auth) {
        const authConfig = options.auth;
        const jwtSecret = authConfig.jwtSecret || "default-jwt-secret-key";
        const sessionSecret =
            authConfig.sessionSecret || "default-session-secret-key";

        // A. Express Session Setup
        app.use(
            session({
                secret: sessionSecret,
                resave: false,
                saveUninitialized: false,
                store: authConfig.sessionStore, // In-memory by default, or MongoStore/Redis if passed
                cookie: {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
                    sameSite: "lax",
                },
            }),
        );

        // B. Resolve User Database Adapter (defaults to 'users' collection/file)
        const userAdapter =
            authConfig.userAdapter ||
            (driver.getAdapter("users") as DatabaseAdapter<BaseUserRecord>);

        // C. Initialize Passport Strategies (Local + JWT)
        const passportInstance = configurePassport({ userAdapter, jwtSecret });
        app.use(passportInstance.initialize());
        app.use(passportInstance.session());

        // D. Run custom strategy setup hook (Google, GitHub, etc.)
        if (authConfig.setupStrategies) {
            authConfig.setupStrategies(passportInstance, userAdapter);
        }

        // E. Mount /api/auth routes
        const authRouter = createAuthRouter(userAdapter, authConfig);
        app.use(`${apiPrefix}/auth`, authRouter);
    }

    // 4. Base Health Check
    app.get(`${apiPrefix}/health`, (_req: Request, res: Response) => {
        res.status(200).json({ status: "ok", uptime: process.uptime() });
    });

    // 5. Mount Verified Resources
    if (options.resources) {
        for (const [resourceName, resourceDef] of Object.entries(
            options.resources,
        )) {
            const cleanName = resourceName.toLowerCase().trim();
            const adapter = resourceDef.adapter || driver.getAdapter(cleanName);

            const router = createResourceRouter({
                adapter,
                schema: resourceDef.schema,
                middleware: resourceDef.middleware,
            });

            app.use(`${apiPrefix}/${cleanName}`, router);
        }
    }

    // 6. Global Centralized Error Handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error("[Backend Error]:", err);
        res.status(500).json({
            success: false,
            error: err.message || "Internal Server Error",
        });
    });

    // 7. Start HTTP Server (wrapped in Promise for clean async/test lifecycle)
    await new Promise<void>((resolve) => {
        app.listen(port, () => {
            if (options.onReady) {
                options.onReady(port, app);
            } else {
                console.log(
                    `API active at http://localhost:${port}${apiPrefix}`,
                );
            }
            resolve();
        });
    });

    return app;
}
