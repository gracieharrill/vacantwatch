import type {
  PropertyDetail,
  PropertySignal,
} from "./types";

import type {
  PropertyListResult,
  PropertyProvider,
  PropertyProviderCapabilities,
  PropertyQueryOptions,
  PropertySourceInfo,
} from "./provider";

import {
  kingCountyProvider,
} from "./providers/king-county";

import {
  spokaneCountyProvider,
} from "./providers/spokane-county";

export const DEFAULT_PROVIDER_ID =
  "king-county";

export class UnsupportedPropertyCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name =
      "UnsupportedPropertyCapabilityError";
  }
}

const providers:
  ReadonlyMap<
    string,
    PropertyProvider
  > = new Map<
    string,
    PropertyProvider
  >([
    [
      kingCountyProvider.id,
      kingCountyProvider,
    ],

    [
      spokaneCountyProvider.id,
      spokaneCountyProvider,
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

function isVacancyCandidateSignal(
  signal:
    PropertySignal |
    "all" |
    undefined
): boolean {
  return (
    signal === "vacant" ||
    signal === "blighted" ||
    signal === "potential"
  );
}

export function hasPropertyProvider(
  providerId: string
): boolean {
  return providers.has(
    cleanProviderId(
      providerId
    )
  );
}

export function getPropertyProvider(
  providerId: string =
    DEFAULT_PROVIDER_ID
): PropertyProvider {
  const cleanedProviderId =
    cleanProviderId(
      providerId
    ) ||
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

    capabilities:
      provider.capabilities,

    map:
      provider.map,
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

    capabilities:
      provider.capabilities,

    map:
      provider.map,
  }));
}

export function getProviderCapabilities(
  providerId: string =
    DEFAULT_PROVIDER_ID
): PropertyProviderCapabilities {
  return getPropertyProvider(
    providerId
  ).capabilities;
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

  if (
    !provider.capabilities
      .parcelSearch
  ) {
    throw new UnsupportedPropertyCapabilityError(
      `${provider.displayName} does not support parcel searching.`
    );
  }

  if (
    options.bounds &&
    !provider.capabilities
      .mapBounds
  ) {
    throw new UnsupportedPropertyCapabilityError(
      `${provider.displayName} does not support visible-map bounds searching.`
    );
  }

  if (
    isVacancyCandidateSignal(
      options.signal
    ) &&
    !provider.capabilities
      .vacancyCandidates
  ) {
    throw new UnsupportedPropertyCapabilityError(
      `${provider.displayName} does not support vacancy-candidate filtering.`
    );
  }

  const requestsTaxDelinquency =
    options.signal ===
      "tax-delinquent" ||
    (
      options.minOutstanding ??
      0
    ) > 0;

  if (
    requestsTaxDelinquency &&
    !provider.capabilities
      .taxDelinquency
  ) {
    throw new UnsupportedPropertyCapabilityError(
      `${provider.displayName} does not support tax-delinquency filtering.`
    );
  }

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

      capabilities:
        provider.capabilities,

      map:
        provider.map,
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

  if (
    !provider.capabilities
      .propertyDetails
  ) {
    throw new UnsupportedPropertyCapabilityError(
      `${provider.displayName} does not support property details.`
    );
  }

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
