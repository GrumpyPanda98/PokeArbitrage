from pathlib import Path

import numpy as np

from card_matcher.embeddings import EmbeddingIndex, default_embedding_path_for_mode
from card_matcher.matcher import CardMatcher


def test_saved_index_keeps_pooling_and_vectors(tmp_path):
    source = EmbeddingIndex(['a', 'b'], np.eye(2, dtype=np.float32), 'example-model', 'cls_register_mean')
    path = tmp_path / 'index.npz'
    source.save(path)
    loaded = EmbeddingIndex.load(path)
    assert loaded.pooling == 'cls_register_mean'
    assert loaded.card_ids == source.card_ids
    np.testing.assert_array_equal(loaded.embeddings, source.embeddings)


def test_legacy_index_without_pooling_retains_auto(tmp_path):
    path = tmp_path / 'legacy.npz'
    np.savez(path, card_ids=['a'], embeddings=[[1., 0.]], model_name='old-model')
    assert EmbeddingIndex.load(path).pooling == 'auto'


def test_pooling_variants_do_not_overwrite_the_same_default_index():
    paths = {default_embedding_path_for_mode('cache', 'ja', 'model', pooling=p) for p in ('auto', 'cls_register_mean', 'register_mean')}
    assert len(paths) == 3


def test_matcher_uses_the_saved_pooling_for_query_vectors(tmp_path, monkeypatch):
    path = tmp_path / 'embeddings.npz'
    EmbeddingIndex(['a'], np.array([[1., 0.]], dtype=np.float32), 'test-model', 'cls_register_mean').save(path)
    calls = []
    monkeypatch.setattr('card_matcher.matcher.GpuEmbeddingModel', lambda **kwargs: calls.append(kwargs))
    class EmptyIndex:
        by_id = {}
    monkeypatch.setattr('card_matcher.matcher.load_index', lambda _: EmptyIndex())
    CardMatcher.from_index_path(Path('cards.json'), embedding_index_path=path, device='cpu')
    assert calls == [{'model_name': 'test-model', 'pooling': 'cls_register_mean', 'device': 'cpu'}]
