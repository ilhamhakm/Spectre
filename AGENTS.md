# Workspace: Spectre (3D live globe webapp)

Next.js 15 + React 19 + Cesium + Tailwind v4. Visualizes satellites, flights, civil unrest heatmap, Sentinel imagery, 3D tiles, traffic. Sibling project to Palantir (`C:\Users\USER\Documents\Palantir`).

## Stack
- Next.js 15.1.6, React 19, Cesium 1.143 + Resium 1.18
- Tailwind v4, Zustand 5 (state), Zod 4 (validation)
- `@turf/turf` (geo), `papaparse` (CSV), `rss-parser` (feeds), `satellite.js` (orbits)
- Playwright for tests
- Sharp for image processing

## HARD RULES (non-negotiable, every session)

0. **NO EM DASHES.** Never use `—` (U+2014) or `–` (U+2013) anywhere: chat, files, code, comments, commit messages. User-standing rule across all workspaces. Use colon, period, comma, or restructure.

1. **PRE-RESPONSE GATE (run BEFORE forming any response).**
   - **Step 1: Is this trivial?** Trivial = factual answer, single-file edit under 20 lines, quick lookup, greeting. If trivial, answer directly, skip the gate.
   - **Step 2: Is this non-trivial?** Non-trivial = build work, decision support, multi-step tasks, "what do you think about X", "should I do Y", any creative/strategic/positioning question, any request to create/modify/revamp a feature, any request that begins with "I want to" or "let's" or "can you build". If non-trivial, you MUST run the full sequence BEFORE forming your substantive response:
     1. Load `brainstorming` skill (or `bmad-brainstorming`) FIRST, before any analysis, advice, or opinion. Not after. Not alongside. FIRST.
     2. Grill the user with sharp clarifying questions, one at a time, multiple choice preferred. Push back on contradictions. Do not be a yes-man.
     3. Write spec/plan as artifact (invoke `writing-plans` or `bmad-spec`/`bmad-architecture` for bigger builds). User reviews spec BEFORE implementation.
     4. Only after spec approval: execute (subagent-driven if parallelizable).
     5. Test against stated objective (Playwright for UI, relevant commands for non-UI). Use `verification-before-completion`.
   - **Step 3: When in doubt, treat as non-trivial.** The cost of a false-positive brainstorm is small (a few extra questions). The cost of skipping it is large (the user catches it, trust erodes, work has to be redone).

2. **Research before building.** Before proposing or implementing anything, check (in this order): Hugging Face, MCP servers registry, skills.sh + local `.agents/skills/` (in Koo), GitHub. Non-negotiable pre-work step. Skipping it and proposing from imagination is a rule violation.

3. Keep responses short by default. Answer in 1-3 sentences unless explicitly asked for detail.

## Idea-tools pipeline (sequential, when escalating work)

The skills are installed in the Koo workspace at `C:/Users/USER/Documents/Koo/.agents/skills/`. They auto-trigger when working inside Koo. For Spectre work done from outside Koo, reference them by name and route execution through Koo when needed.

1. `brainstorming` (or `bmad-brainstorming`) - explore problem space, surface assumptions, generate options BEFORE proposing solutions.
2. `grill-me` - interrogate the top idea with sharp clarifying questions, one at a time, multiple choice preferred. Push back on contradictions. No yes-man.
3. `openspec-explore` - write the spec/plan as an artifact. User reviews spec BEFORE any implementation.
4. `bmad-*` (BMAD-METHOD skill family) - multi-agent dev framework: `bmad-create-prd` -> `bmad-architecture` -> `bmad-spec` -> `bmad-create-epics-and-stories` -> `bmad-dev-auto` -> `bmad-qa-generate-e2e-tests`. Scaffolds implementation after spec approval.

This is the "brainstorm-grill-plan-test" HARD GATE. Trivial one-shot questions skip it.

## Project-specific notes

- See `OBJECTIVE.md` for the current enhancement backlog (satellites, private flights, civil unrest score, Sentinel imagery, traffic, 3D tiles, performance audit, testing).
- Design inspirations referenced in OBJECTIVE.md: Osiris, Velocity, World Monitor.
- Sibling project Palantir at `C:\Users\USER\Documents\Palantir` - shares the Next.js + Cesium stack, focused on 3D flight tracking.
- For UI/design work, consult the implementation backlog at `C:\Users\USER\Documents\New\Quiver\docs\implementation-backlog.md` (Bucket A: UI/Design stack).
