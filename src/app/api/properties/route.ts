import { NextRequest, NextResponse } from "next/server";

import { getProperties } from "../../../lib/property/king-county";

function parseInteger(
  value: string | null,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const limit = parseInteger(
      request.nextUrl.searchParams.get("limit"),
      1000
    );

    const offset = parseInteger(
      request.nextUrl.searchParams.get("offset"),
      0
    );

    const result = await getProperties({
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown property API error";

    console.error("Properties API error:", error);

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
