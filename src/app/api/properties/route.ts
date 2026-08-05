import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  DEFAULT_PROVIDER_ID,
  getAvailableProviders,
  getProperties,
  hasPropertyProvider,
} from "../../../lib/property/service";

import type {
  PropertyMapBounds,
} from "../../../lib/property/provider";

import type {
  PropertySignal,
} from "../../../lib/property/types";

export const runtime = "nodejs";

const validSignals =
  new Set<PropertySignal>([
    "parcel",
    "vacant",
    "tax-delinquent",
    "blighted",
    "potential",
  ]);

class InvalidMapBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMapBoundsError";
  }
}

function parseInteger(
  value: string | null,
  fallback: number
): number {
  if (value === null) {
    return fallback;
  }

  const result = Number(value);

  if (
    !Number.isFinite(result) ||
    !Number.isInteger(result)
  ) {
    return fallback;
  }

  return result;
}

function parseMoney(
  value: string | null
): number {
  if (value === null) {
    return 0;
  }

  const result = Number(value);

  if (!Number.isFinite(result)) {
    return 0;
  }

  return Math.max(result, 0);
}

function parseSignal(
  value: string | null
): PropertySignal | "all" {
  if (!value || value === "all") {
    return "all";
  }

  if (
    validSignals.has(
      value as PropertySignal
    )
  ) {
    return value as PropertySignal;
  }

  return "all";
}

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

function parseMapBounds(
  searchParams: URLSearchParams
): PropertyMapBounds | undefined {
  const rawBounds = {
    west: searchParams.get("west"),
    south: searchParams.get("south"),
    east: searchParams.get("east"),
    north: searchParams.get("north"),
  };

  const suppliedValues =
    Object.values(rawBounds);

  const anyBoundsSupplied =
    suppliedValues.some(
      (value) => value !== null
    );

  if (!anyBoundsSupplied) {
    return undefined;
  }

  const allBoundsSupplied =
    suppliedValues.every(
      (value) => value !== null
    );

  if (!allBoundsSupplied) {
    throw new InvalidMapBoundsError(
      "Map bounds require west, south, east, and north."
    );
  }

  const west = Number(rawBounds.west);
  const south = Number(rawBounds.south);
  const east = Number(rawBounds.east);
  const north = Number(rawBounds.north);

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    throw new InvalidMapBoundsError(
      "Map bounds must contain valid numbers."
    );
  }

  if (
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180
  ) {
    throw new InvalidMapBoundsError(
      "West and east must be between -180 and 180."
    );
  }

  if (
    south < -90 ||
    south > 90 ||
    north < -90 ||
    north > 90
  ) {
    throw new InvalidMapBoundsError(
      "South and north must be between -90 and 90."
    );
  }

  if (west >= east) {
    throw new InvalidMapBoundsError(
      "West must be less than east."
    );
  }

  if (south >= north) {
    throw new InvalidMapBoundsError(
      "South must be less than north."
    );
  }

  return {
    west,
    south,
    east,
    north,
  };
}

export async function GET(
  request: NextRequest
) {
  try {
    const searchParams =
      request.nextUrl.searchParams;

    const providerId =
      parseProviderId(
        searchParams.get(
          "provider"
        )
      );

    if (
      !hasPropertyProvider(
        providerId
      )
    ) {
      return NextResponse.json(
        {
          properties: [],
          count: 0,

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

    const limit = parseInteger(
      searchParams.get("limit"),
      100
    );

    const offset = parseInteger(
      searchParams.get("offset"),
      0
    );

    const signal = parseSignal(
      searchParams.get("signal")
    );

    const minOutstanding =
      parseMoney(
        searchParams.get(
          "minOutstanding"
        )
      );

    const query =
      String(
        searchParams.get("q") ??
          ""
      )
        .trim()
        .slice(0, 100);

    const bounds =
      parseMapBounds(
        searchParams
      );

    const result =
      await getProperties(
        {
          limit,
          offset,
          signal,
          minOutstanding,
          query,
          bounds,
        },
        providerId
      );

    return NextResponse.json(
      result
    );
  } catch (error) {
    console.error(
      "Property list API error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to load properties";

    const status =
      error instanceof
        InvalidMapBoundsError
        ? 400
        : 500;

    return NextResponse.json(
      {
        properties: [],
        count: 0,
        error: message,
      },
      {
        status,
      }
    );
  }
}
