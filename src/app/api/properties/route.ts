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
  PropertySignal,
} from "../../../lib/property/types";

export const runtime = "nodejs";

const validSignals =
  new Set<PropertySignal>([
    "vacant",
    "tax-delinquent",
    "blighted",
    "potential",
  ]);

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

    const result =
      await getProperties(
        {
          limit,
          offset,
          signal,
          minOutstanding,
          query,
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