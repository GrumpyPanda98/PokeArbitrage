import { scanCardImageServer } from "@/lib/scan-card.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "Upload an image file in the file field." },
        { status: 400 },
      );
    }

    const result = await scanCardImageServer(file);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Card scan failed.",
      },
      { status: 500 },
    );
  }
}
