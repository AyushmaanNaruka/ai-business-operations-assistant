# AI Business Operations Assistant

A chat assistant for business teams. Upload your files — or just point it at a
company's website — ask it questions, and it does the work: it analyzes your
data, researches the web, and turns the result into a real report, spreadsheet,
or presentation. Numbers are always calculated, never guessed by the AI.

A few things you could say to it:

- "Analyze this campaign data and tell me what worked and what didn't."
- "Research this company and combine it with the data I uploaded."
- "Turn these findings into a presentation for the client."

Built with TypeScript and Mastra.

<p align="center">
  <a href="docs/media/demo.mp4">
    <img src="docs/media/demo-teaser.gif" alt="Demo: files are uploaded, a question is answered with visible SQL, a conflict between the notes and the data is surfaced, and an Excel workbook and client deck are generated" width="860">
  </a>
  <br>
  <sub><b><a href="docs/media/demo.mp4">▶ Watch the full 80 second demo, with sound</a></b> · an animated reconstruction of the UI, not a screen recording · every number on screen is computed from the sample data</sub>
</p>

## Quick start

```bash
npm install                  # installs everything, root and app/
cp .env.example .env         # add at least one model key — see docs/10-SETUP.md
cd app && npm run dev        # chat UI at localhost:3000
```

That's it — the chat UI is a complete, self-contained app. (There's an
optional second command, `npm run dev` from the root, that opens Mastra
Studio, a developer tool for inspecting what the agents are doing behind the
scenes. You don't need it just to use the assistant.)

Full setup instructions, including where to get a free API key: `docs/10-SETUP.md`.

**Which AI models does it use?** Free ones by default — Google Gemini and
Groq — so anyone can try it at no cost. If you add a paid `ANTHROPIC_API_KEY`
or `OPENAI_API_KEY`, it switches to Claude or GPT automatically, since those
give noticeably better answers. See "Choosing models" in `docs/10-SETUP.md`.

**Sharing this with a team?** Read `docs/11-SECURITY.md` first — set a
password, use HTTPS, and check which model providers you're sending data to.

---

## 1. Architecture — how it's put together

Think of it as a small team, not one AI doing everything:

- **The Orchestrator** is the project manager. It's the only one that talks
  to you. It figures out what you're asking for and hands the work to the
  right specialist below — it never touches a spreadsheet or a document
  itself.
- **The Data Analyst** handles spreadsheets and numbers. Every figure it
  reports comes from a real database query, not from the AI estimating.
- **The Document Agent** reads PDFs, Word files, and text files, and answers
  by quoting the exact passage it used.
- **The Research Agent** searches and reads public web pages when you ask it
  to look something up.
- **The Artifact Builder** turns whatever was found into a finished file —
  an Excel workbook, a slide deck, a written report. It isn't a fifth
  "thinker": building a file is always the same handful of steps, so it just
  follows them, the way a print shop follows a template rather than
  improvising.

```
        You: "analyse this data" / "research this company" / "build me a deck"
                                  |
                                  v
                          THE ORCHESTRATOR
                (figures out what you need, hands it off, then
                        explains the result back to you)
                                  |
            +----------+----------+-----------+
            v          v                      v
      DATA ANALYST  DOCUMENT AGENT       RESEARCH AGENT
      (spreadsheets)  (PDFs, Word)        (the public web)
            |          |                      |
            +----------+----------+-----------+
                                  |
                                  v
                         EVERY FACT FOUND IS
                         WRITTEN DOWN, WITH ITS SOURCE
                                  |
                     +------------+-------------+
                     v                          v
              YOUR CHAT ANSWER          ARTIFACT BUILDER
              (cites every number)    (turns facts into a
                                       report / deck / xlsx)
```

Whatever any specialist finds gets written down as a piece of "evidence" — a
fact, plus exactly where it came from and how it was worked out. Your chat
answer, and every generated document, is built only from that written-down
evidence. Nothing above it is allowed to state a number that isn't backed by
one; if something can't be determined, the assistant says so instead of
inventing an answer.

**Why four roles and not more?** It's tempting, in a "multi-agent" project,
to build one agent per feature. Something only becomes its own agent here if
it genuinely thinks differently and fails in a genuinely different way — bad
SQL, missing context, a dead web page. Building a file, by contrast, is
always the same fixed sequence with nothing to decide, so it's a workflow,
not a fifth agent: cheaper, faster, and it can be tested without ever calling
an AI model. The same is true of reading an uploaded file in the first place
— detecting whether it's a spreadsheet or a PDF needs no judgment either.

**One example, start to finish** (roughly what happens for "analyse this
campaign data"): you upload `campaigns.xlsx` → it's loaded into a real
database and profiled (1,203 rows, 11 columns) with no AI involved yet → your
question arrives and the Orchestrator recognises it as a data question → the
Data Analyst runs a few real SQL queries and hands back an answer plus the
evidence behind each figure → the Orchestrator writes that down and replies
to you, citing every number to the query that produced it. Nothing in that
answer was estimated.

## 2. Key design decisions

A handful of choices shaped everything else. (The full list, with the
reasoning behind each one, is in `docs/DECISIONS.md`.)

- **One manager, three specialists — not agents freely routing to each
  other.** Mastra used to support agents that hand work to one another
  automatically, but that approach was retired: context gets lost between
  hops and things break unpredictably a few levels deep. Instead, the
  manager gives each specialist one clear, self-contained task — never the
  whole conversation — and gets back a clear result. A little less
  "flexible," a lot easier to test and debug.
- **Numbers come from a real database, not from the AI doing math in its
  head.** Spreadsheets are loaded into DuckDB, a real SQL database that runs
  inside the app. The AI writes the query; the database computes the
  answer, every time.
- **Small documents are read whole; only large ones are searched.** A
  three-page brief goes into the AI's view in full, so nothing gets missed.
  A hundred-page report is too big for that, so it's split up and searched
  instead, pulling back just the relevant parts.
- **Every fact is tracked, with proof.** Nothing reaches an answer, a report,
  or a slide unless it's backed by a specific piece of evidence — a query, a
  document passage, or a web page with a retrieval date. This one rule is
  what stops the assistant from making things up.

## 3. How the multi-agent system works

The manager (Orchestrator) and a specialist only ever exchange two small,
well-defined things — never the whole back-and-forth conversation:

- **A task**, in plain terms: "here's what to find out, here's which files
  you're allowed to look at, here's what we already know."
- **A result**, in plain terms: "here's the answer, here's the evidence
  behind it, and here's what I couldn't determine" (if anything).

That last part matters most: a specialist that can't find something has a
proper way to say so, and the assistant is instructed to tell you about that
gap rather than quietly filling it with a guess. It also means each
specialist can be tested on its own, with no AI model involved, since the
task and the result are both just plain data.

**Working in parallel or one after another.** If two specialists don't
depend on each other — "research this company and analyse my data" — they
both run at the same time, roughly halving how long you wait. If one genuinely
needs the other's answer first — "research this company, then compare my
data against what you find" — they run in sequence, and the first
specialist's findings are handed to the second as a starting fact. That's
also how a detail from a document turns into a filter on a spreadsheet
query: a brief that says "mid-market, North America" becomes an actual
`WHERE` clause in the SQL the Data Analyst writes, and the answer tells you
it scoped things that way.

The Orchestrator itself never touches a spreadsheet, a document, or the web
directly — if it could, handing off work would be pointless. Its own job is
just to figure out what kind of request this is, decide who should handle it,
and turn what comes back into an answer you can act on.

## 4. How files and data are processed

- **What it can read:** Excel and CSV spreadsheets, PDF and Word documents,
  plain text files, and public web pages.
- **Spreadsheets** go into the real database mentioned above and get
  profiled automatically — row and column counts, data quality issues like
  missing values or inconsistent dates.
- **Documents** are converted to text with page markers kept in place, so
  the assistant can always tell you exactly which page a fact came from. If
  a document also contains a table (say, a pricing table inside a PDF),
  that table is pulled out and loaded into the database too, so numbers
  inside documents get calculated, not just read as text.
- **Small documents are read in full; large ones are searched instead** —
  the cutoff is around 25,000 words. This is explained more in the design
  decisions above.
- **File type is checked with the file itself, not a model.** Checking a
  file's actual contents (not just its name) is faster, cheaper, and more
  reliable than asking an AI to guess what kind of file it is.
- **Uploads happen in the background.** You see a file listed right away
  with a "processing" status, and it flips to "ready" once it's done, so one
  large file doesn't hold up the others.
- **Failures are handled gracefully, not silently.** A password-protected
  PDF, a scanned document with no readable text, an old `.xls` file, or a
  web page that blocks the assistant — each is reported to you in plain
  language, rather than crashing or returning nothing.

## 5. How generated documents are created

Building a report, spreadsheet, or deck is deliberately split into three
separate, simple pieces, a bit like a recipe (what makes it good), a
checklist (what shape the result must be), and a chef (who actually makes
it):

- **A short guide** (in plain markdown) describing what makes a good version
  of that document — a good client deck, a good Excel workbook, and so on.
- **A strict shape** the AI's draft must match — which sections it needs,
  that every number must cite where it came from, and so on.
- **Code that renders the real file** — an actual `.xlsx`, `.pptx`, or
  `.docx` — from that draft. This part never touches the AI at all, so it
  can't invent a number while assembling the file.

Only one step in the whole process calls an AI model at all — drafting the
content. Everything before and after that (deciding what kind of file is
needed, gathering the relevant facts, checking the draft, rendering the
actual file, saving it) is plain, predictable code. If the draft doesn't
meet the checklist — say, a chart with numbers that don't match the
evidence — it's sent back for another attempt automatically, and if it still
doesn't check out, you're told rather than handed a broken file.

A few concrete things that make the output usable, not just a wall of AI
text:

- **Excel workbooks have live formulas**, not pasted numbers — click a cell
  in the Calculations sheet and you see exactly how that figure was worked
  out, referencing the real data rows.
- **PowerPoint charts are native and editable**, not pasted-in images, so
  they look sharp and can still be edited in PowerPoint afterward.
- **Every generated file is versioned.** Asking for a shorter version of a
  deck creates a new one; the original stays available.

## 6. Important trade-offs

Every choice above cost something. Here are the ones most worth knowing
about (the reasoning behind every one of them, including smaller ones, is in
`docs/DECISIONS.md`):

| We chose | Instead of | What that costs us |
|---|---|---|
| Real SQL queries for every number | Letting the AI run generated Python/JS code | Some exotic analysis outside plain SQL and a small statistics toolkit is out of reach |
| Reading small documents in full, searching only large ones | One retrieval strategy for every document | Two code paths to maintain, and a size cutoff that needs the occasional tuning |
| A fixed, tested sequence for building a file | A fourth "artifact" agent that reasons freely about how to build it | Slightly less adaptive to a genuinely unusual request |
| Specialists that never see the full conversation, only a clear task | Letting them share the whole chat history | The manager has to be told explicitly when to hand off work — less improvisation |
| Free models by default, paid ones as an upgrade | Requiring a paid key from the start | Free-tier daily limits, and answers that read slightly differently if a request falls back to a different provider mid-conversation |

The one most worth defending in an interview: reading small documents in
full rather than always "searching" them. Search-based retrieval is the
conventional default, but on a three-page brief it can silently miss the one
sentence that mattered. Measuring each document and routing it accordingly
took more work to build than just picking one approach — but it means small
files get a genuinely complete read, and large ones still get proper search.

---

## Cost, speed, and handling many people at once

- **Repeated context is cached**, so a long conversation doesn't get
  progressively more expensive to keep going.
- **Only what's needed is shown to the AI** — a spreadsheet preview instead
  of the whole file, a handful of result rows instead of thousands.
- **Cheaper models handle simple steps** (like classifying what you're
  asking for); a stronger model is reserved for the actual analysis and
  writing.
- **Everyone's files stay separate.** If two people are using the app at
  once, each one can only ever see and query their own uploaded files.

## Testing status

- **704 out of 704 automated tests pass**, and none of them need an API key
  — anyone can verify the logic without spending a cent.
- The assistant has been run live, end to end, on a real conversation with
  four uploaded files: it answered with real computed numbers, caught a
  contradiction between a document and the spreadsheet, and generated a
  working Excel file and slide deck.
- A full, uninterrupted run needs a paid model key — the free-tier daily
  limits (Gemini's free tier allows 20 requests a day) aren't enough to
  finish a long conversation in one sitting. See `docs/10-SETUP.md` if you
  want to try it with a paid key.

The full requirement-by-requirement checklist against the original
assignment is in `docs/02-REQUIREMENTS-MATRIX.md`.

## What was deliberately left out

These are decisions, not oversights — each one was made on purpose rather
than left unaddressed:

| Not doing | Why |
|---|---|
| Reading scanned (image-only) PDFs | Detected and reported honestly, rather than pretending to read text that isn't there |
| Letting the AI run arbitrary code | Real SQL queries plus a small statistics toolkit cover realistic questions without needing a sandbox to secure |
| Connecting to live company databases or CRMs | Outside what the assignment asked for |
| Parsing the old `.doc` / `.xls` formats | No well-maintained way to read them; the assistant tells you to save as the modern format instead |
| User accounts and permissions | This is explicitly meant to be a focused project, not a production platform — one optional shared password covers sharing it with a team |

## Generated sample files

Two real files produced by the assistant, committed unedited in
`samples/generated/` so you can open them without running anything:

- **[`taplio-research-summary.docx`](samples/generated/taplio-research-summary.docx)**
  — a summary document from researching a company's website: the situation,
  three cited findings, a recommendation, and a sources table.
- **[`taplio-client-presentation.pptx`](samples/generated/taplio-client-presentation.pptx)**
  — a five-slide client deck with a real, editable PowerPoint chart and
  speaker notes on every slide.

Both came from a live conversation on 27 Sep 2026, on the free models (so the
writing reads a little plainer than it would on a paid model).

## Demo video

**This video is an animated recreation of the app, not a screen recording.**
It redraws the real chat interface and computes every number shown from the
actual sample data — it was built this way because free-tier rate limits
made it unreliable to record a live take on cue. To see the real, working
app, follow Quick start above.

**[Watch the product video (MP4, 80 seconds, with sound)](docs/media/demo.mp4)**

[![Demo video poster](docs/media/demo-poster.png)](docs/media/demo.mp4)

It walks through a realistic scenario: four files are uploaded, a question
about campaign performance is answered with the SQL behind it visible, a
contradiction between a customer-notes document and the spreadsheet is
caught and shown (not silently resolved one way), and an Excel workbook and
a client deck are generated from the findings.

## Project layout

```
src/
  mastra/       the AI agents, tools, and workflows
  modules/      the actual logic (database queries, file parsing, evidence
                tracking, document rendering...) — plain code, testable with
                no AI model involved at all
  types/        shared types
app/            the chat interface (Next.js)
skills/         short guides the agents read when building a document
samples/        sample files to try it with, and two real generated outputs
tests/grounding/  the four "does it ever make things up" checks
docs/           the full technical write-up, decision log, and setup guide
```

Most of the actual thinking lives in `src/modules/`, and every file there is
plain logic with no AI dependency — so it can be tested and understood on its
own, without running the app at all.
