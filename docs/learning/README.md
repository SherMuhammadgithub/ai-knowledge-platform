# Learning notes

**Start with [`milestones/README.md`](milestones/README.md).** Each milestone has its own folder with its goal, plan checklist, what to read, and what is still open. The files below are the topic notes those folders point to.

Short, practical notes on what we built and why. Written for you to revise from and to explain in interviews.

| File | What it covers | Status |
|---|---|---|
| `QUIZ.md` | Every question and exercise I have asked, with a place for your answer and a hidden answer key | Milestones 1 to 4 unanswered |
| `09-production-ai.md` | Provider interfaces, rate limits, retries, thinking tokens, embedding batching | Started (Milestone 1), grows in Milestones 4 and 13 |
| `tenant-isolation.md` | Workspaces, the session guard, the workspace-scoped database client, how it is tested | Started (Milestone 2), grew in Milestones 3 and 4, grows in Milestone 12 |
| `file-uploads.md` | Validating and storing uploads: type from bytes, names, storage keys, hashing, size limits | Milestone 3 |
| `text-extraction.md` | Turning file bytes into clean text per page: extraction, cleaning rules and their costs, limits, failure as a result | Milestone 4 |
| `background-jobs.md` | Queue, worker, permanent versus temporary failure, repeatable jobs, the sweeper | Milestone 4 |
| `10-lessons-learned.md` | Things that went wrong and what we learned | Grows every milestone |

Planned files that do not exist yet, created when the milestone that teaches them is done: `01-llm-fundamentals`, `02-embeddings`, `03-chunking` (Milestone 5), `04-rag` (7), `05-retrieval` (6), `06-reranking` (11), `07-evaluation` (10), `08-prompt-injection` (12).

Each topic file has the same sections: Concept, Why it matters, Mental model, What we implemented (with file paths), Tradeoffs, Common mistakes, Interview questions, Try it.
