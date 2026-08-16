import { z } from "zod";
import { launchBackend, defineResource } from "incrediblejs";

async function main() {
    await launchBackend({
        port: 4004,
        apiPrefix: "/api",
        resources: {
            notes: defineResource({
                schema: z.object({
                    title: z.string().min(1),
                    body: z.string(),
                    pinned: z.boolean().default(false),
                }),
            }),
        },
    });
}

main().catch(console.error);
