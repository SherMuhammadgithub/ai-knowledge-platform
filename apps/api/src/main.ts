import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { setupApp } from "./setup-app";

async function bootstrap() {
  const env = loadEnv(); // fail fast on a bad .env before Nest starts
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  await app.listen(env.API_PORT);
  console.log(`API listening on http://localhost:${env.API_PORT}`);
}

void bootstrap();
