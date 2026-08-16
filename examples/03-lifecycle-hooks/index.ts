import { z } from "zod";
import { launchBackend, defineResource, authenticate } from "incrediblejs";

await launchBackend({
    port: 4002,
    apiPrefix: "/api",
    auth: {
        jwtSecret: "dev-secret",
        sessionSecret: "dev-session",
    },
    resources: {
        documents: defineResource({
            schema: z.object({
                name: z.string().min(2),
                content: z.string(),
                slug: z.string().optional(),
                ownerId: z.string().optional(),
                internalSecret: z.string().optional(),
            }),
            middleware: {
                create: [authenticate],
            },
            hooks: {
                // Pre-create: generate slug and attach authenticated user ID
                beforeCreate: async ({ data, user }) => {
                    return {
                        ...data,
                        slug: data.name.toLowerCase().replace(/\s+/g, "-"),
                        ownerId: user?.id || "anonymous",
                    };
                },

                // Post-find: strip sensitive fields before sending response
                afterFind: async ({ records }) => {
                    return records.map(
                        ({ internalSecret, ...safeRecord }) => safeRecord,
                    );
                },

                // Post-create side-effect: audit logging / notifications
                afterCreate: async ({ record, user }) => {
                    console.log(
                        `[Audit] Document "${record.name}" created by user ${user?.id}`,
                    );
                },
            },
        }),
    },
});

console.log("🪝 Lifecycle Hooks server running on http://localhost:4002");
