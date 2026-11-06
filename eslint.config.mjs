import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const noPrismaOutsideServer = {
  group: ["@/generated/prisma", "@/generated/prisma/*"],
  message: "Only src/server may use Prisma. Call a service in src/server/services (CLAUDE.md rule 4).",
};
const noDbOutsideServer = {
  group: ["@/server/db", "@/server/db/*"],
  message: "No direct database access outside src/server (CLAUDE.md rule 4).",
};
const noServerInSharedCode = {
  group: ["@/server", "@/server/*"],
  message: "src/lib and src/components must stay client-safe; move server logic to src/server.",
};

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      ".data/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Logs must go through src/server/log.ts, which only accepts non-identifying fields.
      "no-console": "error",
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noPrismaOutsideServer, noDbOutsideServer] }],
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noPrismaOutsideServer, noServerInSharedCode] }],
    },
  },
  {
    files: ["src/server/log.ts", "scripts/**", "prisma/**", "tests/**", "*.config.*"],
    rules: { "no-console": "off" },
  },
];

export default config;
