import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/migration-schema.ts",
  dialect: "sqlite",
});
