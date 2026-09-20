import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        signOptions: { algorithm: "HS256", expiresIn: env.SESSION_DAYS * 24 * 60 * 60 },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionService, AuthService],
})
export class AuthModule {}
