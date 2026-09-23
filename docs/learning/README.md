# Learning notes

**Start with [`milestones/README.md`](milestones/README.md).** Each milestone has its own folder with its goal, plan checklist, what to read, and what is still open. The files below are the topic notes those folders point to.

Short, practical notes on what we built and why. Written for you to revise from and to explain in interviews.

| File | What it covers | Status |
|---|---|---|
| `QUIZ.md` | Every question and exercise I have asked, with a place for your answer and a hidden answer key | Milestones 1 to 6 unanswered |
| `09-production-ai.md` | Provider interfaces, rate limits, retries, thinking tokens, embedding batching | Started (Milestone 1), grows in Milestones 4 and 13 |
| `tenant-isolation.md` | Workspaces, the session guard, the workspace-scoped database client, how it is tested | Started (Milestone 2), grew in Milestones 3 and 4, grows in Milestone 12 |
| `file-uploads.md` | Validating and storing uploads: type from bytes, names, storage keys, hashing, size limits | Milestone 3 |
| `text-extraction.md` | Turning file bytes into clean text per page: extraction, cleaning rules and their costs, limits, failure as a result | Milestone 4 |
| `background-jobs.md` | Queue, worker, permanent versus temporary failure, repeatable jobs, the sweeper | Milestone 4 |
| `milestones/M05-chunking-and-embeddings/01-llm-fundamentals.md` | Tokens, budgets and limits, and how we measured our estimates | Milestone 5 |
| `milestones/M05-chunking-and-embeddings/02-embeddings.md` | Embeddings, cosine similarity, the cache and setup id, real scores | Milestone 5 |
| `milestones/M05-chunking-and-embeddings/03-chunking.md` | Chunk size, overlap, the two chunkers | Milestone 5 |
| `milestones/M06-qdrant-retrieval-and-eval/05-retrieval.md` | Vector search with Qdrant, filtering during the search, exact versus approximate, two stores, what the measurements showed | Milestone 6 |
| `milestones/M06-qdrant-retrieval-and-eval/07-evaluation.md` | Hit rate, MRR, judging by quote, stored runs, the traps, what our numbers show and do not show | Started (Milestone 6), grows in Milestone 10 |
| `milestones/M07-basic-rag/04-rag.md` | Grounding, the system instruction, "I don't know" without a score, streaming, two real bugs found live and how they were diagnosed | Milestone 7 |
| `10-lessons-learned.md` | Things that went wrong and what we learned | Grows every milestone |

Planned files that do not exist yet, created when the milestone that teaches them is done: `06-reranking` (11), `08-prompt-injection` (12). `05-retrieval` and `07-evaluation` exist from Milestone 6, `04-rag` from Milestone 7.

Each topic file has the same sections: Concept, Why it matters, Mental model, What we implemented (with file paths), Tradeoffs, Common mistakes, Interview questions, Try it.
