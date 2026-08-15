// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            reportsDirectory: "./coverage",
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.d.ts",
                "src/**/types.ts", // Type-only files have no executable code to cover
                "src/**/index.ts", // Barrel export re-exports
            ],
            // Optional: Enforce minimum coverage thresholds
            // thresholds: {
            //     lines: 80,
            //     functions: 80,
            //     branches: 75,
            //     statements: 80,
            // },
            thresholds: {
                lines: 70,
                statements: 70,
                functions: 75,
                branches: 60,
            },
        },
    },
});
