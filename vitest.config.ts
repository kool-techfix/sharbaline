import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server Components bundler; tests run server code directly.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    // Test-only values (not secrets): services read configuration through serverEnv().
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://hms_app:unused@localhost:1/unused",
      APP_ORIGIN: "http://localhost:3000",
      HOSPITAL_NAME: "Test Hospital",
      AUTH_HMAC_KEY: Buffer.alloc(32, 7).toString("base64"),
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      MFA_ENCRYPTION_KEY_VERSION: "1",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.int.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts", "src/**/*.int.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
