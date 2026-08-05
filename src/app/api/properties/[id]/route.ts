import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getPropertyById,
  getPropertySource,
  normalizeParcelId,
} from "../../../../lib/property/service";

export const runtime = "nodejs";

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
    const { id } =
      await params;

    const parcelId =
      normalizeParcelId(id);

    if (!parcelId) {
      return NextResponse.json(
        {
          property: null,

          error:
            "Parcel ID must contain at least 10 digits.",
        },
        {
          status: 400,
        }
      );
    }

    const property =
      await getPropertyById(
        parcelId
      );

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
      source:
        getPropertySource(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown property-detail error";

    console.error(
      "Property detail API error:",
      error
    );

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