import type {
  PropertyDetail,
} from "./types";

import type {
  PropertyListResult,
  PropertyProvider,
  PropertyQueryOptions,
  PropertySourceInfo,
} from "./provider";

import {
  kingCountyProvider,
} from "./providers/king-county";

export const DEFAULT_PROVIDER_ID =
  "king-county";

const providers:
  ReadonlyMap<
    string,
    PropertyProvider
  > = new Map([
    [
      kingCountyProvider.id,
      kingCountyProvider,
    ],
  ]);

function cleanProviderId(
  value: unknown
): string {
  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase();
}

export function hasPropertyProvider(
  providerId: string
): boolean {
  return providers.has(
    cleanProviderId(providerId)
  );
}

export function getPropertyProvider(
  providerId: string =
    DEFAULT_PROVIDER_ID
): PropertyProvider {
  const cleanedProviderId =
    cleanProviderId(providerId) ||
    DEFAULT_PROVIDER_ID;

  const provider =
    providers.get(
      cleanedProviderId
    );

  if (!provider) {
    throw new Error(
      `Unknown property provider: ${cleanedProviderId}`
    );
  }

  return provider;
}

export function getPropertyProviderSummary(
  providerId: string =
    DEFAULT_PROVIDER_ID
) {
  const provider =
    getPropertyProvider(
      providerId
    );

  return {
    id: provider.id,

    displayName:
      provider.displayName,

    jurisdiction:
      provider.jurisdiction,

    source:
      provider.source,
  };
}

export function getAvailableProviders() {
  return Array.from(
    providers.values()
  ).map((provider) => ({
    id: provider.id,

    displayName:
      provider.displayName,

    jurisdiction:
      provider.jurisdiction,

    source:
      provider.source,
  }));
}

export async function getProperties(
  options:
    PropertyQueryOptions = {},

  providerId: string =
    DEFAULT_PROVIDER_ID
): Promise<PropertyListResult> {
  const provider =
    getPropertyProvider(
      providerId
    );

  const result =
    await provider.getProperties(
      options
    );

  return {
    ...result,

    provider: {
      id: provider.id,

      displayName:
        provider.displayName,

      jurisdiction:
        provider.jurisdiction,
    },
  };
}

export async function getPropertyById(
  parcelId: string,

  providerId: string =
    DEFAULT_PROVIDER_ID
): Promise<PropertyDetail | null> {
  const provider =
    getPropertyProvider(
      providerId
    );

  return provider.getPropertyById(
    parcelId
  );
}

export function normalizeParcelId(
  value: unknown,

  providerId: string =
    DEFAULT_PROVIDER_ID
): string | null {
  const provider =
    getPropertyProvider(
      providerId
    );

  return provider.normalizeParcelId(
    value
  );
}

export function getPropertySource(
  providerId: string =
    DEFAULT_PROVIDER_ID
): PropertySourceInfo {
  return getPropertyProvider(
    providerId
  ).source;
}