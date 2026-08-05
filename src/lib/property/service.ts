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

export function getPropertyProvider(
  providerId: string =
    DEFAULT_PROVIDER_ID
): PropertyProvider {
  const provider =
    providers.get(providerId);

  if (!provider) {
    throw new Error(
      `Unknown property provider: ${providerId}`
    );
  }

  return provider;
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