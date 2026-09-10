# Local Card Matcher / Identifier V2

Research prototype for local Pokemon card image identification. V1 built a local reference-image cache from TCGdex Japanese card images, then matched iPhone photos with a two-stage image similarity pipeline:

1. Coarse rank by perceptual hashes and color histograms.
2. Re-rank the best candidates with ORB keypoint matching.

V2 keeps that baseline but adds the production-shaped contract:

1. Normalize/crop the card with OpenCV.
2. Optionally OCR high-value ROIs with PaddleOCR.
3. Retrieve visual candidates with the image index and optional DINOv2 embeddings.
4. Rerank with visual, name, collector number, language, set, and variant evidence.
5. Return `canonical_print_uid`, score breakdowns, candidates, and marketplace search queries.

## Setup

```powershell
cd tools/card_matcher
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Optional RTX 5090 Reranker

The baseline matcher is OpenCV-only so it is easy to run. The following optional commands assume you have created a compatible Conda environment named `MNE` with CUDA PyTorch. Install the matcher extras into that environment, then build a DINOv2 embedding index:

```powershell
$conda = "$env:USERPROFILE\anaconda3\Scripts\conda.exe"
& $conda run -n MNE python -m pip install -r requirements.txt -r requirements-gpu.txt
& $conda run -n MNE python build_index.py --language ja --set-id SV2a
& $conda run -n MNE python build_embeddings.py --language ja --model facebook/dinov2-base --device cuda
```

Then pass the embedding index when matching:

```powershell
& $conda run -n MNE python match_card.py path\to\photo.jpg --embedding-index cache\ja_embeddings_facebook_dinov2-base.npz --device cuda
```

For camera-shot debugging, write the crops that the matcher actually compared:

```powershell
& $conda run -n MNE python match_card.py path\to\photo.jpg --embedding-index cache\ja_embeddings_facebook_dinov2-base.npz --device cuda --debug-dir reports\last-crops
```

When the Next.js app is hosted with `LOCAL_CARD_MATCHER_DEBUG_DIR` set, phone scans write the same normalized crops there.

## V2 Catalog And Gallery

The canonical identity is:

```text
<language>:<set_id>:<collector_number_or_localId>:<variant_class>
```

Collector numbers stay as strings so leading zeroes, promo prefixes, and slash totals are preserved.

```powershell
& $conda run -n MNE python sync_catalog.py --language ja --latest-first --max-sets 24
& $conda run -n MNE python build_gallery.py --language ja --latest-first --max-sets 24
& $conda run -n MNE python build_embeddings.py --language ja --model facebook/dinov2-base --device cuda
```

FAISS is supported as the production vector-store direction, but the MVP matcher still works with the `.npz` DINOv2 matrix if FAISS is not installed.

```powershell
& $conda run -n MNE python build_faiss.py --language ja --model facebook/dinov2-base
```

TCGdex does not expose image-backed detail records for every Japanese print. For broad Japanese coverage, build from the official Japanese card search instead:

```powershell
& $conda run -n MNE python build_official_jp_gallery.py
& $conda run -n MNE python build_embeddings.py --index cache\ja_official_image_index.json --language ja_official --device cuda --batch-size 128 --clean-scans
```

## Build A Japanese Reference Index

Start small while testing. This downloads set metadata and card images into `cache/`, which is ignored by git.

```powershell
.\.venv\Scripts\python.exe build_index.py --language ja --set-id SV2a
```

For a larger index, pass more `--set-id` values, or use `--max-sets 12` to walk Japanese sets until it finds sets with downloadable card art.

## Match One Photo

```powershell
.\.venv\Scripts\python.exe match_card.py path\to\photo.jpg --top 10
```

The output includes the card id, name, set, collector number, image URL, and score diagnostics.

For the V2 output contract:

```powershell
& $conda run -n MNE python match_card_v2.py path\to\photo.jpg --index cache\ja_image_index.json --embedding-index cache\ja_embeddings_facebook_dinov2-base.npz --device cuda --json
```

Add `--ocr` after PaddleOCR is installed to include ROI-aware name, collector-number, attack, and language evidence.

## Benchmark Real Photos

Create `samples/labels.csv` from `samples/labels.example.csv`, then run:

```powershell
.\.venv\Scripts\python.exe benchmark.py samples\labels.csv --top 5
```

The benchmark reports top-1, top-5, top-20, and MRR. The first useful target is top-5 accuracy on real iPhone shop photos.

To create rectified crops and ROI images for OCR/detector labeling:

```powershell
& $conda run -n MNE python export_training_data.py samples\labels.csv --output-dir reports\training-export
```

## Next.js Integration

`/api/scan-card` calls `match_card_v2.py` by default through `LOCAL_CARD_MATCHER_SCRIPT`. From the repository root, the following PowerShell example enables phone testing on a trusted local network. Set `POKEARB_DEV_ORIGINS` to your development machine's hostname or LAN IP when needed; do not expose the Python services.

```powershell
$env:LOCAL_CARD_MATCHER_CACHE_DIR=Join-Path $PWD 'tools/card_matcher/cache'
$env:LOCAL_CARD_MATCHER_DEBUG_DIR=Join-Path $PWD 'tools/card_matcher/reports/last-crops'
$env:LOCAL_CARD_MATCHER_TOP='8'
npm.cmd run dev -- --hostname 0.0.0.0 --port 3000
```
