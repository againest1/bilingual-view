# Project Rules

1. `README.md` must contain only user-facing guidance. Whenever a change affects information or instructions covered by `README.md`, update it as part of the same change to keep it current.
2. During testing, never send live requests to official Claude (Anthropic) services or APIs. Use mocks or local test doubles instead.
3. Before adding complexity for a speculative or vanishingly unlikely race or security edge case, explain the concrete failure mode, likelihood, and complexity cost to the user and get their buy-in. Do not silently expand scope for theoretical robustness.

## Project Lessons

- Before related work, read relevant entries in `docs/lessons.md`, if it exists.
- Record only confirmed, non-obvious project insights that will help future decisions. Not every fix needs an entry; avoid duplicating existing guidance.
- Keep each lesson to a short paragraph: the pitfall and what to do next time, with a code or test link when useful. Omit investigation history, test counts, and speculation; retain uncertainty only when needed to avoid overstating the evidence.
- Keep `Project Rules` for durable project-wide policies. Do not promote individual fixes, implementation choices, or environment observations into rules.
- Prefer regression tests or automated checks for reliably detectable problems. Merge overlapping lessons and prune obsolete or redundant entries instead of appending history.
