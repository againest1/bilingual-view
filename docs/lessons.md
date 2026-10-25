# Project lessons

## Translation: preserve literals without freezing word order

“Set X in Y” can correctly become “在 Y 中设置 X”: intact literals may change order during translation. Validate token identity, occurrence counts, and the supported Markdown boundaries while allowing grammatical reordering within those boundaries. Keep the translation prompt and validator consistent. See the [translation regression tests](../tests/translation.test.ts).

## Diagnosis: distinguish a reproduced defect from the original failure

A generic placeholder error cannot distinguish missing, duplicated, or moved tokens; retain specific diagnostics instead. If the rejected provider response is unavailable, a real source paired with a simulated response can establish a validator defect, but cannot establish the exact cause of the historical failure. Label simulated test responses explicitly and keep that evidence boundary clear. See the [offline cases](../tests/translation.test.ts) and [cached-error tests](../tests/display-retry.test.ts).
