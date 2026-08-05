import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  DEFAULT_PROVIDER_ID,
  getAvailableProviders,
  getPropertyById,
  getPropertyProviderSummary,
  getPropertySource,
  hasPropertyProvider,
  normalizeParcelId,
} from "../../../../lib/property/service";

export const runtime = "nodejs";

function parseProviderId(
  value: string | null
): string {
  return (
    value
      ?.trim()
      .toLowerCase() ||
    DEFAULT_PROVIDER_ID
  );
}

export async function GET(
  request: NextRequest,

  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const providerId =
      parseProviderId(
        request.nextUrl
          .searchParams
          .get("provider")
      );

    if (
      !hasPropertyProvider(
        providerId
      )
    ) {
      return NextResponse.json(
        {
          property: null,

          error:
            `Unknown property provider: ${providerId}`,

          availableProviders:
            getAvailableProviders(),
        },
        {
          status: 400,
        }
      );
    }

    const { id } =
      await params;

    const parcelId =
      normalizeParcelId(
        id,
        providerId
      );

    if (!parcelId) {
      return NextResponse.json(
        {
          property: null,

          error:
            "Parcel ID is not valid for the selected provider.",

          provider:
            getPropertyProviderSummary(
              providerId
            ),
        },
        {
          status: 400,
        }
      );
    }

    const property =
      await getPropertyById(
        parcelId,
        providerId
      );

    if (!property) {
      return NextResponse.json(
        {
          property: null,

          error:
            "No matching property was found.",

          provider:
            getPropertyProviderSummary(
              providerId
            ),
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      property,

      provider:
        getPropertyProviderSummary(
          providerId
        ),

      source:
        getPropertySource(
          providerId
        ),
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