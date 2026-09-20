# Text extraction and cleaning (Milestone 4)

An extra topic beyond the ten planned files. Everything that comes later (chunks, embeddings, retrieval, answers, citations) works from the text this step produces.

## Concept

Text extraction turns the bytes of a file into clean text, kept in the structure the file has (pages). Cleaning removes the layout noise that comes with it. Together they decide what the rest of the system is able to know.

## Why it matters for RAG

The language model never sees your PDF. It sees the text you extracted. If a page is missing, a header is repeated on every page, or words are split in half, retrieval searches that broken text, and no model downstream can repair it. It is the cheapest place to lose answer quality and the hardest to notice, because everything still "works".

## Mental model

```
file bytes
  -> extract raw text per page      (pdfjs for PDF, mammoth for Word, decode for TXT)
  -> clean each page                (characters, then PDF layout repairs)
  -> remove repeated headers/footers (whole document, PDFs only)
  -> decide: anything readable?     (no text at all -> Failed with a reason)
  -> save one row per page          (page number kept, blank pages kept)
```

## What we implemented, and where

| Piece | File |
|---|---|
| The whole reading step, as one pure function (no database) | `apps/api/src/processing/extract-document.ts` |
| PDF: positioned text runs back into lines and paragraphs | `apps/api/src/processing/extract-pdf.ts` (`itemsToText`) |
| Word: text of the document, with a zip-bomb guard | `apps/api/src/processing/extract-docx.ts` |
| All cleaning rules | `apps/api/src/processing/clean-text.ts` |
| Limits (pages, time, characters, unpacked size) | `apps/api/src/processing/limits.ts` |
| Tests with real generated PDFs and Word files | `apps/api/test/processing.spec.ts` |
| Sample files to try by hand | `demo-files/` (`bun run samples`) |

## The cleaning rules, and what each one costs

| Rule | What it fixes | Known cost |
|---|---|---|
| Expand ligatures, drop soft hyphens and zero-width characters, normalise odd spaces | "ofﬁce" and invisible characters that break search | none we know of |
| Rejoin a word split at a line end ("quar-" then "ter") | Words cut in half by layout | A real compound split across lines ("well-" then "known") is joined too: "wellknown" |
| Join a line that stops mid-sentence to the next (only if the next starts lowercase) | Every visual line break inside a paragraph | Rare abbreviations ending a line |
| Remove page headers and footers that repeat exactly on most pages, and bare page numbers | "Acme Corp Confidential" in every chunk | A meaningful line that repeats exactly at the top of most pages would be removed |
| Leave TXT and Word alone (no PDF repairs) | Their line breaks are real | none |

Two safeguards make the header rule safe: lines are compared exactly, so "Invoice 1001" and "Invoice 1002" are never mistaken for one header, and pages with fewer than five lines of text are left untouched.

## Limits, and why each exists

- **300 pages.** A PDF built to have thousands of pages would tie the worker up.
- **60 seconds** per document, checked between pages.
- **3 million characters** of cleaned text.
- **Zip-bomb guard.** A Word file is a zip. A tiny zip can expand to gigabytes. We read only the table of contents (the declared sizes) and refuse anything that would unpack past 100 MB, without unpacking it.

## Failure is a result, not an accident

A file with no text (a scan, or only pictures) is not an error in our code. It is an answer: **Failed, with a reason a person can act on**: "This PDF has no readable text. It may be a scan or only pictures. Scanned documents are not supported yet." Reading scans needs OCR, which is out of scope for this project. The failure is stated plainly instead of the document quietly becoming an empty entry that never matches anything.

## Tradeoffs

- **Page-level storage vs one big string.** Pages cost a few more rows, and give us page numbers for citations, blank pages that keep their number, and pages as natural boundaries for chunking.
- **Conservative cleaning vs cleaner text.** We accept a little leftover noise to avoid deleting real content. Milestone 6 will measure whether more aggressive cleaning helps retrieval.
- **Reading order.** PDF text comes in the order it was drawn, not always the order a person reads it. Two-column pages and tables can come out interleaved. Known limit of this project (tables and scans are out of scope).

## Common mistakes

- Treating "extraction succeeded" as "extraction is good". A PDF can extract to nothing, or to garbage, without any error.
- Normalising digits when comparing lines, so numbered lines look identical.
- Dropping blank pages, which shifts every later page number.
- Joining every line break, which glues list items and headings together.
- Trusting the file's declared type or size, and reading it without limits.

## Interview questions

1. Why is text extraction the step that most affects RAG quality?
2. How do you handle a scanned PDF, and what does it look like when a system does not?
3. How would you remove repeated page headers safely, and what could go wrong?
4. What is a zip bomb, and how do you defend a service that opens uploaded Word files?
5. Why keep per-page text instead of one string per document?

## Try it

Upload `demo-files/facilities-guide.pdf`, wait for Ready, and click its name to read the extracted text. Look for the header ("Hartwell Offices Internal") and footer ("Page 1 of 3"), which should be gone, and for "quarter" in one piece on page 1. Then upload `demo-files/scanned-form.pdf` and read its failure reason.
