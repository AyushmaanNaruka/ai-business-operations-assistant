# Product Requirements Document

**Product:** AI Business Operations Assistant
**Owner:** Ayushmaan Singh Naruka
**Status:** Design complete, build starting
**Deadline:** Monday 28 September 2026, 12:00 PM

---

## 1. The problem in one paragraph

A marketing or sales team receives information in pieces: a company brief as a PDF, campaign results in a spreadsheet, customer notes in documents, a competitor's website to look at. Getting from that pile to an answer, and from an answer to something they can send to a client, is hours of manual work every time. Nothing in that work is hard. All of it is tedious, and most of it is repeated.

## 2. Who it is for

A marketing or sales operations person. They are comfortable with spreadsheets and slide decks. They are not technical. They do not write SQL and will never see any. They judge the product on two things: whether the numbers are right, and whether the file they get back is good enough to send to a client without redoing it.

## 3. What it does

A chat interface where the user can:

- upload files (PDF, Word, Excel, CSV, text) and paste company website URLs
- ask questions that span all of those sources at once
- get analysis where the numbers are computed, not guessed
- ask for research on the public web and have it combined with their own data
- ask for the work to be turned into a report, spreadsheet, presentation, plan or brief
- keep going conversationally, referring back to earlier turns

## 4. What it explicitly does not do

| Not doing | Why |
|---|---|
| OCR on scanned PDFs | Detected and reported honestly. Vision fallback is a stretch goal |
| Run arbitrary generated code | SQL plus a stats library covers the realistic question space with no sandbox to secure |
| Connect to live CRMs or databases | Not in the brief. The unsupported path handles the ask cleanly |
| Parse legacy `.doc` and `.xls` | The only parsers are abandoned. Detected and reported |
| User accounts, roles, multi tenancy | The brief says explicitly not to build a production platform. For sharing inside a company there is one optional shared password gate (docs/11-SECURITY.md, D-57), not accounts |
| Deployment infrastructure | Runs locally, one command |

Naming these is part of the deliverable. They are decisions, not omissions.

## 5. User stories, with acceptance criteria

### US-1 Load information
*As a user I upload files and paste a URL so the assistant can work with my information.*

- Accepts .pdf, .docx, .xlsx, .csv, .txt, .md, .json and http(s) URLs
- Each source appears immediately with a status, and becomes usable when ready
- A failed source states why in plain language and does not block the others
- A scanned PDF is identified as having no extractable text rather than silently returning nothing
- Upload streams to disk; a file over the size cap is refused with a clear message

### US-2 Ask about my data
*As a user I ask questions about a spreadsheet and get correct numbers.*

- Every figure in the answer comes from a SQL query, never from the model
- The query behind any figure is viewable
- Open ended questions ("what trends do you see") produce a structured analysis, not one observation
- Small samples are flagged rather than reported as results
- Data quality issues found at profiling (high nulls, mixed date formats, duplicates) are surfaced

### US-3 Ask about my documents
*As a user I ask questions about a PDF or Word file and get answers with citations.*

- Answers cite source name plus page or section
- A question the document does not answer produces "not in this document", never a plausible invention
- Tables inside a document are analysable numerically, not read as prose

### US-4 Research a company
*As a user I give a company website and get a useful profile.*

- Produces a structured profile: what they do, who they sell to, positioning, products, pricing signals, recent activity
- Every claim carries a URL and the date it was read
- If the search quota is exhausted, it says so and does not answer from training data

### US-5 Reason across everything
*As a user I ask a question that needs my spreadsheet and a document and the web at once.*

- Facts from documents can constrain the data analysis, not just sit beside it in the answer
- Where two sources disagree, both are shown with their sources
- Each part of the answer is attributable to its source

### US-6 Get a deliverable
*As a user I ask for a report, spreadsheet, presentation, plan or brief.*

- The file contains structured content, not the chat reply pasted in
- The Excel file contains live formulas, not pasted values, and both recommendations and the supporting data
- The deck has native editable charts and speaker notes
- Every artifact records the evidence it was built from
- A request for an artifact type not explicitly supported still produces a well structured document

### US-7 Keep talking
*As a user I refer back to earlier turns without repeating myself.*

- "Now compare it with the target company" resolves from loaded sources
- "Turn this into a proposal" scopes to what the conversation has established
- A reference that cannot be resolved produces one short question, not a guess
- Revising an artifact keeps the earlier version available
- A request with several parts shows a plan and streams progress

## 6. Success criteria

The submission succeeds if a reviewer can:

1. Clone, run one setup command, and have it working with no Docker and no cloud signup
2. Follow the demo and see every claim in the README demonstrated
3. Open the two generated artifacts and find them genuinely usable
4. Ask the system something the data cannot answer and watch it decline cleanly
5. Read the README and understand the architecture and its trade offs without reading code

## 7. Quality bar, stated as failures we will not ship

- A number in an answer that no query produced
- A generated file that is the chat reply in a wrapper
- A crash, a stack trace, or a spinner that never resolves
- A confident answer to a question the sources cannot support
- A silently wrong aggregate over a dirty column
- An answer that blends three sources with no way to tell which said what
