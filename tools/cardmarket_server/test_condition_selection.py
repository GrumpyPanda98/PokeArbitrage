import unittest

from server import Listing, select_reference_listing


class ConditionSelectionTest(unittest.TestCase):
    def listing(self, condition: str, price: float) -> Listing:
        return Listing(
            article_id=f"{condition}-{price}",
            condition=condition,
            listing_url="https://example.test",
            price=price,
            seller="seller",
        )

    def test_prefers_lowest_exact_condition_listing(self) -> None:
        selected, exact_count = select_reference_listing(
            [
                self.listing("NM", 900),
                self.listing("GD", 700),
                self.listing("GD", 500),
                self.listing("PL", 450),
            ],
            "GD",
        )

        self.assertEqual(selected.condition, "GD")
        self.assertEqual(selected.price, 500)
        self.assertEqual(exact_count, 2)

    def test_falls_back_to_better_condition_when_exact_missing(self) -> None:
        selected, exact_count = select_reference_listing(
            [
                self.listing("NM", 900),
                self.listing("EX", 700),
            ],
            "GD",
        )

        self.assertEqual(selected.condition, "EX")
        self.assertEqual(selected.price, 700)
        self.assertEqual(exact_count, 0)


if __name__ == "__main__":
    unittest.main()
