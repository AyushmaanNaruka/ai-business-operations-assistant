# Workflows
Two of them. `ingestion` is fully deterministic with no model call. `artifact` has eight steps of which one calls a model, and suspends for user input after two failed validations. Spec: `docs/03-ARCHITECTURE.md` Part 4.
