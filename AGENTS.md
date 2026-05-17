# Codex Rules

## Main rule
Follow the user's task exactly. Do not add unrelated changes, refactoring, new features, packages, files, or architecture unless explicitly requested.

## If unclear
If requirements are ambiguous, stop and ask a clarifying question before changing code.

## Scope
Only modify files directly needed for the task.
Do not rename variables, components, services, routes, or folders unless required.
Do not change formatting globally.

## Before coding
First explain:
1. what files you will inspect
2. what change you plan to make
3. what assumptions you are making

Wait for confirmation if the change affects architecture, API contracts, database schema, dependencies, or business logic.

## Code style
Keep existing project style.
Use existing patterns and helpers.
Do not introduce new abstractions unless requested.

## Output format
After changes, report:
- changed files
- what exactly changed
- how to test
- any uncertainty