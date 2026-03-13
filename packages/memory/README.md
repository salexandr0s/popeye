# @popeye/memory

Memory policy module -- embedding eligibility, confidence decay, and classification
rules for the Popeye memory system. Determines which memories qualify for vector
embedding, how confidence scores decay over time without reinforcement, and whether
a given memory classification should be persisted.

## Key exports

- `decideEmbeddingEligibility(memory)` -- check if a memory qualifies for vector storage
- `computeConfidenceDecay(confidence, age, halfLife)` -- time-based confidence decay
- `shouldPersistClassification(type, confidence)` -- persistence threshold check

## Dependencies

- `@popeye/contracts`

## Layer

Runtime domain. Pure policy logic with no I/O or side effects.
