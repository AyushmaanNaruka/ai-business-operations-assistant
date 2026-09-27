# Generated artifacts

Sample output from the app, committed so a reviewer can open it without running anything. Both files come from a live run of scenario B in `docs/08-DEMO-SCENARIOS.md` (research on `https://taplio.com/`), copied unedited from the app's own `generated/` folder:

- `taplio-research-summary.docx`, the summary document: situation, three cited findings, a recommendation, "What we could not determine", and a Sources table.
- `taplio-client-presentation.pptx`, the client deck: five slides, a native editable chart, a source footer and speaker notes on every slide.

Every claim in them traces back to an evidence entry with the page URL it came from. They were made on the free fallback models before D-79, so the docx repeats a few citations and the deck has no closing Sources slide; the current code fixes both.
