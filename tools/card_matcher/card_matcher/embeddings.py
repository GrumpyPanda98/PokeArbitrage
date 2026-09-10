from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
from PIL import Image
from tqdm import tqdm

from .image_ops import load_bgr_image, normalize_card_image, normalize_card_image_candidates, orient_portrait, resize_card
from .index_store import CardIndex
from .roi import extract_rois


LEGACY_EMBEDDING_MODEL = "facebook/dinov2-base"
DEFAULT_EMBEDDING_MODEL = "timm/vit_base_patch16_dinov3.lvd1689m"
DEFAULT_DINOV3_EMBEDDING_MODEL = "timm/vit_base_patch16_dinov3.lvd1689m"
DEFAULT_EMBEDDING_BACKEND = "dinov3"
REGION_VARIANT_NAMES = ("name", "collector_number", "set_symbol", "attack_text")


@dataclass(frozen=True)
class EmbeddingIndex:
    card_ids: list[str]
    embeddings: np.ndarray
    model_name: str
    pooling: str = "auto"

    @classmethod
    def load(cls, path: str | Path) -> "EmbeddingIndex":
        data = np.load(path, allow_pickle=False)
        return cls(
            card_ids=[str(item) for item in data["card_ids"].tolist()],
            embeddings=data["embeddings"].astype(np.float32),
            model_name=str(data["model_name"].tolist()),
            pooling=str(data["pooling"].tolist()) if "pooling" in data else "auto",
        )

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            destination,
            card_ids=np.asarray(self.card_ids),
            embeddings=self.embeddings.astype(np.float32),
            model_name=np.asarray(self.model_name),
            pooling=np.asarray(self.pooling),
        )


class GpuEmbeddingModel:
    def __init__(
        self,
        model_name: str = DEFAULT_EMBEDDING_MODEL,
        device: str = "auto",
        pooling: str = "cls_register_mean",
    ) -> None:
        try:
            import torch
            from transformers import AutoImageProcessor, AutoModel
        except ImportError as error:
            raise RuntimeError(
                "GPU embeddings need requirements-gpu.txt installed."
            ) from error

        self.torch = torch
        self.processor = AutoImageProcessor.from_pretrained(model_name)
        resolved_device = (
            "cuda" if device == "auto" and torch.cuda.is_available() else device
        )
        if resolved_device == "auto":
            resolved_device = "cpu"
        self.device = resolved_device
        self.model_name = model_name
        self.pooling = normalize_embedding_pooling(pooling)
        self.model = AutoModel.from_pretrained(model_name).to(self.device).eval()

    def embed_paths(self, paths: Iterable[str | Path], batch_size: int = 16) -> np.ndarray:
        images: list[np.ndarray] = []
        for path in paths:
            image = load_bgr_image(path)
            normalized, _ = normalize_card_image(image)
            images.append(normalized)
        return self.embed_bgr_images(images, batch_size=batch_size)

    def embed_bgr_images(
        self,
        images: Iterable[np.ndarray],
        batch_size: int = 16,
    ) -> np.ndarray:
        vectors: list[np.ndarray] = []
        batch: list[Image.Image] = []
        for image in images:
            batch.append(to_pil(image))
            if len(batch) >= batch_size:
                vectors.append(self.embed_pil_batch(batch))
                batch = []

        if batch:
            vectors.append(self.embed_pil_batch(batch))

        if not vectors:
            return np.empty((0, 0), dtype=np.float32)
        return np.vstack(vectors).astype(np.float32)

    def embed_bgr_image(self, image: np.ndarray) -> np.ndarray:
        normalized, _ = normalize_card_image(image)
        return self.embed_pil_batch([to_pil(normalized)])[0]

    def embed_query_variants(self, images: Iterable[np.ndarray]) -> np.ndarray:
        return self.embed_bgr_images(images, batch_size=8)

    def embed_pil_batch(self, images: list[Image.Image]) -> np.ndarray:
        torch = self.torch
        inputs = self.processor(images=images, return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        with torch.inference_mode():
            outputs = self.model(**inputs)
        if self.pooling == "cls_register_mean":
            hidden_state = getattr(outputs, "last_hidden_state", None)
            if hidden_state is None or hidden_state.shape[1] < 5:
                raise RuntimeError(
                    "cls_register_mean pooling needs a model output with CLS plus register tokens.",
                )
            embeddings = hidden_state[:, :5].mean(dim=1)
        elif self.pooling == "register_mean":
            hidden_state = getattr(outputs, "last_hidden_state", None)
            if hidden_state is None or hidden_state.shape[1] < 5:
                raise RuntimeError(
                    "register_mean pooling needs a model output with register tokens.",
                )
            embeddings = hidden_state[:, 1:5].mean(dim=1)
        elif hasattr(outputs, "image_embeds"):
            embeddings = outputs.image_embeds
        elif hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
            embeddings = outputs.pooler_output
        else:
            embeddings = outputs.last_hidden_state[:, 0]
        embeddings = torch.nn.functional.normalize(embeddings.float(), dim=1)
        return embeddings.detach().cpu().numpy().astype(np.float32)


def build_embedding_index(
    index: CardIndex,
    model: GpuEmbeddingModel,
    batch_size: int = 16,
    clean_scans: bool = False,
    region_level: bool = False,
) -> EmbeddingIndex:
    valid_cards = [card for card in index.cards if Path(card.image_path).exists()]
    card_ids: list[str] = []
    vector_batches: list[np.ndarray] = []
    image_batch: list[np.ndarray] = []
    id_batch: list[str] = []

    def flush() -> None:
        if not image_batch:
            return
        vector_batches.append(model.embed_bgr_images(image_batch, batch_size=batch_size))
        card_ids.extend(id_batch)
        image_batch.clear()
        id_batch.clear()

    for card in tqdm(valid_cards, desc="Embedding reference cards"):
        image = load_bgr_image(card.image_path)
        normalized = resize_card(orient_portrait(image)) if clean_scans else normalize_card_image(image)[0]
        for variant in reference_embedding_variants(normalized, include_rois=region_level):
            id_batch.append(card.id)
            image_batch.append(variant)
            if len(image_batch) >= batch_size:
                flush()

    flush()

    embeddings = (
        np.vstack(vector_batches).astype(np.float32)
        if vector_batches
        else np.empty((0, 0), dtype=np.float32)
    )
    return EmbeddingIndex(
        card_ids=card_ids,
        embeddings=embeddings,
        model_name=model.model_name,
        pooling=model.pooling,
    )


def cosine_similarities(query: np.ndarray, reference: np.ndarray) -> np.ndarray:
    if reference.size == 0:
        return np.empty((0,), dtype=np.float32)
    query_vector = query.astype(np.float32)
    query_norm = np.linalg.norm(query_vector)
    if query_norm == 0:
        return np.zeros((reference.shape[0],), dtype=np.float32)
    query_vector = query_vector / query_norm
    return reference @ query_vector


def default_embedding_path(cache_dir: str | Path, language: str, model_name: str, pooling: str = "auto") -> Path:
    return default_embedding_path_for_mode(cache_dir, language, model_name, pooling=pooling)


def default_embedding_path_for_mode(
    cache_dir: str | Path,
    language: str,
    model_name: str,
    region_level: bool = False,
    pooling: str = "auto",
) -> Path:
    safe_model = model_name.replace("/", "_").replace("\\", "_")
    pooling = normalize_embedding_pooling(pooling)
    suffix = "" if pooling == "auto" else f"_{pooling}"
    suffix += "_regions" if region_level else ""
    return Path(cache_dir) / f"{language}_embeddings_{safe_model}{suffix}.npz"


def embedding_model_name_for_backend(
    backend: str,
    explicit_model_name: str | None = None,
) -> str:
    if explicit_model_name:
        return explicit_model_name

    normalized = normalize_embedding_backend(backend)
    if normalized == "dinov3":
        return os.getenv("LOCAL_CARD_MATCHER_DINOV3_MODEL", DEFAULT_DINOV3_EMBEDDING_MODEL)
    return os.getenv("LOCAL_CARD_MATCHER_DINOV2_MODEL", LEGACY_EMBEDDING_MODEL)


def normalize_embedding_backend(value: str | None) -> str:
    normalized = str(value or DEFAULT_EMBEDDING_BACKEND).strip().lower()
    if normalized not in {"dinov2", "dinov3"}:
        raise ValueError(f"Unknown embedding backend: {value}")
    return normalized


def normalize_embedding_pooling(value: str | None) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in {"cls_register_mean", "register_mean"}:
        return normalized
    return "auto"


def to_pil(image: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))


def reference_embedding_variants(image: np.ndarray, include_rois: bool = False) -> list[np.ndarray]:
    return embedding_variants(image, include_rois=include_rois)


def query_embedding_variants(image: np.ndarray, include_rois: bool = False) -> list[np.ndarray]:
    return embedding_variants(image, include_rois=include_rois)


def embedding_variants(image: np.ndarray, include_rois: bool = False) -> list[np.ndarray]:
    variants = [image]
    height, width = image.shape[:2]
    margins = [0.035, 0.07]
    for margin in margins:
        x = int(width * margin)
        y = int(height * margin)
        crop = image[y : height - y, x : width - x]
        variants.append(cv2.resize(crop, (width, height), interpolation=cv2.INTER_AREA))

    art_top = int(height * 0.12)
    art_bottom = int(height * 0.58)
    art_left = int(width * 0.08)
    art_right = int(width * 0.92)
    artwork = image[art_top:art_bottom, art_left:art_right]
    variants.append(cv2.resize(artwork, (width, height), interpolation=cv2.INTER_AREA))
    if include_rois:
        rois = extract_rois(image)
        for roi_name in REGION_VARIANT_NAMES:
            roi = rois.get(roi_name)
            if not roi or roi.image.size == 0:
                continue
            variants.append(cv2.resize(roi.image, (width, height), interpolation=cv2.INTER_AREA))
    return variants
