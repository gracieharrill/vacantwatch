import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  DEFAULT_PROVIDER_ID,
  getAvailableProviders,
  getProperties,
  hasPropertyProvider,
  UnsupportedPropertyCapabilityError,
} from "../../../lib/property/service";

import {
  InvalidPropertyProviderQueryError,
  type PropertyMapBounds,
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

class InvalidPropertyQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name =
      "InvalidPropertyQueryError";
  }
}

function parseInteger(
  value: string | null,
  fallback: number,
  parameterName: string,
  minimum: number,
  maximum?: number
): number {
  if (value === null) {
    return fallback;
  }

  const trimmedValue =
    value.trim();

  const result =
    Number(trimmedValue);

  if (
    trimmedValue.length === 0 ||
    !Number.isFinite(result) ||
    !Number.isInteger(result)
  ) {
    throw new InvalidPropertyQueryError(
      `${parameterName} must be an integer.`
    );
  }

  if (result < minimum) {
    throw new InvalidPropertyQueryError(
      `${parameterName} must be at least ${minimum}.`
    );
  }

  if (
    maximum !== undefined &&
    result > maximum
  ) {
    throw new InvalidPropertyQueryError(
      `${parameterName} must not exceed ${maximum}.`
    );
  }

  return result;
}

function parseMoney(
  value: string | null
): number {
  if (
    value === null ||
    value.trim().length === 0
  ) {
    return 0;
  }

  const result =
    Number(value);

  if (!Number.isFinite(result)) {
    throw new InvalidPropertyQueryError(
      "minOutstanding must be a valid number."
    );
  }

  if (result < 0) {
    throw new InvalidPropertyQueryError(
      "minOutstanding must be zero or greater."
    );
  }

  return result;
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

  throw new InvalidPropertyQueryError(
    `Unsupported signal filter: ${value}`
  );
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

function parseQuery(
  value: string | null
): string {
  const query =
    String(value ?? "")
      .trim();

  if (query.length > 100) {
    throw new InvalidPropertyQueryError(
      "q must not exceed 100 characters."
    );
  }

  return query;
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
    throw new InvalidPropertyQueryError(
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
    throw new InvalidPropertyQueryError(
      "Map bounds must contain valid numbers."
    );
  }

  if (
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180
  ) {
    throw new InvalidPropertyQueryError(
      "West and east must be between -180 and 180."
    );
  }

  if (
    south < -90 ||
    south > 90 ||
    north < -90 ||
    north > 90
  ) {
    throw new InvalidPropertyQueryError(
      "South and north must be between -90 and 90."
    );
  }

  if (west >= east) {
    throw new InvalidPropertyQueryError(
      "West must be less than east."
    );
  }

  if (south >= north) {
    throw new InvalidPropertyQueryError(
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

function isClientRequestError(
  error: unknown
): error is Error {
  return (
    error instanceof
      InvalidPropertyQueryError ||
    error instanceof
      UnsupportedPropertyCapabilityError ||
    error instanceof
      InvalidPropertyProviderQueryError
  );
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
      100,
      "limit",
      1,
      2000
    );

    const offset = parseInteger(
      searchParams.get("offset"),
      0,
      "offset",
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
      parseQuery(
        searchParams.get("q")
      );

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
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load properties";

    if (
      isClientRequestError(
        error
      )
    ) {
      console.warn(
        "Property list request rejected:",
        message
      );

      return NextResponse.json(
        {
          properties: [],
          count: 0,
          error: message,
        },
        {
          status: 400,
        }
      );
    }

    console.error(
      "Property list API error:",
      error
    );

    return NextResponse.json(
      {
        properties: [],
        count: 0,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
