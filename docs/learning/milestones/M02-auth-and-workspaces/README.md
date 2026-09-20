# Milestone 2: auth and workspaces

**Status:** built. Quiz unanswered.

## Goal

Sign up, sign in, workspaces with roles, and the rule that every request is checked against the current membership. This is the base of tenant isolation.

## What was built

- Prisma models: `users`, `workspaces`, `memberships`.
- argon2id password hashing, one 7-day httpOnly cookie holding a JWT with the user and the active workspace.
- Global `SessionGuard` that re-reads the membership on every request, so removals and role changes apply immediately. Decorators: `@Public`, `@UserOnly`, `@Roles`, `@CurrentUser`, `@CurrentWorkspace`.
- Workspaces API: create, list members, add and remove members. Roles: owner, admin, member.
- Web: sign in and create account (two-column page showing an example cited answer), app shell with sidebar and workspace switcher, members page, dark mode, mobile layout.
- Demo seed with fake accounts (`bun run seed`) and the click-through guide `docs/DEMO_GUIDE.md`.

## Read

- [`../../tenant-isolation.md`](../../tenant-isolation.md): the isolation design and how it is tested.
- `docs/DEMO_GUIDE.md`, checks A to J.

## Quiz

`docs/learning/QUIZ.md`, section "Milestone 2".

## Open

- Quiz unanswered.
- Your own visual check of login, register, members, mobile and dark mode.
