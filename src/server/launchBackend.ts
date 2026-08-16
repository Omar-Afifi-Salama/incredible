import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import session, { Store } from "express-session";
import cors from "cors";
import swaggerUi from "swagger-ui-express";

import type { DatabaseDriver, DatabaseAdapter } from "../database/types.js";
import { JsonDriver } from "../database/Json/JsonDriver.js";
import { createResourceRouter } from "../router/createResourceRouter.js";
import type { ResourceDefinition } from "./defineResource.js";
import { generateOpenApiSpec } from "../docs/openapiGenerator.js";

import {
    type AuthConfig,
    type BaseUserRecord,
    configurePassport,
    createAuthRouter,
} from "../auth/index.js";

export interface DocsConfig {
    enabled?: boolean;
    path?: string;
    title?: string;
    version?: string;
    description?: string;
}

export interface LaunchBackendOptions {
    port?: number;
    apiPrefix?: string;
    cors?: boolean | cors.CorsOptions;
    driver?: DatabaseDriver;
    auth?: AuthConfig & {
        sessionStore?: Store;
    };
    resources?: Record<string, ResourceDefinition>;
    docs?: boolean | DocsConfig;
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
                store: authConfig.sessionStore,
                cookie: {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
                    sameSite: "lax",
                },
            }),
        );

        // B. Resolve User Database Adapter
        const userAdapter =
            authConfig.userAdapter ||
            (driver.getAdapter("users") as DatabaseAdapter<BaseUserRecord>);

        // C. Initialize Passport Strategies (Local + JWT)
        const passportInstance = configurePassport({ userAdapter, jwtSecret });
        app.use(passportInstance.initialize());
        app.use(passportInstance.session());

        // D. Run custom strategy setup hook
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
                hooks: resourceDef.hooks, // Fixed: Forward lifecycle hooks
            });

            app.use(`${apiPrefix}/${cleanName}`, router);
        }
    }

    // 6. Mount Auto-Generated OpenAPI & Swagger UI
    const isDocsEnabled = options.docs !== false;
    if (isDocsEnabled && options.resources) {
        const docsOpt = typeof options.docs === "object" ? options.docs : {};
        const docsPath = docsOpt.path || `${apiPrefix}/docs`;
        const docsTitle = docsOpt.title || "API Documentation";
        const docsVersion = docsOpt.version || "1.0.0";
        const docsDescription = docsOpt.description;

        const openApiSpec = generateOpenApiSpec({
            title: docsTitle,
            version: docsVersion,
            ...(docsDescription !== undefined && {
                description: docsDescription,
            }),
            apiPrefix,
            resources: options.resources,
            authEnabled: Boolean(options.auth),
        });

        // A. Raw OpenAPI 3.0 spec JSON endpoint
        app.get(`${docsPath}/openapi.json`, (_req: Request, res: Response) => {
            res.setHeader("Content-Type", "application/json");
            res.json(openApiSpec);
        });

        // B. Redirect /api/docs -> /api/docs/ for correct asset resolution
        app.get(docsPath, (req: Request, res: Response, next: NextFunction) => {
            if (!req.url.endsWith("/")) {
                return res.redirect(301, `${docsPath}/`);
            }
            next();
        });

        // C. Mount Swagger UI interface
        app.use(
            docsPath,
            swaggerUi.serve,
            swaggerUi.setup(openApiSpec, {
                customSiteTitle: docsTitle,
                swaggerOptions: {
                    persistAuthorization: true,
                    displayRequestDuration: true,
                },
            }),
        );
    }

    // 7. Global Centralized Error Handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error("[Backend Error]:", err);
        res.status(500).json({
            success: false,
            error: err.message || "Internal Server Error",
        });
    });

    // 8. Start HTTP Server
    await new Promise<void>((resolve) => {
        app.listen(port, () => {
            if (options.onReady) {
                options.onReady(port, app);
            } else {
                console.log(
                    `API active at http://localhost:${port}${apiPrefix}`,
                );
                if (isDocsEnabled && options.resources) {
                    const docsPath =
                        typeof options.docs === "object" && options.docs.path
                            ? options.docs.path
                            : `${apiPrefix}/docs`;
                    console.log(
                        `Interactive Docs: http://localhost:${port}${docsPath}`,
                    );
                }
            }
            resolve();
        });
    });

    return app;
}
