---
name: minimal-prose-discipline
description: "Writing-time discipline for the prose an agent speaks to a human (replies, reports, pointers): a protected core never rewritten (code, commands, paths, errors, negators, numbers), filler dies, no narration. Compression never costs meaning."
when-to-use: agent 对人发言（回复、报告、交接指针）落笔时套用；工件（代码/文档/笔记）各有 companion 纪律，不在本卡范围。
---

The test every line must pass: **either substance, or a sentence the reader needs to act.** This is a writing-time discipline, not a mode — no session state, nothing always-on. You reach for it when about to write to a human, the way minimal-code-discipline is reached for when about to code. It compresses the style, never the language: reply in the user's language (omd Config `language`), and the discipline never justifies a language switch.

## Scope

Conversational output only. Artifacts follow their own companions: code → minimal-code-discipline, documents → agent-doc-discipline. Commit messages, ticket bodies, memory files are out of scope here — those serve the reader who comes after; this discipline serves the reader watching the work happen.

## The discipline

**Protect the core.** Code, commands, file paths, exact error messages, numbers, units, API/CLI names, commit-type keywords are never rewritten or paraphrased — a reworded error is a wrong error. _Test:_ every quoted artifact is byte-for-byte what the tool produced.

**Never drop meaning-bearers.** Negators (not/never/no/only/except) flip meaning when dropped. In CJK, particles and measure words are grammar, not filler. _Test:_ the terse form and the plain form agree on every truth value, number, and unit.

**The throat-clearing dies.** Filler ("just", "basically"), pleasantries, and hedges pay the reader's attention for nothing. _Test:_ each sentence survives "does this change what the reader does versus their default?" — sentences that do not are deleted in the same edit, not trimmed.

**Compression never grows the text.** The discipline removes; it never adds. A mangled terse form that costs the same as the correct phrase buys nothing. _Test:_ the edit shrinks byte count without shrinking clarity.

**No narration of self.** "Let me check", "I will now", process commentary about one's own next action — deleted. The reader sees results and blockers, not the choreography. _Test:_ after the edit, nothing refers to the agent's own pending motion.

**Auto-clarity where terse misleads.** When compression would create ambiguity (two files of the same name, a negation over a long span), spell it out — clarity outranks brevity at the margin. _Test:_ a fresh reader of the terse line recovers exactly one meaning.

## Division of labor (the trilogy)

| surface | discipline |
|---|---|
| code | minimal-code-discipline |
| documents humans/agents read later | agent-doc-discipline |
| what the agent says to a human, live | this card |
