import { z } from "zod";
import { launchBackend, defineResource } from "incrediblejs";

// Launch an in-memory/JSON-backed REST API on port 4000
await launchBackend({
    port: 4000,
    apiPrefix: "/api",
    resources: {
        tasks: defineResource({
            schema: z.object({
                title: z.string().min(3),
                completed: z.boolean().default(false),
                priority: z.enum(["low", "medium", "high"]).default("medium"),
            }),
        }),
    },
});
