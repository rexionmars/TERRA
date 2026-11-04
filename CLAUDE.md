@AGENTS.md

## For Claude Code

AGENTS.md above, and docs/CODE_STYLE.md, which it points to, are this repository's rules
for code. They are kept in AGENTS.md so that other coding agents read the same text.
Claude Code reads AGENTS.md only through the import on the first line.

On this machine, `/Users/fox/estudos/lucertae-research/.claude/CLAUDE.md` is a guide to
scientific writing. It applies to prose and figures: `paper/`, the report templates, and
any document that argues from a result. It does not apply to code. Its sections on
backend architecture (15 to 19) and on frontend architecture (20.1, 20.2) were written
for a hosted service. docs/CODE_STYLE.md, under Go and under TypeScript and React, says
why they do not fit a single desktop binary.
