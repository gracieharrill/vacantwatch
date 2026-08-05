import {
  NextResponse,
} from "next/server";

import {
  DEFAULT_PROVIDER_ID,
  getAvailableProviders,
} from "../../../lib/property/service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    defaultProviderId:
      DEFAULT_PROVIDER_ID,

    providers:
      getAvailableProviders(),
  });
}