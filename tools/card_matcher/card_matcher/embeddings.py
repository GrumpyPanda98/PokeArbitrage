from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
from PIL import Image

from .image_ops import load_bgr_image, normalize_card_image
from .index_store import CardIndex


DEFAULT_EMBEDDING_MODEL = "facebook/dinov2-base"


@dataclass(frozen=True)
class EmbeddingIndex:
    card_ids: list[str]
    embeddings: np.ndarray
    model_name: str

    @classmethod
    def load(cls, path: str | Path) -> "EmbeddingIndex":
        data = np.load(path, allow_pickle=False)
        return cls(
            card_ids=[str(item) for item in data["card_ids"].tolist()],
            embeddings=data["embeddings"].astype(np.float32),
            model_name=str(data["model_name"].tolist()),
        )

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            destination,
            card_ids=np.asarray(self.card_ids),
            embeddings=self.embeddings.astype(np.float32),
            model_name=np.asarray(self.model_name),
        )


class GpuEmbeddingModel:
    def __init__(
        self,
        model_name: str = DEFAULT_EMBEDDING_MODEL,
        device: str = "auto",
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
        self.model = AutoModel.from_pretrained(model_name).to(self.device).eval()

    def embed_paths(self, paths: Iterable[str | Path], batch_size: int = 16) -> np.ndarray:
        vectors: list[np.ndarray] = []
        batch: list[Image.Image] = []
        for path in paths:
            image = load_bgr_image(path)
            normalized, _ = normalize_card_image(image)
            batch.append(to_pil(normalized))
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

    def embed_pil_batch(self, images: list[Image.Image]) -> np.ndarray:
        torch = self.torch
        inputs = self.processor(images=images, return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        with torch.inference_mode():
            outputs = self.model(**inputs)
        if hasattr(outputs, "image_embeds"):
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
) -> EmbeddingIndex:
    valid_cards = [card for card in index.cards if Path(card.image_path).exists()]
    embeddings = model.embed_paths([card.image_path for card in valid_cards], batch_size=batch_size)
    return EmbeddingIndex(
        card_ids=[card.id for card in valid_cards],
        embeddings=embeddings,
        model_name=model.model_name,
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


def default_embedding_path(cache_dir: str | Path, language: str, model_name: str) -> Path:
    safe_model = model_name.replace("/", "_").replace("\\", "_")
    return Path(cache_dir) / f"{language}_embeddings_{safe_model}.npz"


def to_pil(image: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
