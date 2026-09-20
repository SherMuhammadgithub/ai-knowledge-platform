# Tenant isolation (started in Milestone 2)

An extra topic beyond the ten planned learning files. It is the foundation for the prompt-injection and leakage work in Milestone 12 (`08-prompt-injection.md`).

## Concept

A tenant is one customer's space, here a **workspace**. Tenant isolation means workspace A can never read or change workspace B's documents, chunks, vectors, chats or members, whatever the request says.

## Why it matters for RAG in particular

Search returns the closest text, whoever owns it. A missing filter does not raise an error, it quietly answers a question with another company's document. It is silent and it looks like a working feature. That makes it the most damaging bug class for this product, and the one a client will ask about.

## Mental model

```
browser --cookie--> API
                      SessionGuard (every request)
                        1. verify the cookie signature  -> who is this, and which workspace do they CLAIM?
                        2. read the membership row       -> is that claim true right now, and what is their role?
                        3. attach { userId, workspaceId, role } to the request
                      route handler
                        uses only the attached workspaceId, never one from the URL, body, query or header
```

The claim in the cookie grants nothing by itself. The database row does.

## What we implemented, and where

| Rule | Where |
|---|---|
| The cookie carries only `sub` (user) and `wid` (workspace), no role | `apps/api/src/auth/auth.types.ts`, `session.service.ts` |
| Membership is re-read on every request | `apps/api/src/auth/session.guard.ts` |
| Every route is protected unless marked `@Public()`. `@UserOnly()` and `@Roles(...)` narrow it | `apps/api/src/auth/decorators.ts` |
| Workspace comes from `@CurrentWorkspace()`. No endpoint has a workspace id parameter | `apps/api/src/workspaces/workspaces.controller.ts` |
| Removing a member checks the target inside the actor's workspace, so another workspace's user id is a 404 | `apps/api/src/workspaces/workspaces.service.ts` |
| Cookie is `HttpOnly` and `SameSite=Lax`, signed HS256, 7 days | `apps/api/src/auth/session.service.ts` |
| Passwords use argon2id (19 MiB memory, 2 passes, 1 lane) and an unknown email costs the same time as a wrong password | `apps/api/src/auth/password.service.ts` |

## Proof it works

The suite in `apps/api/test/` (21 tests for Milestone 2, 76 in total after Milestone 3) runs against a separate `akp_test` database (`bun run test`). The Milestone 2 tests cover:

- a client-supplied workspace id in the query or a header is ignored
- switching into a workspace you do not belong to returns 403 and changes nothing
- a validly signed cookie naming someone else's workspace is rejected
- a removed member is locked out on the very next request
- role limits (member, admin, owner)

We also checked that the tests can fail: we temporarily removed the membership check and the workspace filter and saw 4 tests go red, then restored both. A test that cannot fail proves nothing.

## Tradeoffs

- **Shared tables with a `workspace_id` column** (chosen) vs a schema or database per tenant. Ours is cheap and simple, and relies on every query carrying the filter. Per-tenant databases isolate more strongly and cost far more to run.
- **Postgres row-level security** would enforce the filter inside the database even if application code forgets it. It is a stretch goal, not built.
- **Membership lookup per request** costs one indexed query. In return, removals and role changes apply immediately. The alternative, trusting the token, is faster and leaves revoked access open until expiry.

## Common mistakes

- Taking the tenant id from the request. Anything the client sends can be changed.
- Fetching a record by its id alone. Always include the workspace in the lookup (the classic insecure direct object reference).
- Putting the role inside the token, so a demoted user stays an admin until the token expires.
- Tests that only check the happy path. Write the attack: user B asks for user A's data.
- Background jobs and raw SQL, which skip whatever the request layer enforces.

## Added in Milestone 3: the scoped client

Documents are the first tenant-owned data. Instead of trusting every query to carry the filter, tenant tables are reached only through `forWorkspace(prisma, workspaceId)` (`apps/api/src/prisma/tenant-client.ts`). Services get it from `TenantPrismaService.for(actor)` with the auth context from `@CurrentWorkspace()`.

What it does, in one function (`scopeArgs`):
- reads and bulk updates or deletes get `workspaceId` ANDed on the outside, so a caller's own `OR` cannot widen the query
- lookups by id get `workspaceId` added, so another workspace's id is simply "not found"
- creates overwrite any workspace the caller supplied, and updates drop it, so a row cannot be moved between tenants
- an operation it does not know is refused, not passed through
- it exposes only tenant models, so nothing else is reachable through it

What it does not cover, and what we do about it:
- **Raw SQL** skips it. A test scans the source for raw queries and fails if it finds one.
- **A new tenant table nobody registered.** A test reads the schema and fails if a model with a `workspaceId` column is neither in `TENANT_MODELS` nor deliberately in `EXEMPT_MODELS` (Membership is exempt because the guard reads it across workspaces).
- **Nested writes from another model** do not go through it. Do not write tenant rows that way.

We checked the tests can fail: breaking the read filter, the id-lookup scoping, the ownership overwrite, the file signature check and the storage key check turned 18 tests red. Leaving a table unregistered, and adding a raw query, each turned the matching guard test red. Everything was restored.

Background jobs (Milestone 4) do not have a request. The workspace has to travel in the job's data, set by the server at the moment the job is created, and the job then uses `forWorkspace()` with it. It must never come from anything a user typed.

Vector search gets the same treatment: an indexed `workspace_id` payload filter in Qdrant, applied in one place.

## Added in Milestone 4: jobs, pages and the one exception

- **Pages are tenant data too.** `document_pages` carries a `workspace_id` and is registered in `TENANT_MODELS`. The scoped client now also gives a transaction whose queries are scoped, so "save the pages and mark Ready" is one all-or-nothing write that still cannot cross a workspace. A test shows a page naming another workspace still lands in the caller's, and that a failure part way rolls the first write back.
- **A job has no session.** The workspace travels in the job (`{documentId, workspaceId}`), set by the server after the upload was authorised. The processor loads the document through `forWorkspace(job.workspaceId)`. A test sends a job naming Bob's workspace for Alice's document: it finds nothing and changes nothing.
- **One deliberate exception.** The sweeper has to find stuck documents in every workspace. That query lives in `worker/system-queries.ts`, returns ids only, and is the only file allowed to use the plain client on a tenant table. A new guard test scans the source and fails if the plain client touches a tenant table anywhere else (the demo seed, which builds both tenants, is the other allowed place).
- We checked the guard can fail: adding a plain-client read of the page table in another file turned it red.

## Interview questions

1. Where do you get the tenant id in a multi-tenant API, and why not from the request?
2. What is an insecure direct object reference, and how do you prevent it?
3. Why is a signed token not enough to authorize a request on its own?
4. What are the options for isolating tenants in a database, and when would you pick each?
5. How would you test that tenant isolation actually holds, and how do you know the test can fail?

## Try it

Follow `docs/DEMO_GUIDE.md`, checks D (two companies), E (one person in several workspaces) and G (removal takes effect immediately).
