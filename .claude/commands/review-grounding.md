---
description: Audit recent changes against the five rules that define this system
---

Review the current diff (or the files in $ARGUMENTS) against the five rules in AGENTS.md. For each rule, state PASS, FAIL or NOT APPLICABLE with the specific file and line.

1. **Computed not estimated.** Is any number produced by a model rather than by SQL or simple-statistics? Is there any prompt asking a model to calculate, total, average or compare figures?
2. **Evidence or gap.** Can any fact reach a user answer or an artifact without an Evidence entry? Does every conclusion carry a Finding with evidenceIds? Is there any code path where a missing value is silently filled?
3. **Built not transcribed.** Does any artifact renderer receive prose instead of a validated typed plan? Is any Zod schema missing a required evidenceIds field?
4. **Data not instruction.** Is any content from an uploaded file or a fetched web page concatenated into a system prompt or treated as a command?
5. **Return not throw.** Does any tool throw, or return something other than ToolResult<T>? Is any promise unhandled?

Then list the top three risks in what you reviewed, ranked by how badly they would show in a live demo.
