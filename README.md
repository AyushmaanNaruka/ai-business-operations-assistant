# AI Business Operations Assistant

> **This README is a skeleton.** The six sections below are exactly the ones the assignment
> asks for. Fill each one as you build. Sections 2 and 6 draw on `docs/DECISIONS.md`,
> which should already be written by the time you get here. Delete this note before submitting.

A conversational assistant for business teams. Upload files or point it at a company website, ask questions, get analysis where the numbers are computed rather than guessed, research the public web, and turn the result into business ready deliverables.

Built with TypeScript and Mastra.

<p align="center">
  <a href="docs/media/demo.mp4">
    <img src="docs/media/demo-teaser.gif" alt="Demo: files are uploaded, a question is answered with visible SQL, a conflict between the notes and the data is surfaced, and an Excel workbook and client deck are generated" width="860">
  </a>
  <br>
  <sub><b><a href="docs/media/demo.mp4">▶ Watch the full 80 second demo, with sound</a></b> · every number on screen is computed from the sample data</sub>
</p>

## Quick start

```bash
npm install
cp .env.example .env         # add your keys, see docs/10-SETUP.md
npm run dev                  # Mastra Studio at localhost:4111
cd app && npm run dev        # chat UI at localhost:3000
```

Full setup, including free tier key sources: `docs/10-SETUP.md`

The chat UI keeps every conversation in a left sidebar (reopen one to continue where you left off, files included) and previews uploaded and generated files beside the chat.

**Models.** It runs free on Gemini and Groq for development, and on Claude or GPT once a company adds `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: every provider with a key is used, paid first, each falling back to the next. `MODEL_PROVIDERS` keeps company data off free tiers. See `docs/10-SETUP.md`, "Choosing models".

**Before sharing it with a team,** read `docs/11-SECURITY.md`: set a password (`APP_ACCESS_PASSWORD`), serve over HTTPS, and restrict providers. Research refuses internal addresses, API routes forward only validated input, and requests are rate limited.

---

## 1. Architecture

<!-- The diagram from docs/03-ARCHITECTURE.md Part 1, plus a paragraph explaining it.
     Then: four boxes, why exactly four, and why the artifact builder is a workflow
     rather than a fifth agent. Include the request flow from Part 2. -->

## 2. Key design decisions

<!-- Pull from docs/DECISIONS.md. Lead with the four that matter most:
     supervisor over agent network, DuckDB over a code interpreter,
     full context over RAG below a threshold, evidence ledger as the grounding spine. -->

## 3. How the multi-agent system works

<!-- The delegation contract: specialists receive a typed SpecialistTask and return a
     typed SpecialistResult, never chat history. Why (the .network() deprecation).
     Parallel versus sequential delegation. The gaps field as the anti hallucination
     mechanism. Two levels maximum. -->

## 4. How files and data are processed

<!-- Ingestion pipeline. Type detection. The structured versus unstructured split.
     The token routing decision for documents and its threshold. Page markers for
     citations. Tables inside documents going to DuckDB. Async ingestion and source
     status. What happens when a file fails. -->

## 5. How generated artifacts are created

<!-- The three layers: Skill for quality, Zod schema for structure, renderer for the
     file. The eight step workflow and the fact that only one step calls a model.
     Validation house rules. Live formulas in Excel. Native charts in PowerPoint.
     Versioning. -->

## 6. Important trade-offs

<!-- The hardest and most heavily weighted section. For each: what was chosen, what
     was given up, and under what conditions the other choice would be right.
     At minimum: SQL over code execution, context over retrieval, deterministic
     workflows over agent autonomy, typed contracts over shared context,
     free tier models over frontier models. -->

---

## Requirement coverage

<!-- Paste sections G and H of docs/02-REQUIREMENTS-MATRIX.md here so a reviewer
     can see the mapping without building it themselves. -->

## Generated artifacts

<!-- Link the two files in samples/generated/ and say in one line what each contains. -->

## Demo

**[Watch the product video (MP4, 80 seconds, with sound)](docs/media/demo.mp4)**

[![Demo video poster](docs/media/demo-poster.png)](docs/media/demo.mp4)

It follows scenario A from `docs/08-DEMO-SCENARIOS.md`: four Northwind files are uploaded, a campaign question is answered with the SQL visible and the data problems flagged (duplicates, mixed date formats, missing revenue, a too small sample), the customer notes are caught contradicting the spreadsheet on Paid Social, and an Excel workbook and client deck are generated from the evidence. The video is built with Remotion from `docs/demo-video/` (D-59), its figures are computed from `samples/campaigns.xlsx`, and its soundtrack is synthesised in code, so it is free to share anywhere.

## What is deliberately out of scope

<!-- From docs/01-PRD.md section 4. These are decisions, not omissions, and saying so
     is worth marks. -->

## Repository layout

<!-- The tree from AGENTS.md. -->
