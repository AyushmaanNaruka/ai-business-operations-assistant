# Workflows
Two of them. `ingestion` is fully deterministic with no model call. `artifact` has seven steps of which one calls a model (author and validate are one step, D-40), and suspends for user input after two failed validations. Spec: `docs/03-ARCHITECTURE.md` Part 4.
