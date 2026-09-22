import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { DocumentsModule } from "./documents/documents.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { RagModule } from "./rag/rag.module";
import { StorageModule } from "./storage/storage.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [ConfigModule, PrismaModule, StorageModule, AuthModule, WorkspacesModule, DocumentsModule, RagModule],
  controllers: [HealthController],
})
export class AppModule {}
