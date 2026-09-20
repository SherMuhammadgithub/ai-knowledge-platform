import { Injectable } from "@nestjs/common";
import { forWorkspace, type TenantDb } from "./tenant-client";
import { PrismaService } from "./prisma.service";

// Services ask for the scoped client with the caller's auth context (from @CurrentWorkspace()),
// never with a workspace id taken from the request.
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  for(actor: { workspaceId: string }): TenantDb {
    return forWorkspace(this.prisma, actor.workspaceId);
  }
}
