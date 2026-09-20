# Demo guide: log in and check everything built so far

Everything here is fake data for local development. The accounts use the reserved `.test` domain and a shared demo password. The seed script refuses to run in production or against a remote database.

Built so far: sign up, sign in, workspaces, roles, members, tenant isolation, document upload and storage, automatic reading of documents (text extraction), dark mode, mobile layout.
Not built yet: chunks and embeddings, search, chat, citations. A Ready document has its text stored, but nothing searches it yet.

## 1. Start it

First time only:

```
bun install
bun run infra:up
bun run --cwd apps/api db:generate
bun run --cwd apps/api db:migrate
```

Every time (three terminals in the project root, one program per terminal):

```
bun run api       # http://localhost:3001
bun run worker    # reads uploaded documents. Without it, documents stay "Uploaded"
bun run web       # http://localhost:3000

# once, in any terminal, to load the demo data (safe to repeat, see section 5):
bun run seed
```

Open http://localhost:3000. If Docker is not running yet, `bun run infra:up` first.

**If you see "Cannot reach the server":** the web app is running but the API is not. Start it with `bun run api` (and check `docker compose ps` shows Postgres, Qdrant and Redis healthy), then press Try again. You do not need to restart the web app.

**After pulling new code:** run `bun run --cwd apps/api db:generate` and `bun run --cwd apps/api db:migrate` again, then restart the API. The API and the worker are separate programs. Run each only once: two copies of `bun run api` fight over the same output folder and each uses about 250 MB.

**If documents stay "Uploaded":** the worker is not running. Start `bun run worker`. Documents uploaded while it was off are picked up straight away.

## 2. Accounts

Password for every account: `demo-password-123`

| Email | Name | Workspaces (role) | Use it to check |
|---|---|---|---|
| alice@acme.test | Alice Andersson | Acme Corp (owner), Alice's workspace (owner) | Owner powers: add admins, remove anyone except the owner |
| bob@acme.test | Bob Brown | Acme Corp (admin), Bob's workspace (owner) | Admin limits: can add members, cannot add admins |
| carol@acme.test | Carol Chen | Acme Corp (member), Globex (member), Carol's workspace (owner) | Member limits, and one person in three workspaces |
| dave@acme.test | Dave Diaz | Acme Corp (member), Dave's workspace (owner) | The person to remove, to see access end immediately |
| erin@globex.test | Erin Evans | Globex (owner), Erin's workspace (owner) | A different company, for the isolation check |
| frank@globex.test | Frank Fischer | Globex (member), Frank's workspace (owner) | A member of the other company |
| heidi@acme.test | Heidi Hall | Heidi's workspace (owner) | A new hire waiting to be added to Acme |

Every account signs in to its company workspace first (Acme Corp or Globex). Heidi has no company yet, so she starts in her own workspace.

Tip: use one normal browser window and one private window to be two people at once. Cookies are separate, so the two sessions do not interfere.

## 3. Checks

Each check says what to do and what you should see. If you see something different, that is a bug worth reporting.

### A. Sign in and out
1. Sign in as `alice@acme.test`. You land on Documents in "Acme Corp", with an empty state ("No documents yet").
2. Open the account menu (bottom of the sidebar) and choose Sign out. You return to the sign-in page.
3. Try the wrong password. You see "Invalid email or password". Try an email that does not exist: the same message, so nobody can tell which emails have accounts.
4. While signed out, open http://localhost:3000/members. You are sent to sign in.
5. While signed in, open http://localhost:3000/login. You are sent to Documents.

### B. Create an account
1. Go to http://localhost:3000/register.
2. Type `abc` as the email and press Tab. You see "Enter a valid email address". Type a short password and press Tab: "Use at least 10 characters".
3. Register with `alice@acme.test`, then again with `ALICE@ACME.TEST`. Both show "An account with this email already exists", because emails are not case sensitive.
4. Register with your own made-up email. You land in "<your name>'s workspace" as owner.

### C. Roles
Open Members for each account and compare.

| Account | Add member button | Remove buttons (hover a row) | Role choices when adding |
|---|---|---|---|
| alice (owner) | enabled | on Bob, Carol, Dave | Member, Admin |
| bob (admin) | enabled | on Carol and Dave only | Member only |
| carol (member) | disabled, tooltip explains why | none | not available |

Nobody has a remove button on the owner row.

### D. Tenant isolation (two companies)
1. Window 1: sign in as `alice@acme.test`, open Members. You see 4 people: Alice, Bob, Carol, Dave.
2. Window 2 (private): sign in as `erin@globex.test`, open Members. You see 3 people: Erin, Frank, Carol. No Alice, Bob or Dave.
3. Still as Erin, open http://localhost:3000/api/workspaces/current/members in the address bar. You get JSON with only the Globex people.
4. Now add a made-up parameter: http://localhost:3000/api/workspaces/current/members?workspaceId=019a0000-0000-7000-8000-000000000065 (that is Acme's real id). You still get only the Globex people. The API has no workspace id input, so there is nothing to tamper with.
5. Sign in as Carol: she appears in both companies because she is a member of both. That is intended.

### E. One person, several workspaces
1. Sign in as `carol@acme.test`. Open the workspace switcher (top of the sidebar). You see Acme Corp (Member), Globex (Member), Carol's workspace (Owner), with a check next to the current one.
2. Switch to Globex. Members now shows the Globex people. Switch to Carol's workspace: only Carol.
3. Choose Create workspace, name it "Side project". You become its owner and the app switches to it. Members shows only you.

### F. Adding members
1. Sign in as `alice@acme.test` and open Members. Choose Add member.
2. Add `nobody@acme.test`. You see "No account has this email. They need to register first".
3. Add `heidi@acme.test` as Member. You see "Member added" and Heidi appears in the list.
4. Add `heidi@acme.test` again: "This person is already a member".
5. Private window: sign in as `heidi@acme.test`. She lands in her own workspace. Open the workspace switcher: Acme Corp is now there. Switch to it and open Members.
6. As `bob@acme.test`, open Add member: the role picker only offers Member.

### G. Access ends immediately when someone is removed
1. Window 1: sign in as `dave@acme.test`, open Members in Acme Corp.
2. Window 2 (private): sign in as `alice@acme.test`, open Members, hover Dave's row, choose the trash icon. Confirm "Remove member".
3. Back in Dave's window, click Documents or reload. You see "Choose a workspace" with Dave's workspace as the option. Dave's session is still valid, but Acme is gone, and the API noticed on the very next request.
4. Click Dave's workspace: it opens normally. Dave's account was never deleted.

### H. Session cookie
1. Signed in, open DevTools (F12), Application tab, Cookies, http://localhost:3000. There is one cookie, `akp_session`, with HttpOnly checked and SameSite Lax.
2. In the Console, type `document.cookie`. The session cookie is not listed, so page scripts cannot read it.

### I. Look and feel
1. Account menu, Theme: try Light, Dark and System. Text stays readable, and the citation-yellow highlight is reserved for later screens.
2. Press Ctrl+Shift+M in DevTools and pick a 390px width. The sidebar turns into a menu button, and the Members table stays usable (remove buttons are always visible on touch layouts).
3. Press Tab repeatedly. Every button and link shows a visible focus ring, and the dialogs trap focus and close with Escape.

### J. Read the API responses directly
While signed in, open these in the address bar:
- http://localhost:3000/api/auth/me shows your user, workspaces and the active one. No password or hash appears anywhere.
- http://localhost:3000/api/health works without signing in and returns `{"status":"ok"}`. Other pages you can open this way, such as `/api/workspaces/current/members`, return 401 until you sign in.

### K. Upload and list documents
The Acme documents that come with the demo data are fictional samples written for this demo.
1. Sign in as `alice@acme.test`. Documents shows 5 files: Employee handbook and Expense policy (uploaded by Alice), Remote work guidelines (Carol), Benefits summary (Bob, a Word file) and Scanned receipt (Alice, a PDF that failed to read, see check N).
2. Choose Upload documents and pick a small `.txt` from your computer. A toast says "Document uploaded" and the file appears at the top.
3. Drag another file from File Explorer onto the page. A dashed outline appears while you hold it over, and dropping it uploads it. You can pick or drop several files at once, and each one gets its own result line.
4. Upload the same file again. You see: This file is already in the workspace as "<name>". Renaming the file first makes no difference, because the contents are compared.
5. Delete: hover a row (always visible on a phone), click the trash icon, and confirm with the red Delete document button. A toast says "Document deleted".

### L. Bad files are refused, with a reason
Try each one and read the message next to the file name. Nothing is stored for any of them.
1. Rename a `.png` to `.pdf` and upload it: This file is not a valid PDF file. The name says PDF, the contents are not.
2. Upload a real `.png`: Only PDF, DOCX and TXT files are supported (checked in the browser before sending).
3. Upload an empty `.txt`: This file is empty.
4. Upload a file over 10 MB: This file is larger than 10 MB.
5. Rename a `.docx` to `.txt` and upload it: This file is not a valid TXT file.

### M. Documents are separate per workspace, and who may delete
1. Sign in as `erin@globex.test` (private window). Documents shows only the 3 Globex files: Security handbook, Onboarding checklist and Field operations manual. Nothing from Acme.
2. Still as Erin, open http://localhost:3000/api/documents in the address bar: JSON with only the Globex files. Add `?workspaceId=019a0000-0000-7000-8000-000000000065` (Acme's id): still only Globex.
3. Upload the same file as Alice and as Erin. Both succeed, because duplicates are only detected inside one workspace. Nobody can learn what another company uploaded.
4. Sign in as `carol@acme.test` (member of Acme). The trash icon appears only on "Remote work guidelines", the file she uploaded. Switch to Globex from the workspace menu: no trash icons at all.
5. Sign in as `bob@acme.test` (admin). The trash icon appears on all five Acme documents.

### N. Documents are read automatically
Needs the worker running (`bun run worker`).
1. Sign in as `alice@acme.test`. The five documents show their state: four are **Ready** (text files and the Word file show a character count) and "Scanned receipt (sample).pdf" is **Failed**, with the reason "This PDF has no readable text. It may be a scan or only pictures. Scanned documents are not supported yet." and a Retry button.
2. Upload `demo-files/facilities-guide.pdf` from the project folder. Without refreshing, its status goes **Uploaded**, then **Processing** (spinning icon), then **Ready** with "3 pages". For a small file this takes a few seconds.
3. Click the file name. A panel opens with the text read from the file, page by page. Check that the header "Hartwell Offices Internal" and the footer "Page 1 of 3" are gone, and that page 1 says "quarter" in one piece. In the PDF that word is split across a line as "quar-" and "ter".
4. Upload `demo-files/travel-policy.docx` and `meeting-notes.txt`. Both become Ready with a character count. Click one and read its text.

### O. Failure, retry, and the queue
1. Upload `demo-files/scanned-form.pdf`. It ends as **Failed** with the no-text reason. Click Retry: it goes back to Uploaded, then Failed again, because there is still no text to read.
2. Upload `demo-files/not-really-a-pdf.pdf`. It is refused at once ("This file is not a valid PDF file") and never appears in the list.
3. Stop the worker (Ctrl+C in its terminal). Upload any small `.txt`. It stays Uploaded, and after about 2 minutes says "Taking longer than usual". Start `bun run worker` again: it is processed within seconds, because the job waited in the queue.
4. Optional, and not yet run by hand: `docker compose stop redis`, upload a file, then `docker compose start redis`. The upload succeeds but nothing is queued. We expect the sweeper to find it within about 6 minutes (5 minutes stuck, then the next minute's sweep). Tell me what you see.

### P. Extracted text is separate per workspace
1. As Alice, open http://localhost:3000/api/documents and copy the `id` of one Acme document.
2. Open http://localhost:3000/api/documents/ followed by that id and `/pages`: you see its pages as JSON.
3. Sign in as `erin@globex.test` (private window) and open the same address: "Document not found". To Erin it does not exist.

## 4. Automated tests

```
bun run test
```

129 tests run against a separate `akp_test` database (and a separate queue), never the dev ones. They cover sign up and sign in, forged and tampered cookies, roles, cross-workspace access, the immediate removal in check G, the workspace-scoped database client, file type detection, storage safety, duplicate and oversized uploads, and who may delete what. Also text extraction from real generated PDF and Word files, every cleaning rule, the zip-bomb guard, the queue with a real worker, retries, the sweeper, and a job that names the wrong workspace.

## 5. Reset the demo data

```
bun run seed
```

This deletes and recreates only the seven demo accounts and the workspaces they own, so it also undoes anything you changed (removed Dave, added Heidi, created "Side project", uploaded or deleted documents). It also clears those workspaces' uploaded files and writes the eight sample documents again, reading each one through the real pipeline. Other accounts you registered yourself in check B are left alone, except workspaces owned by a demo account.

If you want a completely empty database instead, `docker compose down -v` and start again from section 1. That deletes all data in the containers.

## 6. What comes next

Milestone 5 turns each document's stored text into chunks and embeddings. That is where the GenAI learning starts: tokens, embeddings, chunk size and overlap, and how the choices show up in retrieval quality.

## 7. Stopping things properly

Press Ctrl+C in each terminal (API, worker, web). If you close a terminal window instead, its program can keep running in the background and use memory. To see leftovers, in PowerShell:

```
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'nest|dist' } | Select-Object ProcessId, CreationDate, CommandLine
```

Stop only the ones you recognise, with `Stop-Process -Id <ProcessId>`. Two copies of the API or worker, or an old one from hours ago, are safe to stop.
