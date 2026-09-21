# Corpus licences

Every document used in the evaluation corpus is public, and its source and licence are recorded here before it is used. Text from this corpus may be sent to Gemini's free tier (the project rule allows public documents only).

## Candidates checked on 2026-09-21

Checked by reading the licence text or the licence statement on the source itself, not from memory.

| Candidate | What the source says | Verdict |
|---|---|---|
| **GOV.UK employment guidance** (for example https://www.gov.uk/holiday-entitlement-rights) | Terms page: "Most content on GOV.UK is subject to Crown copyright protection and is published under the Open Government Licence (OGL), which also sets out which content is exempt." A guide page: "All content is available under the Open Government Licence v3.0, except where otherwise stated." | Usable. Attribution required as the OGL says. Exempt content must be avoided, so each page is checked. |
| **Kubernetes documentation** (https://github.com/kubernetes/website) | README: documentation under CC-BY-4.0. | Usable. Attribution required. |
| **The Rust book** (https://github.com/rust-lang/book) | Dual licence: Apache-2.0 and MIT. | Usable. Keep the licence notices. |
| **GitLab handbook** (https://handbook.gitlab.com) | The repository `LICENSE` is the MIT licence "with regard to the GitLab Software" and says nothing specific about the handbook text. The website footer says "All Rights Reserved". | **Not used.** The two statements disagree and neither clearly covers the text. |
| **Basecamp handbook** (https://github.com/basecamp/handbook) | The repository has no licence file (GitHub's licence check returns "Not Found"). | **Not used.** With no licence, all rights are reserved. |

## The chosen corpus: GOV.UK employment guidance

Chosen 2026-09-21. All seven documents are GOV.UK guides published under the **Open Government Licence v3.0** (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). None of the guides shows a third-party copyright or licence exception, checked by searching each page's text. The guides are used only as test text for this project. They describe UK employment rules, may be out of date (several pages were last updated between 2014 and 2018), and are not advice.

**Attribution:** Contains public sector information licensed under the Open Government Licence v3.0. The same sentence and the source address are at the end of every file.

**Changes made:** HTML converted to plain text: headings kept as their own lines, links removed, bullet items as '- ' lines, table rows joined with ' | ', source and attribution lines added at the end. The full record, with a checksum for every file, is `eval/corpus/manifest.json`. Rebuild with `bun run --cwd eval build-corpus`.

| Document | Source | Fetched | Characters | File |
|---|---|---|---|---|
| Holiday entitlement | https://www.gov.uk/holiday-entitlement-rights | 2026-09-21 (page last updated 2014-11-17) | 13,965 | `govuk/govuk-holiday-entitlement-rights.txt` |
| Statutory Sick Pay (SSP) | https://www.gov.uk/statutory-sick-pay | 2026-09-21 (page last updated 2015-03-09) | 4,188 | `govuk/govuk-statutory-sick-pay.txt` |
| Redundancy: your rights | https://www.gov.uk/redundancy-your-rights | 2026-09-21 (page last updated 2024-11-08) | 13,088 | `govuk/govuk-redundancy-your-rights.txt` |
| Maternity pay and leave | https://www.gov.uk/maternity-pay-leave | 2026-09-21 (page last updated 2015-04-06) | 6,201 | `govuk/govuk-maternity-pay-leave.txt` |
| Paternity pay and leave | https://www.gov.uk/paternity-pay-leave | 2026-09-21 (page last updated 2024-11-27) | 9,895 | `govuk/govuk-paternity-pay-leave.txt` |
| Flexible working | https://www.gov.uk/flexible-working | 2026-09-21 (page last updated 2018-12-18) | 7,215 | `govuk/govuk-flexible-working.txt` |
| Maximum weekly working hours | https://www.gov.uk/maximum-weekly-working-hours | 2026-09-21 (page last updated 2015-03-09) | 4,587 | `govuk/govuk-maximum-weekly-working-hours.txt` |

