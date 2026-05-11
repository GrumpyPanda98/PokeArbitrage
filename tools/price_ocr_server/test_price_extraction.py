from __future__ import annotations

import unittest
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import (
    OcrItem,
    detect_white_price_tag_regions,
    extract_yen_price_candidates,
    extract_yen_prices,
)


class PriceExtractionTests(unittest.TestCase):
    def test_prefers_split_price_when_attack_damage_is_merged(self) -> None:
        candidates = extract_yen_price_candidates(
            [
                OcrItem(
                    box=(20, 20, 220, 86),
                    confidence=0.96,
                    region="white-tag-1",
                    text="¥500080",
                )
            ]
        )

        self.assertGreaterEqual(len(candidates), 1)
        self.assertEqual(candidates[0].value, 5000)

    def test_extracts_run_on_price_as_first_text_candidate(self) -> None:
        self.assertEqual(extract_yen_prices("税込 1280080")[0], 12800)
        self.assertEqual(extract_yen_prices("PRICE 980030")[0], 9800)

    def test_detects_white_price_tag_region(self) -> None:
        image = Image.new("RGB", (500, 360), "#242018")
        draw = ImageDraw.Draw(image)
        draw.rectangle((110, 92, 390, 178), fill="#f8f5ed")
        draw.text((162, 118), "¥12,800", fill="#111111")

        regions = detect_white_price_tag_regions(image)

        self.assertGreaterEqual(len(regions), 1)
        left, top, right, bottom = regions[0]
        self.assertLessEqual(left, 110)
        self.assertLessEqual(top, 92)
        self.assertGreaterEqual(right, 390)
        self.assertGreaterEqual(bottom, 178)


if __name__ == "__main__":
    unittest.main()
