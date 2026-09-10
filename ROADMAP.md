# Development milestones

The first milestone prepares this repository for public inspection. Later milestones are planned work, not implemented features or validated results.

## 01 · Public development baseline

Publish accurate setup and architecture documentation, portable local configuration, dependency updates, and automated app checks. Acceptance: tests, lint and build pass; source and history have been reviewed for credentials; local in-progress work is preserved.

## 02 · Measured card recognition

Build a labelled real-shop-photo benchmark with documented image permissions and split rules. Report top-1/top-5 accuracy, latency, and errors by set/language. Compare the current retrieval and reranking stages before choosing a replacement. Acceptance: a repeatable benchmark command and an honest coverage report; no accuracy claim based only on synthetic images.

## 03 · Reliable pricing and hosted access

Record provider identity, card variant, condition, currency, and freshness for each price. Exercise provider timeouts and manual fallback. Before any internet deployment, add server-side authentication and API access controls. Acceptance: provider-contract tests, visible stale/missing-price states, and authenticated deployment checks without exposing account-backed sidecars.
