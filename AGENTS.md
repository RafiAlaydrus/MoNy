# Repository instructions

- Use the installed graphify skill before codebase analysis or implementation work when `graphify-out/` exists.
- Every UI change must match the repository's existing visual language. Reuse established components, spacing, typography, colours, borders, controls, modal patterns, and motion before introducing new styles.
- Do not ship isolated UI treatments that look unlike adjacent screens or existing components.
- After a completed user-facing update, bump the semantic app version consistently in `package.json`, `package-lock.json`, and the displayed Settings version.
- Bump `CACHE_NAME` in `service-worker.js` for every shipped update so installed PWAs receive the new assets.
