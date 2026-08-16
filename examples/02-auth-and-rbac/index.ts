import { z } from "zod";
import {
    launchBackend,
    defineResource,
    authenticate,
    requireRole,
} from "incrediblejs";

await launchBackend({
    port: 4001,
    apiPrefix: "/api",
    auth: {
        jwtSecret: process.env.JWT_SECRET || "super-secret-jwt-key",
        sessionSecret: process.env.SESSION_SECRET || "super-secret-session-key",
    },
    resources: {
        // Public read, authenticated creation, admin-only deletion
        posts: defineResource({
            schema: z.object({
                title: z.string().min(5),
                content: z.string(),
                published: z.boolean().default(false),
            }),
            middleware: {
                create: [authenticate],
                update: [authenticate],
                delete: [authenticate, requireRole("admin")],
            },
        }),
    },
});

console.log("🔒 Auth & RBAC server running on http://localhost:4001");
console.log("👉 Register at POST http://localhost:4001/api/auth/register");
console.log("👉 Login at POST http://localhost:4001/api/auth/login");
