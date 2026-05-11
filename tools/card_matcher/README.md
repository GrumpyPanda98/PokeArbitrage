# Local Card Matcher

Research prototype for local Pokemon card image identification. It builds a local reference-image cache from TCGdex Japanese card images, then matches iPhone photos with a two-stage image similarity pipeline:

1. Coarse rank by perceptual hashes and color histograms.
2. Re-rank the best candidates with ORB keypoint matching.

This is intentionally separate from the Next.js app. Use it to measure accuracy before wiring anything into `/api/scan-card`.

## Setup

```powershell
cd C:\Users\nicko\Documents\GitHub\PokéArbitrage-card-id\tools\card_matcher
$py = "$env:USERPROFILE\.pyenv\pyenv-win\versions\3.12.2\python.exe"
& $py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Optional RTX 5090 Reranker

The baseline matcher is OpenCV-only so it is easy to run. This PC also has an `MNE` Conda environment with CUDA PyTorch for the RTX 5090. Install the matcher extras into that environment, then build a DINOv2 embedding index:

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

## Benchmark Real Photos

Create `samples/labels.csv` from `samples/labels.example.csv`, then run:

```powershell
.\.venv\Scripts\python.exe benchmark.py samples\labels.csv --top 5
```

The first useful target is top-5 accuracy on real iPhone shop photos. Only integrate this into the app after the benchmark is good enough.
