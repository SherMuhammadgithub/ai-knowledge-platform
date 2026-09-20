import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanFileName, detectKind } from "../src/documents/file-type";
import { LocalDiskStorage } from "../src/storage/local-disk.storage";

describe("detectKind: what a file really is", () => {
  it("recognises a PDF, a DOCX and plain text", () => {
    expect(detectKind(Buffer.from("%PDF-1.7\n..."))).toBe("PDF");
    expect(detectKind(Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("[Content_Types].xml word/document.xml")]))).toBe("DOCX");
    expect(detectKind(Buffer.from("Just some text, with accents: café."))).toBe("TXT");
  });

  it("does not take a zip that is not a Word file for a DOCX", () => {
    // Real zip headers contain zero bytes (version, flags, sizes), which is also why a zip is never mistaken for text.
    const xlsxLike = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4, 0x14, 0, 0, 0, 8, 0]), Buffer.from("[Content_Types].xml xl/workbook.xml")]);
    expect(detectKind(xlsxLike)).toBeNull();
  });

  it("rejects executables and other binary data", () => {
    expect(detectKind(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100, 0)]))).toBeNull();
    expect(detectKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBeNull(); // PNG
    expect(detectKind(Buffer.from([0xff, 0xfe, 0xfa, 0xfb]))).toBeNull(); // not valid UTF-8
  });
});

describe("cleanFileName: display text only", () => {
  it("drops folder parts, including Windows and traversal tricks", () => {
    expect(cleanFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(cleanFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("removes control characters", () => {
    expect(cleanFileName("bad\u0000na\nme.txt")).toBe("badname.txt");
  });

  it("keeps non-ASCII names, which arrive as latin1 from the upload library", () => {
    const asLatin1 = Buffer.from("résumé.txt", "utf8").toString("latin1");
    expect(cleanFileName(asLatin1)).toBe("résumé.txt");
  });

  it("shortens very long names but keeps the extension", () => {
    const name = cleanFileName(`${"a".repeat(500)}.pdf`);
    expect(name.length).toBe(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("never returns an empty name", () => {
    expect(cleanFileName("")).toBe("document");
    expect(cleanFileName("///")).toBe("document");
  });
});

describe("LocalDiskStorage", () => {
  let dir: string;
  let storage: LocalDiskStorage;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "akp-storage-unit-"));
    storage = new LocalDiskStorage(dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("stores and reads bytes back", async () => {
    await storage.put("ws-1/doc-1", Buffer.from("hello"));
    expect((await storage.read("ws-1/doc-1")).toString()).toBe("hello");
  });

  it("refuses keys that could leave the storage folder", async () => {
    for (const key of ["../evil", "ws/../../evil", "/etc/passwd", "ws\\..\\evil", "ws//doc", "", "ws/doc/"]) {
      await expect(storage.put(key, Buffer.from("x")), `key ${JSON.stringify(key)}`).rejects.toThrow(/Invalid storage key/);
    }
  });

  it("never overwrites: a key is written once", async () => {
    await storage.put("ws-2/doc-1", Buffer.from("first"));
    await expect(storage.put("ws-2/doc-1", Buffer.from("second"))).rejects.toThrow();
    expect((await storage.read("ws-2/doc-1")).toString()).toBe("first");
  });

  it("deleting something that is not there is fine", async () => {
    await expect(storage.delete("ws-3/missing")).resolves.toBeUndefined();
  });

  it("deletePrefix removes a whole workspace folder", async () => {
    await storage.put("ws-4/a", Buffer.from("a"));
    await storage.put("ws-4/b", Buffer.from("b"));
    await storage.deletePrefix("ws-4");
    await expect(storage.read("ws-4/a")).rejects.toThrow();
  });
});
