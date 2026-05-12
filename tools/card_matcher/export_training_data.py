from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from card_matcher.image_ops import load_bgr_image, normalize_card_image_candidates, write_bgr_image
from card_matcher.roi import save_rois


def main() -> None:
    parser = argparse.ArgumentParser(description="Export rectified crops and ROIs for labeling/evaluation.")
    parser.add_argument("labels", help="CSV with image_path,expected_card_id.")
    parser.add_argument("--output-dir", default="reports/training-export", help="Destination directory.")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    crops_dir = output_dir / "rectified"
    rois_dir = output_dir / "rois"
    crops_dir.mkdir(parents=True, exist_ok=True)
    rois_dir.mkdir(parents=True, exist_ok=True)
    manifest = []

    for index, row in enumerate(read_rows(args.labels), start=1):
        image_path = Path(row["image_path"])
        expected = row["expected_card_id"]
        image = load_bgr_image(image_path)
        candidate = normalize_card_image_candidates(image, max_candidates=1)[0]
        crop_path = crops_dir / f"{index:05d}-{safe_name(expected)}.jpg"
        write_bgr_image(crop_path, candidate.image)
        roi_paths = save_rois(candidate.image, rois_dir / crop_path.stem, prefix="roi")
        manifest.append(
            {
                "source_image": str(image_path),
                "expected_card_id": expected,
                "rectified_path": str(crop_path),
                "crop_label": candidate.label,
                "crop_used": candidate.crop_used,
                "roi_paths": [str(path) for path in roi_paths],
            },
        )

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(manifest)} examples to {output_dir}")


def read_rows(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8") as handle:
        return [
            row
            for row in csv.DictReader(handle)
            if row.get("image_path") and row.get("expected_card_id")
        ]


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in value)


if __name__ == "__main__":
    main()
