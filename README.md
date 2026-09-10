# PokéArbitrage — Experiments in Card Recognition

An ongoing personal research project exploring image retrieval, OCR, and price matching for Japanese Pokémon cards. A mobile web interface provides a way to try the methods on shop photos and inspect where recognition or pricing breaks down.

The main question is how reliably visual features and printed information can identify an exact card, including its set, language, and variant. Price comparison is one application of that identification.

## Exploring the embedding space

[![3D UMAP projection of Japanese Pokémon card image embeddings](docs/figures/embedding-space.png)](docs/embedding-space.html)

**[Download the interactive 3D view](https://github.com/GrumpyPanda98/PokeArbitrage/raw/refs/heads/main/docs/embedding-space.html)** and open it in a browser to rotate the projection, search for cards, and inspect individual points. The HTML uses Plotly and card images from external hosts, so an internet connection is needed.

This saved experiment contains **23,362 Japanese cards**, using DINOv3 CLS and register-token features projected into three dimensions with UMAP. The figure is a way to inspect the representation; visual clusters alone do not establish identification accuracy. [Projection details](docs/figures/embedding-provenance.json).

The viewer comes from a later local DINOv3 experiment. The committed matcher currently uses an OpenCV baseline with optional DINOv2 embeddings; the viewer is an accompanying research artifact rather than evidence that the DINOv3 experiment is integrated into this code.

## Methods explored

- Card detection and normalisation with OpenCV.
- Candidate retrieval using perceptual similarity and pretrained image embeddings.
- OCR of names, collector numbers, and other regions of interest.
- Reranking with visual and metadata evidence, followed by matching to market-price sources.

The [architecture report](docs/pokearbitrage_architecture_report.pdf) describes the pipeline and its limitations. The [research milestones](ROADMAP.md) retain the evaluation-first direction: a labelled real-photo benchmark, analysis of errors, and targeted model changes informed by those results.

## Code and experimental environment

`src/` contains the Next.js/TypeScript interface, provider adapters, and calculations. `tools/card_matcher/` contains the Python recognition experiments; the other tools provide optional local OCR and live-pricing services.

This is a working research prototype with incomplete card and price coverage. Matches require confirmation, and reference prices are not guaranteed sale proceeds. Model weights, reference-image caches, personal photos, and credentials are not included.

For local inspection, use Node.js 22 LTS and `npm ci`, then `npm run dev`. The interface's default passcode is `Japan`; this is a convenience lock, not server-side authentication. Optional backend setup is documented in each tool's README and `.env.example`. Account-backed services need real access controls before internet deployment.

The available software checks are `npm test`, `npm run lint`, and `npm run build`. They check code behaviour, not real-photo recognition accuracy.
