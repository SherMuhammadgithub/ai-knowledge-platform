import { Body, Controller, Post } from "@nestjs/common";
import type { WorkspaceAuth } from "../auth/auth.types";
import { CurrentWorkspace } from "../auth/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { askSchema, type AskInput } from "./rag.schemas";
import { RagService } from "./rag.service";

// No workspace id in the body. The workspace is the caller's active one, from @CurrentWorkspace(), like every
// other tenant-data route.
@Controller("ask")
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post()
  ask(@CurrentWorkspace() actor: WorkspaceAuth, @Body(new ZodPipe(askSchema)) body: AskInput) {
    return this.rag.answer(actor, body.question);
  }
}
