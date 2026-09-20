// Writes a few sample files to demo-files/ (project root) that you can upload by hand to try the pipeline.
// Run: bun run samples
// All text is fictional and written for this demo. The files differ from the seeded documents on purpose, so
// uploading them never collides with the duplicate check.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeDocx, makePdf } from "./sample-files";

async function main() {
  const out = resolve(process.cwd(), "../../demo-files");
  mkdirSync(out, { recursive: true });
  const write = (name: string, data: Buffer | string) => {
    writeFileSync(join(out, name), data);
    console.log(`wrote demo-files/${name}`);
  };

  // A 3 page PDF with a repeated header, a numbered footer and a word split across a line: the shape real
  // documents have. After processing, the header and footer are gone and "quar-ter" reads "quarter".
  write(
    "facilities-guide.pdf",
    await makePdf(
      [
        ["Facilities Guide", "", "1.1 Building access. Staff badges open the main doors from 07:00 to 19:00 on", "weekdays. Visitors must be registered by their host before the first quar-", "ter of their visit begins."],
        ["1.2 Meeting rooms. Rooms are booked through the calendar and released", "automatically after 15 minutes if nobody has arrived.", "Catering orders need two working days notice.", "Cleaning happens every evening after 18:00.", "Report broken equipment to the facilities desk."],
        ["1.3 Parking. There are 40 spaces for staff, allocated by a monthly draw.", "Bicycle storage is free and needs no booking.", "Electric vehicle charging is available on level one.", "Visitors should use the public car park across the road.", "Questions go to the facilities desk."],
      ],
      { header: "Hartwell Offices Internal", footer: (n, t) => `Page ${n} of ${t}` },
    ),
  );

  write(
    "travel-policy.docx",
    makeDocx([
      "SAMPLE DOCUMENT. Fictional text written for demo data.",
      "Travel Policy",
      "Book flights and hotels through the company travel desk. Economy class is standard for flights under six hours.",
      "Hotel stays are reimbursed up to 150 dollars per night with a receipt.",
      "Trips longer than five days need approval from a director before booking.",
    ]),
  );

  write("meeting-notes.txt", "Product meeting, 12 March\n\nDecided to ship the beta in June.\nMaria owns the onboarding flow. Tom owns billing.\nNext review is on 26 March.\n");

  // Valid PDFs whose pages contain no text, like a scan made only of pictures. Processing fails with a reason.
  write("scanned-form.pdf", await makePdf([[], [], []]));

  // Not a PDF at all: plain text with a .pdf name. The upload refuses it at once.
  write("not-really-a-pdf.pdf", "This is just a text file that has been given a .pdf name.\n");

}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
