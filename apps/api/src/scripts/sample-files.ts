import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Builds real PDF and Word files from text. Used by the demo seed and by the tests, so both work with
// genuine files. pdf-lib is a development dependency: this file is only ever loaded by scripts and tests.

/** Each page is a list of lines, drawn top to bottom. Optional header and footer repeat on every page. */
export async function makePdf(pages: string[][], opts: { header?: string; footer?: (n: number, total: number) => string } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, index) => {
    const page = doc.addPage([595, 842]);
    if (opts.header) page.drawText(opts.header, { x: 50, y: 790, size: 10, font });
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 16, size: 11, font }));
    if (opts.footer) page.drawText(opts.footer(index + 1, pages.length), { x: 50, y: 40, size: 10, font });
  });
  return Buffer.from(await doc.save());
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A real, minimal Word file: a zip with the three parts Word needs. `padding` adds highly compressible filler. */
export function makeDocx(paragraphs: string[], padding = 0) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>`).join("");
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` +
    "<!--" + "a".repeat(padding) + "-->";
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": strToU8(document),
    }),
  );
}

/** A three page handbook with a repeated header and a numbered footer: the shape real documents have. */
export const handbookPdf = () =>
  makePdf(
    [
      ["Employee Handbook", "", "4.2 Annual leave. Full-time employees are entitled to 25 days of paid annual", "leave per calendar year. Unused days carry over for the first quar-", "ter of the next year."],
      ["4.3 Sick leave. Employees receive up to 10 paid sick days a year.", "A note from a doctor is required after", "three consecutive days of absence.", "Managers approve the leave request.", "Records are kept for two years."],
      ["4.4 Public holidays. Acme observes the public holidays of the country where the employee is based.", "Holiday pay follows the normal rate.", "Employees who work on a public holiday", "receive a day off in return.", "Managers agree the date with the team."],
    ],
    { header: "Acme Corp Confidential", footer: (n, t) => `Page ${n} of ${t}` },
  );

/** A valid PDF whose pages contain no text at all, like a scan made only of pictures. */
export const blankPdf = () => makePdf([[], []]);
