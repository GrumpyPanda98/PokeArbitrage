export const dynamic = "force-dynamic";

type NominatimReverseResponse = {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    ward?: string;
    suburb?: string;
    county?: string;
    state?: string;
    road?: string;
    house_number?: string;
    neighbourhood?: string;
    quarter?: string;
  };
  display_name?: string;
  name?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      latitude?: unknown;
      longitude?: unknown;
    };
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) {
      return Response.json(
        { error: "Latitude and longitude must be valid numbers." },
        { status: 400 },
      );
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PokearbJapan/0.1 private-iPhone-PWA",
      },
    });

    if (!response.ok) {
      return Response.json(
        { error: `Reverse geocoding failed with ${response.status}.` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as NominatimReverseResponse;
    const address = data.address ?? {};
    const city =
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.ward ??
      address.suburb ??
      address.county ??
      address.state;

    return Response.json({
      address: compactAddress(data),
      city,
      source: "openstreetmap",
    });
  } catch {
    return Response.json(
      { error: "Could not detect location. Enter store/city manually." },
      { status: 500 },
    );
  }
}

function validCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function compactAddress(data: NominatimReverseResponse): string | undefined {
  const address = data.address ?? {};
  const street = [address.road, address.house_number].filter(Boolean).join(" ");
  const area = address.neighbourhood ?? address.quarter ?? address.suburb;
  const city =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.ward;
  const compact = [street, area, city].filter(Boolean).join(", ");
  return compact || data.display_name;
}
