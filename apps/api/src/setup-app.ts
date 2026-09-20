import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";

// Shared by main.ts and the tests, so tests run the same middleware as production.
export function setupApp(app: INestApplication): void {
  app.use(cookieParser());
}
