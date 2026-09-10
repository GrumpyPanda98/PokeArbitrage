# CardScope · DINOv3 recognition experiments

Local image retrieval and identification for Japanese Pokémon cards. The representation uses `timm/vit_base_patch16_dinov3.lvd1689m` with mean pooling over the CLS token and four register tokens, followed by L2 normalisation. Cosine retrieval is combined with OpenCV evidence and optional OCR/metadata reranking.

Reference indexing stores full-card, margin-cropped, and artwork views. The embedding-space figure selects the first full-card vector for each card. Pooling metadata is saved in new embedding indexes so query and reference vectors use the same representation.

## Environment

Run these commands from `tools/card_matcher/`. Python 3.12 is used for the matcher checks. Install a PyTorch build suitable for your CPU or CUDA version, then:

```sh
python -m pip install -r requirements.txt -r requirements-gpu.txt
```

Model weights are obtained through Hugging Face and follow the model's own access and licence terms. Once cached, local inference can run offline. The published setup was checked with Transformers 5.8 and timm 1.0.27, including a CPU inference using the cached DINOv3 model.

## Build and query an index

```sh
python build_official_jp_gallery.py --help
python build_embeddings.py --index cache/ja_image_index.json --clean-scans --device cuda
python match_card_v2.py photo.jpg --index cache/ja_image_index.json --embedding-index cache/ja_embeddings_timm_vit_base_patch16_dinov3.lvd1689m_cls_register_mean.npz --device cuda --json
```

Use `--device cpu` when CUDA is unavailable. The gallery and reference images must exist before embedding. `build_embeddings.py` defaults to DINOv3 and `cls_register_mean`; `--embedding-pooling` selects another supported pooling mode. Different pooling modes receive separate default filenames.

For a historical index that predates stored pooling metadata, pass `--embedding-pooling cls_register_mean` explicitly when that is how its vectors were generated. An index without pooling metadata retains its original automatic behaviour unless overridden.

The Next.js adapter uses the DINOv3 index filename above by default. Set `LOCAL_CARD_MATCHER_INDEX` and `LOCAL_CARD_MATCHER_EMBEDDING_INDEX` for a different catalogue or saved index. `LOCAL_CARD_MATCHER_EMBEDDING_POOLING` supplies an explicit override for historical indexes.

OCR is optional and enabled with `--ocr` when PaddleOCR is installed. `--debug-dir` writes the selected crops for inspection.

## Inspect a saved projection

```sh
python -m pip install -r requirements-viz.txt
python render_embedding_space.py --points reports/experiment/points.json --metadata-dir cache/metadata/official_jp/details --output-dir reports/viewer
```

The renderer reuses the saved coordinates, labels card types from cached official catalogue pages, and writes a dark preview plus a standalone interactive HTML file. It does not compute embeddings or refit UMAP. Missing card-type labels remain Unknown.

## Checks and limits

```sh
python -m pytest tests
```

These software checks cover retrieval helpers, metadata, and pooling consistency. The saved projection is an exploratory result; real-photo recognition accuracy has not been established by these checks. Reference caches, model weights, and private photos are not distributed with this repository.
