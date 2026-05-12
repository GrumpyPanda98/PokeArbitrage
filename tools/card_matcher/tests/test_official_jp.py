from __future__ import annotations

from card_matcher.official_jp import set_id_from_official_image_path


def test_set_id_from_official_image_path() -> None:
    assert (
        set_id_from_official_image_path(
            "/assets/images/card_images/large/M4/050085_P_BIDORU.jpg",
        )
        == "M4"
    )
