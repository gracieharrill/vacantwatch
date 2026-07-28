import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getPropertyById,
  normalizePin,
} from "../../../../lib/property/king-county";

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } = await params;
    const pin = normalizePin(id);

    if (!pin) {
      return NextResponse.json(
        {
          property: null,
          error:
            "Parcel ID must contain exactly 10 digits.",
        },
        {
          status: 400,
        }
      );
    }

    const property =
      await getPropertyById(pin);

    if (!property) {
      return NextResponse.json(
        {
          property: null,
          error:
            "No matching tax-delinquent parcel was found.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      property,
      source: {
        taxes: "King County Delinquent Taxes",
        geometry: "King County PARCEL_AREA_439",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown property-detail error";

    console.error("Property detail API error:", error);

    return NextResponse.json(
      {
        property: null,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}