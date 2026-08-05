import type {
  Property,
  PropertyDetail,
  PropertySignal,
} from "./types";

export type PropertyQueryOptions = {
  limit?: number;
  offset?: number;
  signal?: PropertySignal | "all";
  minOutstanding?: number;
  query?: string;
};

/*
 * Providers may return additional pagination,
 * cache, source, filter, and debugging fields.
 */
export type PropertyListResult = {
  properties: Property[];
  count: number;
  [key: string]: unknown;
};

export type PropertySourceInfo = {
  taxes: string;
  geometry: string;
  attributes?: string;
};

export type PropertyJurisdiction = {
  countryCode: string;
  stateCode: string;
  countyName: string;
  countyFips: string;
};

export type PropertyProvider = {
  id: string;
  displayName: string;

  jurisdiction: PropertyJurisdiction;
  source: PropertySourceInfo;

  normalizeParcelId(
    value: unknown
  ): string | null;

  getProperties(
    options?: PropertyQueryOptions
  ): Promise<PropertyListResult>;

  getPropertyById(
    parcelId: string
  ): Promise<PropertyDetail | null>;
};