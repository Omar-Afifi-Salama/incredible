import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { DatabaseAdapter } from "../database/types.js";
import type { AuthConfig, BaseUserRecord, SafeUser } from "./types.js";
import { authenticate } from "./authGuard.js";

function sanitizeUser<T extends BaseUserRecord>(user: T): SafeUser<T> {
    const { password, ...safeUser } = user;
    return safeUser;
}

export function createAuthRouter(
    userAdapter: DatabaseAdapter<BaseUserRecord>,
    config: AuthConfig = {},
): Router {
    const router = Router();
    const jwtSecret = config.jwtSecret || "default-jwt-secret-key";
    const { registrationSchema, providers = [], customRoutes } = config;

    const issueToken = (user: BaseUserRecord): string => {
        return jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role || "user",
            },
            jwtSecret,
            { expiresIn: "7d" },
        );
    };

    // POST /register
    router.post(
        "/register",
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                let payload = req.body;

                if (registrationSchema?.safeParse) {
                    const result = registrationSchema.safeParse(payload);
                    if (!result.success) {
                        return res.status(400).json({
                            success: false,
                            error: "Validation failed",
                            details: result.error?.errors || result.error,
                        });
                    }
                    payload = result.data;
                }

                const { username, password, ...extraFields } = payload;
                if (!username || !password) {
                    return res.status(400).json({
                        success: false,
                        error: 'Fields "username" and "password" are required.',
                    });
                }

                const existing = await userAdapter.find({
                    filter: { username },
                });
                if (existing.length > 0) {
                    return res.status(409).json({
                        success: false,
                        error: `Username '${username}' is already registered.`,
                    });
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = await userAdapter.create({
                    username,
                    password: hashedPassword,
                    ...extraFields,
                });

                return res.status(201).json({
                    success: true,
                    data: sanitizeUser(newUser),
                });
            } catch (err) {
                next(err);
            }
        },
    );

    // POST /login
    router.post("/login", (req: Request, res: Response, next: NextFunction) => {
        passport.authenticate(
            "local",
            (err: any, user: BaseUserRecord | false, info: any) => {
                if (err) return next(err);
                if (!user) {
                    return res.status(401).json({
                        success: false,
                        error: info?.message || "Invalid username or password.",
                    });
                }

                req.logIn(user, (loginErr) => {
                    if (loginErr) return next(loginErr);

                    const token = issueToken(user);
                    return res.status(200).json({
                        success: true,
                        message: "Logged in successfully.",
                        token,
                        user: sanitizeUser(user),
                    });
                });
            },
        )(req, res, next);
    });

    // POST /logout
    router.post(
        "/logout",
        (req: Request, res: Response, next: NextFunction) => {
            req.logout((logoutErr) => {
                if (logoutErr) return next(logoutErr);

                if (req.session) {
                    req.session.destroy((sessionErr) => {
                        if (sessionErr) return next(sessionErr);
                        res.clearCookie("connect.sid");
                        return res.status(200).json({
                            success: true,
                            message: "Logged out successfully.",
                        });
                    });
                } else {
                    return res.status(200).json({
                        success: true,
                        message: "Logged out successfully.",
                    });
                }
            });
        },
    );

    // GET /me (Protected)
    router.get("/me", authenticate, (req: Request, res: Response) => {
        return res.status(200).json({
            success: true,
            data: sanitizeUser(req.user!),
        });
    });

    // Dynamic OAuth Endpoints
    for (const provider of providers) {
        const strategyName = provider.name.toLowerCase();
        const successRedirect = provider.successRedirect || "/";
        const failureRedirect =
            provider.failureRedirect || "/login?error=auth_failed";

        router.get(
            `/${strategyName}`,
            passport.authenticate(strategyName, {
                scope: provider.scope || ["profile", "email"],
            }),
        );

        router.get(
            `/${strategyName}/callback`,
            passport.authenticate(strategyName, {
                failureRedirect,
                session: true,
            }),
            (req: Request, res: Response) => {
                const user = req.user as BaseUserRecord;
                const token = issueToken(user);

                const redirectUrl = new URL(
                    successRedirect,
                    `${req.protocol}://${req.get("host")}`,
                );
                redirectUrl.searchParams.set("token", token);

                return res.redirect(redirectUrl.toString());
            },
        );
    }

    // User-provided Custom Auth Routes
    if (customRoutes) {
        customRoutes(router, { userAdapter, jwtSecret });
    }

    return router;
}
