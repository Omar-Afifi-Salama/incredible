import type { Request, Response, NextFunction } from "express";

export function requireRole(...allowedRoles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized: Authentication required before checking permissions.",
            });
        }

        const userRole = req.user.role || "user";

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                error: `Forbidden: User role '${userRole}' does not satisfy required role(s): [${allowedRoles.join(", ")}].`,
            });
        }

        return next();
    };
}
