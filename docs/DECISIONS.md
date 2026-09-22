# Decision log

Five lines per decision: what was chosen, what the alternative was, why. **Append as you go, not at the end.** By Sunday this file is the README's hardest section already written, and it is the direct answer to the evaluation criterion about explaining technical trade offs.

Format:

```
## D-nn Title
Date, one line of context
**Chose:** ...
**Over:** ...
**Because:** ...
**Cost:** what this decision makes harder
```

---

## D-01 Supervisor plus subagents, not an agent network
22 Sep 2026, choosing the multi agent topology.
**Chose:** One orchestrator with three specialists, two levels deep, communicating through typed task contracts.
**Over:** Mastra's `Agent.network()` LLM routed topology, or a flat single agent with every tool.
**Because:** `.network()` was deprecated in February 2026 after context loss between hops, routing that broke across providers, and streaming failing at three levels of nesting. Typed contracts make each specialist unit testable without a model.
**Cost:** The orchestrator must be explicitly told when to delegate. Less emergent flexibility than LLM routing.

## D-02 DuckDB and SQL, not a code interpreter
22 Sep 2026, deciding how numerical analysis happens.
**Chose:** Agent writes SQL, DuckDB executes it in process, read only with external access disabled.
**Over:** Generating Python or JavaScript and running it in a sandbox (isolated-vm, Docker, E2B).
**Because:** SQL is the most reliable code an LLM generates. DuckDB reads xlsx and csv directly, is out of core so large files do not kill the process, and needs no sandbox because the blast radius of a read only SELECT is tiny.
**Cost:** Exotic analysis that SQL cannot express is out of reach. Mitigated with a fixed stats tool.

## D-03 Full context by default, RAG only for large documents
22 Sep 2026, deciding how documents are read.
**Chose:** Measure tokens at ingest. Under about 25,000 tokens the whole document goes into context; over it, chunk and retrieve.
**Over:** RAG for every document, which is the conventional choice.
**Because:** Retrieval on a three page brief can silently miss the relevant sentence, cannot answer whole document questions, and severs cross references, while adding an embedding call and a retrieval call. Reliability and latency are both graded.
**Cost:** Two code paths instead of one, and a threshold that needs tuning against real files.

## D-04 The artifact builder is a workflow, not an agent
22 Sep 2026, deciding where artifact generation lives.
**Chose:** An eight step Mastra workflow where only the authoring step calls a model.
**Over:** A fourth specialist agent with rendering tools.
**Because:** Building a file is a known sequence with nothing to reason about. A workflow is cheaper, faster, unit testable and cannot wander off. Mastra's own guidance is to default to deterministic.
**Cost:** Less adaptive if a user asks for something genuinely novel. Mitigated by the generic-document fallback.

## D-05 Evidence ledger as the single source of facts
22 Sep 2026, deciding how grounding works.
**Chose:** Every fact is an Evidence entry with an origin and a method; every conclusion is a Finding citing evidence IDs.
**Over:** Instructing the model to cite its sources in prose.
**Because:** One small typed store answers five graded criteria at once: grounding, no fabrication, traceability, multiple sources, and conflicting information. Instructions are not enforcement.
**Cost:** Every specialist has to construct evidence entries, which is extra code in every tool.

## D-06 Skills carry artifact quality, schemas carry structure
22 Sep 2026, deciding how artifact quality is encoded.
**Chose:** Three layers. A Mastra Skill says what good looks like, a Zod schema says what shape it must be, a renderer turns it into a file.
**Over:** One large prompt per artifact type containing all three concerns.
**Because:** Deck quality can then be improved by editing a markdown file, the skill is readable by a non engineer, and skills load on demand so Excel guidance is not in context during a "hello".
**Cost:** Three places to look when an artifact comes out wrong.

## D-07 File content is data, never instruction
22 Sep 2026, handling documents that contain requirements.
**Chose:** Tasks found inside an uploaded document are extracted into `proposedTasks` and surfaced to the user for approval.
**Over:** Acting on them automatically, which would be a nicer demo.
**Because:** Executing instructions found in user supplied files is a prompt injection path. The brief mentions "a set of research requirements" as an input, so this case will occur.
**Cost:** One extra confirmation step in a flow that could have been automatic.

---

<!-- Append new decisions below as you make them. -->
