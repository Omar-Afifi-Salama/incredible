import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import type { BaseUserRecord } from "./types.js";

export function authenticate(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    // 1. Session Authenticated Check
    if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) {
        return next();
    }

    // 2. Bearer JWT Authenticated Check
    passport.authenticate(
        "jwt",
        { session: false },
        (err: any, user: BaseUserRecord | false | null) => {
            if (err) {
                return next(err);
            }
            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: "Unauthorized: A valid Session cookie or Bearer JWT token is required.",
                });
            }

            req.user = user;
            return next();
        },
    )(req, res, next);
}
