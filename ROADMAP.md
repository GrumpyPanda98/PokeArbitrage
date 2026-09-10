# Research milestones

The public baseline is complete. The remaining milestones organise the research around measured recognition errors; they do not represent implemented features or validated results.

## 01 · Public development baseline (complete)

Publish accurate setup and architecture documentation, portable local configuration, dependency updates, and automated app checks. Acceptance: tests, lint and build pass; source and history have been reviewed for credentials; local in-progress work is preserved.

## 02 · Measured card recognition

Build the planned 200–500-image real-shop-photo benchmark with documented image permissions and split rules. Report top-1/top-5 accuracy, latency, and errors by set/language. Measure optional ROI OCR, reconcile Japanese collector numbers and set totals, add development-only recognition diagnostics, and benchmark price OCR. Acceptance: a repeatable benchmark command and an honest coverage report; no accuracy claim based only on synthetic images.

## 03 · Evidence-led recognition and app improvements

Use measured failures to prioritise the existing detector, set-symbol, and foil/variant classifier plans. Move retrieval to FAISS or Qdrant only when latency or filtering justifies it, and add export/import for deals and settings. Acceptance: benchmark comparisons show what improves, persisted data round-trips correctly, and provider identity, condition, currency, and freshness remain traceable.

The original [architecture report](docs/pokearbitrage_architecture_report.pdf) remains the detailed source for the longer-term roadmap: learned reranking, optional embedding fine-tuning, wider English/Japanese gallery coverage, offline use, and multi-card scanning. These are future directions, not features completed by this publication cleanup. Any internet deployment also needs server-side authentication and API access controls before enabling account-backed services.
