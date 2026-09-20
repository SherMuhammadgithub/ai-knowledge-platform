import { describe, expect, it } from "vitest";
import { cleanPages, normalizeCharacters, removeRepeatedBoilerplate, repairPdfLines } from "../src/processing/clean-text";
import { PermanentProcessingError } from "../src/processing/errors";
import { extractDocument } from "../src/processing/extract-document";
import { itemsToText } from "../src/processing/extract-pdf";
import { DEFAULT_LIMITS } from "../src/processing/limits";
import { makeDocx, makePdf } from "./file-builders";

const reason = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PermanentProcessingError);
    return (err as PermanentProcessingError).reason;
  }
  throw new Error("expected the promise to fail");
};

// ---------- cleaning rules ----------

describe("normalizeCharacters", () => {
  it("expands ligatures, drops invisible characters, and turns odd spaces into normal ones", () => {
    expect(normalizeCharacters("o\uFB03ce and \uFB01nal")).toBe("office and final");
    expect(normalizeCharacters("co\u00ADoperate")).toBe("cooperate"); // soft hyphen
    expect(normalizeCharacters("a\u200Bb\uFEFFc")).toBe("abc"); // zero-width characters
    expect(normalizeCharacters("25\u00A0days\u202Fof   leave")).toBe("25 days of leave");
  });

  it("removes control characters but keeps line breaks, and unifies line endings", () => {
    expect(normalizeCharacters("a\u0000b\u0007c")).toBe("abc");
    expect(normalizeCharacters("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });
});

describe("repairPdfLines", () => {
  it("rejoins a word split by a line break", () => {
    expect(repairPdfLines("the first quar-\nter of the year")).toBe("the first quarter of the year");
  });

  it("joins a line that stops mid-sentence to the next", () => {
    expect(repairPdfLines("Employees are entitled\nto 25 days.")).toBe("Employees are entitled to 25 days.");
  });

  it("keeps paragraphs, sentence ends, headings and list items apart", () => {
    const text = "First paragraph ends here.\nSecond starts a new line.\n\nA heading\n- a list item\n- another item";
    expect(repairPdfLines(text)).toBe(text);
  });

  it("known cost: a real compound split across lines is joined too", () => {
    expect(repairPdfLines("a well-\nknown fact")).toBe("a wellknown fact");
  });
});

describe("removeRepeatedBoilerplate", () => {
  // Five body lines, so a page has enough text to tell body from header and footer.
  const body = (n: number) => [1, 2, 3, 4, 5].map((k) => `Body line ${k} of page ${n}, which is unique to it.`).join("\n");

  it("removes a header and a numbered footer that repeat on most pages, keeping the body", () => {
    const pages = [1, 2, 3, 4].map((n) => `Acme Corp Confidential\n${body(n)}\nPage ${n} of 4`);
    const { pages: cleaned, removed } = removeRepeatedBoilerplate(pages);
    expect(cleaned).toEqual([1, 2, 3, 4].map(body));
    expect(removed).toContain("Acme Corp Confidential");
  });

  it("never mistakes body lines that differ only by a number for a header", () => {
    // "Invoice 1001", "Invoice 1002": real content that happens to sit at the top of each page.
    const pages = [1001, 1002, 1003, 1004].map((n) => `Invoice ${n}\n${body(n)}\nTotal due for ${n}`);
    expect(removeRepeatedBoilerplate(pages).pages).toEqual(pages);
  });

  it("removes a page number that stands alone, in any of its usual forms", () => {
    const pages = ["3", "- 4 -", "5 / 9", "Page 6"].map((footer, i) => `${body(i)}\n${footer}`);
    const { pages: cleaned } = removeRepeatedBoilerplate(pages);
    expect(cleaned).toEqual([0, 1, 2, 3].map(body));
  });

  it("does nothing on short documents, where 'repeated' proves nothing", () => {
    const pages = ["Header\nBody one\nFooter", "Header\nBody two\nFooter"];
    expect(removeRepeatedBoilerplate(pages).pages).toEqual(pages);
  });

  it("leaves pages with very little text alone", () => {
    const pages = [1, 2, 3, 4].map((n) => `Acme Corp Confidential\nOne short line ${n}\nPage ${n} of 4`);
    expect(removeRepeatedBoilerplate(pages).pages).toEqual(pages);
  });

  it("keeps a repeated phrase that sits in the middle of the page", () => {
    const pages = [1, 2, 3, 4].map((n) => `Intro line ${n}\nLine two of ${n}\nNote: see section 4\nLine four of ${n}\nLine five of ${n}\nEnd ${n}`);
    const { pages: cleaned } = removeRepeatedBoilerplate(pages);
    expect(cleaned.every((page) => page.includes("Note: see section 4"))).toBe(true);
  });

  it("keeps a line that only some pages have", () => {
    const pages = [1, 2, 3, 4].map((n) => `${n < 3 ? "Draft notice" : "Chapter " + n}\n${body(n)}\nEnd ${n}`);
    expect(removeRepeatedBoilerplate(pages).pages).toEqual(pages);
  });
});

describe("cleanPages", () => {
  it("leaves TXT and DOCX paragraphs exactly as written (no PDF repairs)", () => {
    const text = "line one without a full stop\nlower case start";
    expect(cleanPages([text], { pdfLayout: false }).pages).toEqual([text]);
  });

  it("collapses runs of blank lines and trims each page", () => {
    expect(cleanPages(["\n\n  a  \n\n\n\n b \n\n"], { pdfLayout: false }).pages).toEqual(["a\n\nb"]);
  });
});

// ---------- positions to text ----------

describe("itemsToText", () => {
  const run = (str: string, x: number, y: number, width = 40) => ({ str, transform: [1, 0, 0, 1, x, y], width, height: 10 });

  it("starts a new line when the height changes, and a new paragraph on a big jump", () => {
    expect(itemsToText([run("one", 0, 700), run("two", 0, 686), run("three", 0, 640)])).toBe("one\ntwo\n\nthree");
  });

  it("puts a space between words drawn as separate runs on one line", () => {
    expect(itemsToText([run("Hello", 0, 700, 30), run("world", 40, 700, 30)])).toBe("Hello world");
  });

  it("does not add a space when the runs touch", () => {
    expect(itemsToText([run("quar", 0, 700, 20), run("ter", 20, 700, 15)])).toBe("quarter");
  });

  it("ignores the empty runs pdfjs uses to mark line ends", () => {
    expect(itemsToText([run("a", 0, 700), run("", 0, 700), run("b", 0, 686)])).toBe("a\nb");
  });
});

// ---------- whole files ----------

describe("PDF", () => {
  it("reads each page in order, removes the header and footer, and rejoins the split word", async () => {
    const pages = [
      ["Employee Handbook", "", "4.2 Annual leave. Full-time employees are entitled to 25 days of paid annual", "leave per calendar year. Unused days carry over for the first quar-", "ter of the next year."],
      ["4.3 Sick leave. Employees receive up to 10 paid sick days a year.", "A note from a doctor is required after", "three consecutive days of absence.", "Managers approve the leave request.", "Records are kept for two years."],
      ["4.4 Public holidays. Acme observes the public holidays of the country where the employee is based.", "Holiday pay follows the normal rate.", "Employees who work on a public holiday", "receive a day off in return.", "Managers agree the date with the team."],
    ];
    const pdf = await makePdf(pages, { header: "Acme Corp Confidential", footer: (n, t) => `Page ${n} of ${t}` });

    const result = await extractDocument("PDF", pdf);

    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toContain("Full-time employees are entitled to 25 days of paid annual leave per calendar year.");
    expect(result.pages[0]).toContain("for the first quarter of the next year.");
    expect(result.pages[1]).toContain("Sick leave");
    expect(result.pages.join("\n")).not.toContain("Confidential");
    expect(result.pages.join("\n")).not.toMatch(/Page \d of 3/);
    expect(result.removedBoilerplate).toContain("Acme Corp Confidential");
    expect(result.charCount).toBe(result.pages.reduce((n, p) => n + p.length, 0));
  });

  it("keeps a blank page as an empty page, so page numbers stay true", async () => {
    const pdf = await makePdf([["First page has text and enough of it."], [], ["Third page has text as well, enough for us."]]);
    const { pages } = await extractDocument("PDF", pdf);
    expect(pages).toHaveLength(3);
    expect(pages[1]).toBe("");
  });

  it("refuses a PDF with no text, and says it may be a scan", async () => {
    const message = await reason(makePdf([[], []]).then((pdf) => extractDocument("PDF", pdf)));
    expect(message).toMatch(/no readable text/);
    expect(message).toMatch(/scan/i);
  });

  it("refuses a damaged PDF", async () => {
    const message = await reason(extractDocument("PDF", Buffer.from("%PDF-1.4\nthis is not a real pdf body at all")));
    expect(message).toMatch(/could not be read/);
  });

  it("refuses a PDF with more pages than the limit", async () => {
    const pdf = await makePdf([["page one has some text"], ["page two has some text"], ["page three has some text"], ["page four has some text"]]);
    const message = await reason(extractDocument("PDF", pdf, { ...DEFAULT_LIMITS, maxPages: 3 }));
    expect(message).toContain("4 pages");
    expect(message).toContain("limit is 3");
  });

  it("gives up when reading takes longer than the time budget", async () => {
    const pdf = await makePdf([["some text on the only page of this file"]]);
    const message = await reason(extractDocument("PDF", pdf, { ...DEFAULT_LIMITS, timeoutMs: -1 }));
    expect(message).toMatch(/took too long/);
  });
});

describe("DOCX", () => {
  it("reads the paragraphs of a real Word file", async () => {
    const docx = makeDocx(["Remote work guidelines", "Employees may work remotely up to three days a week & agree it with a manager."]);
    const { pages } = await extractDocument("DOCX", docx);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Remote work guidelines");
    expect(pages[0]).toContain("three days a week & agree it with a manager.");
  });

  it("refuses a zip bomb from its declared sizes, without unpacking it", async () => {
    const bomb = makeDocx(["hello there, this file looks harmless"], 5 * 1024 * 1024); // ~5 MB of filler, tiny when compressed
    expect(bomb.length).toBeLessThan(100 * 1024);
    const message = await reason(extractDocument("DOCX", bomb, { ...DEFAULT_LIMITS, maxUncompressedBytes: 1024 * 1024 }));
    expect(message).toMatch(/too large to process once unpacked/);
  });

  it("refuses a damaged Word file", async () => {
    const message = await reason(extractDocument("DOCX", Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("junk that is not a zip")])));
    expect(message).toMatch(/could not be read/);
  });
});

describe("TXT", () => {
  it("reads text and drops a byte order mark", async () => {
    const { pages } = await extractDocument("TXT", Buffer.from("\uFEFFA short note, with a little content in it."));
    expect(pages).toEqual(["A short note, with a little content in it."]);
  });

  it("refuses text with nothing readable in it", async () => {
    expect(await reason(extractDocument("TXT", Buffer.from("   \n\n  ")))).toMatch(/no readable text/);
  });

  it("refuses more text than the limit", async () => {
    const message = await reason(extractDocument("TXT", Buffer.from("word ".repeat(100)), { ...DEFAULT_LIMITS, maxChars: 50 }));
    expect(message).toMatch(/too much text/);
  });
});
