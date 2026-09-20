import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { WorkspaceAuth } from "../auth/auth.types";
import { CurrentWorkspace } from "../auth/decorators";
import { DocumentsService } from "./documents.service";
import type { UploadedFileData } from "./uploaded-file";

// No workspace id in any URL or body. The workspace is the caller's active one, from @CurrentWorkspace().
// The size limit is set in DocumentsModule (MAX_UPLOAD_MB) and enforced while the file streams in.
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentWorkspace() actor: WorkspaceAuth) {
    return this.documents.list(actor);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  upload(@CurrentWorkspace() actor: WorkspaceAuth, @UploadedFile() file: UploadedFileData | undefined) {
    return this.documents.upload(actor, file);
  }

  @Get(":id/pages")
  pages(@CurrentWorkspace() actor: WorkspaceAuth, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.documents.pages(actor, id);
  }

  @Get(":id/chunks")
  chunks(
    @CurrentWorkspace() actor: WorkspaceAuth,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query("strategy") strategy?: string,
  ) {
    return this.documents.chunks(actor, id, strategy);
  }

  @Post(":id/retry")
  @HttpCode(200)
  retry(@CurrentWorkspace() actor: WorkspaceAuth, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.documents.retry(actor, id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentWorkspace() actor: WorkspaceAuth, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.documents.remove(actor, id);
  }
}
