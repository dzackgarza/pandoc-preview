# Verify Interpretations Before Memorizing

**When this applies:** any time I am about to write or update a memory that encodes an *interpretation* of events (why something failed, what a decision meant, whether an artifact is laundering) rather than a directly observed fact.

**Rule (user feedback, 2026-06-12):** do not commit interpretive conclusions to memory before verifying the interpretation — against transcripts, git history, or by checking with the user.
In this project I encoded "DEVIATIONS.md user-approval = laundering" and "halted milestone = abandonment" into the threat-model memory from a single repo snapshot, without reading the session transcripts; the user corrected the temporal logic and flagged the premature write as bad.

**How to apply:** observed facts (file contents, command output, user-stated decisions) may be memorized immediately.
Causal narratives, blame assignments, and theory-of-mind claims about *why* an artifact exists get memorized only after grounding — read the relevant transcript (`reading-transcripts` skill) or ask.
A repo snapshot of interrupted work is not evidence of a completed failure: check whether the state was halted mid-plan before characterizing it.

**Verify:** every interpretive memory names its evidence source (transcript session, commit, user message), not just the artifact it interprets.
