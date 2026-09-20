import { Global, Module } from "@nestjs/common";
import { loadEnv } from "./env";

// Injection token for the validated environment. Tests replace it with their own values.
export const ENV = Symbol("ENV");

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
