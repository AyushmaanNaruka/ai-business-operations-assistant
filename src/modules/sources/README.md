# M1 Sources: ingestion and registry
Spec: `docs/04-MODULES.md` section M1.
Pure logic, no Mastra imports, no model calls. Detect type, parse, register, profile, produce a source card. Documents are also scanned for tables and registered in DuckDB. Runs async: upload returns a `pending` source.
