import type { PrismaClient } from "../generated/prisma/client";

/**
 * The workspace-scoped database client.
 *
 * Tenant tables (documents, their pages and chunks, and later conversations, eval data) must be read and
 * written ONLY through forWorkspace(). It adds the workspace to every query and every create, so a service
 * cannot forget it.
 *
 * Rules that keep it safe:
 *  - It exposes only tenant models. There is no way to reach another table through it.
 *  - Operations it does not understand are refused instead of passed through.
 *  - Callers cannot choose the workspace: a workspaceId in `data` is overwritten, in `update` it is dropped.
 *  - Raw SQL, nested writes from other models and the plain client on a tenant table all bypass it. All three
 *    are banned, and tests fail if the source contains raw queries or plain-client access
 *    (apps/api/test/tenant-client.spec.ts). The one deliberate exception is src/worker/system-queries.ts.
 *
 * Adding a tenant table: add its (lower camel case) name to TENANT_MODELS, add it to createScoped() and to the
 * object returned by forWorkspace(). A test fails if a schema model with a workspaceId column is in neither
 * TENANT_MODELS nor EXEMPT_MODELS.
 */
export const TENANT_MODELS = ["document", "documentPage", "documentChunk"] as const;

// Models that have a workspaceId column but are deliberately NOT scoped. Membership is the authorization
// table itself: the guard and /auth/me read it across workspaces (all of one user's memberships).
export const EXEMPT_MODELS = ["membership"] as const;

// Prisma's argument shapes differ per model and operation. This one function handles all of them,
// so it works on loosely typed args and is covered by unit tests.
type Args = Record<string, unknown>;

const FILTERED_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
const UNIQUE_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);

// Removes any attempt to choose or change the owner from caller-supplied data.
function withoutOwner(data: unknown): Args {
  if (!data || typeof data !== "object") return {};
  const { workspaceId: _id, workspace: _relation, ...rest } = data as Args;
  return rest;
}

export function scopeArgs(operation: string, args: unknown, workspaceId: string): Args {
  const a: Args = { ...((args as Args | undefined) ?? {}) };

  if (FILTERED_OPERATIONS.has(operation)) {
    a.where = { AND: [(a.where as Args | undefined) ?? {}, { workspaceId }] };
    if (a.data !== undefined) a.data = withoutOwner(a.data);
    return a;
  }

  if (UNIQUE_OPERATIONS.has(operation)) {
    // Prisma lets a unique lookup carry extra filters, so a row in another workspace is simply "not found".
    a.where = { ...((a.where as Args | undefined) ?? {}), workspaceId };
    if (a.data !== undefined) a.data = withoutOwner(a.data);
    return a;
  }

  if (operation === "create") {
    a.data = { ...withoutOwner(a.data), workspaceId };
    return a;
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(a.data) ? a.data : [a.data];
    a.data = rows.map((row) => ({ ...withoutOwner(row), workspaceId }));
    return a;
  }

  if (operation === "upsert") {
    a.where = { ...((a.where as Args | undefined) ?? {}), workspaceId };
    a.create = { ...withoutOwner(a.create), workspaceId };
    a.update = withoutOwner(a.update);
    return a;
  }

  throw new Error(`Operation "${operation}" is not allowed on tenant tables`);
}

function createScoped(prisma: PrismaClient, workspaceId: string) {
  const scope = {
    $allOperations({ operation, args, query }: { operation: string; args: unknown; query: (a: any) => Promise<unknown> }) {
      return query(scopeArgs(operation, args, workspaceId));
    },
  };
  return prisma.$extends({
    name: "workspace-scope",
    query: { document: scope, documentPage: scope, documentChunk: scope },
  });
}

type Scoped = ReturnType<typeof createScoped>;

/** What code inside a transaction can reach: the same scoped tenant models, nothing else. */
export type TenantTx = Pick<Scoped, "document" | "documentPage" | "documentChunk">;

export function forWorkspace(prisma: PrismaClient, workspaceId: string) {
  if (!workspaceId) throw new Error("forWorkspace needs a workspace id");
  const scoped = createScoped(prisma, workspaceId);

  return {
    workspaceId,
    document: scoped.document,
    documentPage: scoped.documentPage,
    documentChunk: scoped.documentChunk,
    /** Several writes that succeed or fail together. The queries inside are scoped to the workspace as well. */
    transaction: <R>(work: (tx: TenantTx) => Promise<R>) => scoped.$transaction((tx) => work(tx), { timeout: 20_000 }),
  };
}

export type TenantDb = ReturnType<typeof forWorkspace>;
