import type {
  Property,
  PropertyDetail,
  PropertySignal,
  TaxRecordDetail,
} from "./types";

const DELINQUENT_TAX_URL =
  "https://data.kingcounty.gov/resource/dsv3-ct3e.json";

const PARCEL_GEOMETRY_URL =
  "https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_AREA_439/FeatureServer/0/query";

const PARCEL_ATTRIBUTES_URL =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/King_County_Tax_Parcel_Centroids_with_select_City_of_Seattle_geographic_overlays/FeatureServer/0/query";

const TAX_BATCH_SIZE = 5000;
const MAX_TAX_ROWS = 200000;
const ARCGIS_BATCH_SIZE = 50;

const TAX_CACHE_TTL_MS =
  60 * 60 * 1000;

const ASSESSOR_FILTER_CACHE_TTL_MS =
  15 * 60 * 1000;

const ASSESSOR_FILTER_PAGE_SIZE = 2000;
const MAX_ASSESSOR_FILTER_RESULTS = 100000;

const TAX_SELECT_FIELDS = [
  "account_number",
  "account_status",
  "levy_code",
  "tax_status",
  "receivable_type",
  "bill_year",
  "billed_amount",
  "paid_amount",
].join(",");

const ASSESSOR_FIELDS = [
  "PIN",
  "ADDRESS",
  "PROP_NAME",
  "PARCEL_SQFT",
  "LAND_SQFT",
  "LAND_USE_CODE",
  "PRES_USE",
  "PUB_OWN_TYPE",
  "BLDG_GRSS_SQFT",
  "LAND_AV",
  "BLDG_AV",
  "YEAR_BUILT",
  "ZONING",
  "LAT",
  "LON",
].join(",");

export type PropertyQueryOptions = {
  limit?: number;
  offset?: number;
  signal?: PropertySignal | "all";
  minOutstanding?: number;
  query?: string;
};

type TaxFetchOptions = {
  limit: number;
  offset: number;
  pin?: string;
};

type TaxRow = {
  account_number?: string;
  account_status?: string;
  levy_code?: string;
  tax_status?: string;
  receivable_type?: string;
  bill_year?: string;
  billed_amount?: string;
  paid_amount?: string;
};

type TaxAggregate = {
  pin: string;
  billedCents: number;
  paidCents: number;
  billYears: Set<string>;
  recordCount: number;
  records: TaxRecordDetail[];
};

type TaxIndex = {
  taxByPin: Map<string, TaxAggregate>;
  orderedTaxAggregates: TaxAggregate[];
  taxRowsScanned: number;
  taxRowsTruncated: boolean;
  generatedAt: number;
  expiresAt: number;
};

type TaxCacheStatus =
  | "hit"
  | "miss"
  | "shared-build"
  | "stale";

type AssessorCacheStatus =
  | "not-needed"
  | "hit"
  | "miss"
  | "shared-build"
  | "stale";

type AssessorPinCacheEntry = {
  pins: Set<string>;
  generatedAt: number;
  expiresAt: number;
};

type ParcelGeometryAttributes = {
  PIN?: string;
  MAJOR?: string;
  MINOR?: string;
};

type ParcelGeometry = {
  rings?: number[][][];
};

type ParcelAssessorAttributes = {
  PIN?: string;
  ADDRESS?: string;
  PROP_NAME?: string;
  PARCEL_SQFT?: number | string;
  LAND_SQFT?: number | string;
  LAND_USE_CODE?: number | string;
  PRES_USE?: string;
  PUB_OWN_TYPE?: string;
  BLDG_GRSS_SQFT?: number | string;
  LAND_AV?: number | string;
  BLDG_AV?: number | string;
  YEAR_BUILT?: number | string;
  ZONING?: string;
  LAT?: number | string;
  LON?: number | string;
};

type AssessorPinAttributes = {
  PIN?: string;
};

type ArcGisFeature<
  TAttributes,
  TGeometry = unknown,
> = {
  attributes?: TAttributes;
  geometry?: TGeometry;
};

type ArcGisResponse<
  TAttributes,
  TGeometry = unknown,
> = {
  features?: Array<
    ArcGisFeature<TAttributes, TGeometry>
  >;

  exceededTransferLimit?: boolean;

  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

let cachedTaxIndex: TaxIndex | null =
  null;

let taxIndexBuildPromise:
  | Promise<TaxIndex>
  | null = null;

const assessorPinCache =
  new Map<
    string,
    AssessorPinCacheEntry
  >();

const assessorPinBuildPromises =
  new Map<
    string,
    Promise<AssessorPinCacheEntry>
  >();

export function normalizePin(
  value: unknown
): string | null {
  const digits = String(
    value ?? ""
  ).replace(/\D/g, "");

  if (digits.length < 10) {
    return null;
  }

  return digits.slice(0, 10);
}

function cleanString(
  value: unknown
): string | undefined {
  const result = String(
    value ?? ""
  ).trim();

  return result.length > 0
    ? result
    : undefined;
}

function numberOrUndefined(
  value: unknown
): number | undefined {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return undefined;
  }

  const result = Number(value);

  return Number.isFinite(result)
    ? result
    : undefined;
}

function integerOrUndefined(
  value: unknown
): number | undefined {
  const result =
    numberOrUndefined(value);

  if (result === undefined) {
    return undefined;
  }

  return Math.round(result);
}

function yearOrUndefined(
  value: unknown
): number | undefined {
  const result =
    integerOrUndefined(value);

  if (
    result === undefined ||
    result <= 0
  ) {
    return undefined;
  }

  return result;
}

function parseCents(
  value: unknown
): number {
  const result = Number(
    String(value ?? "").trim()
  );

  if (!Number.isFinite(result)) {
    return 0;
  }

  return Math.round(result);
}

function centsToDollars(
  cents: number
): number {
  return Math.round(cents) / 100;
}

function chunkArray<T>(
  values: T[],
  size: number
): T[][] {
  const chunks: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(
        index,
        index + size
      )
    );
  }

  return chunks;
}

function escapeSqlLiteral(
  value: string
): string {
  return value.replaceAll(
    "'",
    "''"
  );
}

async function fetchJson<T>(
  url: string,
  description: string
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText =
      await response
        .text()
        .catch(() => "");

    throw new Error(
      [
        `${description} failed with status ${response.status}`,
        `URL: ${url}`,
        responseText
          ? `Response: ${responseText.slice(
              0,
              300
            )}`
          : "",
      ]
        .filter(Boolean)
        .join(". ")
    );
  }

  return (await response.json()) as T;
}

async function fetchArcGisJson<T>(
  url: string,
  parameters: URLSearchParams,
  description: string
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded;charset=UTF-8",

      Accept: "application/json",
    },

    body: parameters.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText =
      await response
        .text()
        .catch(() => "");

    throw new Error(
      [
        `${description} failed with status ${response.status}`,
        `URL: ${url}`,
        responseText
          ? `Response: ${responseText.slice(
              0,
              500
            )}`
          : "",
      ]
        .filter(Boolean)
        .join(". ")
    );
  }

  return (await response.json()) as T;
}

function assertNoArcGisError(
  response: {
    error?: {
      code?: number;
      message?: string;
      details?: string[];
    };
  },
  description: string
): void {
  if (!response.error) {
    return;
  }

  const details =
    response.error.details
      ?.filter(Boolean)
      .join("; ") ?? "";

  throw new Error(
    [
      `${description} returned an ArcGIS error`,

      response.error.code
        ? `Code ${response.error.code}`
        : "",

      response.error.message,
      details,
    ]
      .filter(Boolean)
      .join(": ")
  );
}

async function fetchTaxRecords({
  limit,
  offset,
  pin,
}: TaxFetchOptions): Promise<
  TaxRow[]
> {
  const parameters =
    new URLSearchParams({
      $select:
        TAX_SELECT_FIELDS,

      $order: [
        "account_number ASC",
        "bill_year ASC",
        "levy_code ASC",
        "receivable_type ASC",
        "billed_amount ASC",
        "paid_amount ASC",
      ].join(","),

      $limit: String(limit),
      $offset: String(offset),
    });

  if (pin) {
    parameters.set(
      "$where",
      `account_number like '${pin}%'`
    );
  }

  return fetchJson<TaxRow[]>(
    `${DELINQUENT_TAX_URL}?${parameters.toString()}`,
    "King County delinquent-tax request"
  );
}

async function fetchAllTaxRecords(): Promise<{
  records: TaxRow[];
  truncated: boolean;
}> {
  const records: TaxRow[] = [];

  for (
    let offset = 0;
    offset < MAX_TAX_ROWS;
    offset += TAX_BATCH_SIZE
  ) {
    const batch =
      await fetchTaxRecords({
        limit: TAX_BATCH_SIZE,
        offset,
      });

    records.push(...batch);

    if (
      batch.length <
      TAX_BATCH_SIZE
    ) {
      return {
        records,
        truncated: false,
      };
    }
  }

  return {
    records,
    truncated: true,
  };
}

function aggregateTaxRecords(
  records: TaxRow[],
  includeRecordDetails: boolean
): Map<string, TaxAggregate> {
  const taxByPin =
    new Map<
      string,
      TaxAggregate
    >();

  for (const record of records) {
    const pin = normalizePin(
      record.account_number
    );

    if (!pin) {
      continue;
    }

    const billedCents =
      parseCents(
        record.billed_amount
      );

    const paidCents =
      parseCents(
        record.paid_amount
      );

    const outstandingCents =
      Math.max(
        0,
        billedCents - paidCents
      );

    let aggregate =
      taxByPin.get(pin);

    if (!aggregate) {
      aggregate = {
        pin,
        billedCents: 0,
        paidCents: 0,
        billYears:
          new Set<string>(),
        recordCount: 0,
        records: [],
      };

      taxByPin.set(
        pin,
        aggregate
      );
    }

    aggregate.billedCents +=
      billedCents;

    aggregate.paidCents +=
      paidCents;

    aggregate.recordCount += 1;

    const billYear =
      cleanString(
        record.bill_year
      );

    if (billYear) {
      aggregate.billYears.add(
        billYear
      );
    }

    if (includeRecordDetails) {
      aggregate.records.push({
        billYear,

        levyCode:
          cleanString(
            record.levy_code
          ),

        receivableType:
          cleanString(
            record.receivable_type
          ),

        taxStatus:
          cleanString(
            record.tax_status
          ),

        billedAmount:
          centsToDollars(
            billedCents
          ),

        paidAmount:
          centsToDollars(
            paidCents
          ),

        outstandingAmount:
          centsToDollars(
            outstandingCents
          ),
      });
    }
  }

  return taxByPin;
}

function sortTaxAggregates(
  taxByPin: Map<
    string,
    TaxAggregate
  >
): TaxAggregate[] {
  return Array.from(
    taxByPin.values()
  ).sort(
    (first, second) => {
      const firstOutstanding =
        Math.max(
          0,
          first.billedCents -
            first.paidCents
        );

      const secondOutstanding =
        Math.max(
          0,
          second.billedCents -
            second.paidCents
        );

      const difference =
        secondOutstanding -
        firstOutstanding;

      if (difference !== 0) {
        return difference;
      }

      return first.pin.localeCompare(
        second.pin
      );
    }
  );
}

async function buildTaxIndex(): Promise<TaxIndex> {
  console.info(
    "[VacantWatch] Building tax index..."
  );

  const {
    records,
    truncated,
  } = await fetchAllTaxRecords();

  const taxByPin =
    aggregateTaxRecords(
      records,
      false
    );

  const generatedAt =
    Date.now();

  const index: TaxIndex = {
    taxByPin,

    orderedTaxAggregates:
      sortTaxAggregates(
        taxByPin
      ),

    taxRowsScanned:
      records.length,

    taxRowsTruncated:
      truncated,

    generatedAt,

    expiresAt:
      generatedAt +
      TAX_CACHE_TTL_MS,
  };

  console.info(
    `[VacantWatch] Tax index ready: ${index.taxRowsScanned} rows, ${index.taxByPin.size} parcels`
  );

  return index;
}

async function getTaxIndex(): Promise<{
  index: TaxIndex;
  status: TaxCacheStatus;
}> {
  const now = Date.now();

  if (
    cachedTaxIndex &&
    cachedTaxIndex.expiresAt > now
  ) {
    return {
      index: cachedTaxIndex,
      status: "hit",
    };
  }

  if (taxIndexBuildPromise) {
    return {
      index:
        await taxIndexBuildPromise,

      status: "shared-build",
    };
  }

  const staleIndex =
    cachedTaxIndex;

  taxIndexBuildPromise =
    buildTaxIndex();

  try {
    const newIndex =
      await taxIndexBuildPromise;

    cachedTaxIndex =
      newIndex;

    return {
      index: newIndex,
      status: "miss",
    };
  } catch (error) {
    if (staleIndex) {
      console.warn(
        "[VacantWatch] Tax refresh failed; using stale tax index",
        error
      );

      return {
        index: staleIndex,
        status: "stale",
      };
    }

    throw error;
  } finally {
    taxIndexBuildPromise =
      null;
  }
}

function buildAssessorFilterWhere({
  signal,
  query,
}: {
  signal: PropertySignal | "all";
  query: string;
}): string | null {
  const conditions: string[] =
    [];

  if (signal === "vacant") {
    conditions.push(
      "(UPPER(PRES_USE) LIKE '%VACANT%' OR BLDG_GRSS_SQFT = 0)"
    );
  }

  const trimmedQuery =
    query.trim();

  const numericQuery =
    trimmedQuery.replace(
      /\D/g,
      ""
    );

  const queryIsNumeric =
    trimmedQuery.length > 0 &&
    /^[\d\s-]+$/.test(
      trimmedQuery
    );

  if (
    trimmedQuery &&
    !queryIsNumeric
  ) {
    const escapedQuery =
      escapeSqlLiteral(
        trimmedQuery.toUpperCase()
      );

    conditions.push(
      [
        "(",
        `UPPER(ADDRESS) LIKE '%${escapedQuery}%'`,
        " OR ",
        `UPPER(PROP_NAME) LIKE '%${escapedQuery}%'`,
        ")",
      ].join("")
    );
  }

  if (
    queryIsNumeric &&
    numericQuery.length >= 10
  ) {
    conditions.push(
      `PIN = '${numericQuery.slice(
        0,
        10
      )}'`
    );
  }

  if (
    conditions.length === 0
  ) {
    return null;
  }

  return conditions.join(
    " AND "
  );
}

async function fetchAssessorPinsByWhere(
  where: string
): Promise<Set<string>> {
  const pins =
    new Set<string>();

  let resultOffset = 0;

  while (
    resultOffset <
    MAX_ASSESSOR_FILTER_RESULTS
  ) {
    const parameters =
      new URLSearchParams({
        where,
        outFields: "PIN",
        returnGeometry: "false",

        resultOffset:
          String(resultOffset),

        resultRecordCount:
          String(
            ASSESSOR_FILTER_PAGE_SIZE
          ),

        orderByFields:
          "PIN ASC",

        f: "json",
      });

    const response =
      await fetchArcGisJson<
        ArcGisResponse<
          AssessorPinAttributes
        >
      >(
        PARCEL_ATTRIBUTES_URL,
        parameters,
        "King County assessor-filter request"
      );

    assertNoArcGisError(
      response,
      "King County assessor-filter request"
    );

    const features =
      response.features ?? [];

    for (
      const feature of
      features
    ) {
      const pin = normalizePin(
        feature.attributes?.PIN
      );

      if (pin) {
        pins.add(pin);
      }
    }

    if (features.length === 0) {
      break;
    }

    resultOffset +=
      features.length;

    const hasMore =
      response
        .exceededTransferLimit ===
        true ||
      features.length ===
        ASSESSOR_FILTER_PAGE_SIZE;

    if (!hasMore) {
      break;
    }
  }

  if (
    resultOffset >=
    MAX_ASSESSOR_FILTER_RESULTS
  ) {
    throw new Error(
      "The assessor filter returned too many records. Use a more specific search."
    );
  }

  return pins;
}

async function buildAssessorPinCacheEntry(
  where: string
): Promise<AssessorPinCacheEntry> {
  const pins =
    await fetchAssessorPinsByWhere(
      where
    );

  const generatedAt =
    Date.now();

  return {
    pins,
    generatedAt,

    expiresAt:
      generatedAt +
      ASSESSOR_FILTER_CACHE_TTL_MS,
  };
}

async function getAssessorPinSet(
  where: string
): Promise<{
  pins: Set<string>;
  status: AssessorCacheStatus;
  generatedAt: number;
  expiresAt: number;
}> {
  const now = Date.now();

  const existing =
    assessorPinCache.get(where);

  if (
    existing &&
    existing.expiresAt > now
  ) {
    return {
      pins: existing.pins,
      status: "hit",
      generatedAt:
        existing.generatedAt,
      expiresAt:
        existing.expiresAt,
    };
  }

  const existingBuild =
    assessorPinBuildPromises.get(
      where
    );

  if (existingBuild) {
    const entry =
      await existingBuild;

    return {
      pins: entry.pins,
      status: "shared-build",
      generatedAt:
        entry.generatedAt,
      expiresAt:
        entry.expiresAt,
    };
  }

  const staleEntry =
    existing;

  const buildPromise =
    buildAssessorPinCacheEntry(
      where
    );

  assessorPinBuildPromises.set(
    where,
    buildPromise
  );

  try {
    const entry =
      await buildPromise;

    assessorPinCache.set(
      where,
      entry
    );

    return {
      pins: entry.pins,
      status: "miss",
      generatedAt:
        entry.generatedAt,
      expiresAt:
        entry.expiresAt,
    };
  } catch (error) {
    if (staleEntry) {
      console.warn(
        "[VacantWatch] Assessor filter refresh failed; using stale filter",
        error
      );

      return {
        pins: staleEntry.pins,
        status: "stale",
        generatedAt:
          staleEntry.generatedAt,
        expiresAt:
          staleEntry.expiresAt,
      };
    }

    throw error;
  } finally {
    assessorPinBuildPromises.delete(
      where
    );
  }
}

function createPinWhereClause(
  pins: string[]
): string {
  return pins
    .map(
      (pin) =>
        `PIN='${pin}'`
    )
    .join(" OR ");
}

async function fetchParcelGeometry(
  pins: string[]
): Promise<
  Array<
    ArcGisFeature<
      ParcelGeometryAttributes,
      ParcelGeometry
    >
  >
> {
  if (pins.length === 0) {
    return [];
  }

  const features: Array<
    ArcGisFeature<
      ParcelGeometryAttributes,
      ParcelGeometry
    >
  > = [];

  const batches = chunkArray(
    pins,
    ARCGIS_BATCH_SIZE
  );

  for (const batch of batches) {
    const parameters =
      new URLSearchParams({
        where:
          createPinWhereClause(
            batch
          ),

        outFields:
          "PIN,MAJOR,MINOR",

        returnGeometry: "true",
        outSR: "4326",
        f: "json",
      });

    const response =
      await fetchArcGisJson<
        ArcGisResponse<
          ParcelGeometryAttributes,
          ParcelGeometry
        >
      >(
        PARCEL_GEOMETRY_URL,
        parameters,
        "King County parcel-geometry request"
      );

    assertNoArcGisError(
      response,
      "King County parcel-geometry request"
    );

    features.push(
      ...(response.features ??
        [])
    );
  }

  return features;
}

function chooseBetterAssessorRecord(
  existing:
    | ParcelAssessorAttributes
    | undefined,

  candidate:
    ParcelAssessorAttributes
): ParcelAssessorAttributes {
  if (!existing) {
    return candidate;
  }

  const existingHasAddress =
    Boolean(
      cleanString(
        existing.ADDRESS
      )
    );

  const candidateHasAddress =
    Boolean(
      cleanString(
        candidate.ADDRESS
      )
    );

  if (
    !existingHasAddress &&
    candidateHasAddress
  ) {
    return candidate;
  }

  const existingHasUse =
    Boolean(
      cleanString(
        existing.PRES_USE
      )
    );

  const candidateHasUse =
    Boolean(
      cleanString(
        candidate.PRES_USE
      )
    );

  if (
    !existingHasUse &&
    candidateHasUse
  ) {
    return candidate;
  }

  return existing;
}

async function fetchParcelAttributes(
  pins: string[]
): Promise<
  Map<
    string,
    ParcelAssessorAttributes
  >
> {
  const attributesByPin =
    new Map<
      string,
      ParcelAssessorAttributes
    >();

  if (pins.length === 0) {
    return attributesByPin;
  }

  const batches = chunkArray(
    pins,
    ARCGIS_BATCH_SIZE
  );

  for (const batch of batches) {
    const parameters =
      new URLSearchParams({
        where:
          createPinWhereClause(
            batch
          ),

        outFields:
          ASSESSOR_FIELDS,

        returnGeometry: "false",
        f: "json",
      });

    const response =
      await fetchArcGisJson<
        ArcGisResponse<
          ParcelAssessorAttributes
        >
      >(
        PARCEL_ATTRIBUTES_URL,
        parameters,
        "King County assessor request"
      );

    assertNoArcGisError(
      response,
      "King County assessor request"
    );

    for (
      const feature of
      response.features ?? []
    ) {
      const attributes =
        feature.attributes;

      if (!attributes) {
        continue;
      }

      const pin =
        normalizePin(
          attributes.PIN
        );

      if (!pin) {
        continue;
      }

      attributesByPin.set(
        pin,

        chooseBetterAssessorRecord(
          attributesByPin.get(
            pin
          ),

          attributes
        )
      );
    }
  }

  return attributesByPin;
}

function getPolygonCenter(
  geometry:
    | ParcelGeometry
    | undefined
): {
  lat: number;
  lng: number;
} | null {
  const rings =
    geometry?.rings;

  if (!rings?.length) {
    return null;
  }

  let latitudeTotal = 0;
  let longitudeTotal = 0;
  let pointCount = 0;

  for (const ring of rings) {
    for (const point of ring) {
      const longitude =
        point?.[0];

      const latitude =
        point?.[1];

      if (
        !Number.isFinite(
          longitude
        ) ||
        !Number.isFinite(
          latitude
        )
      ) {
        continue;
      }

      longitudeTotal +=
        longitude;

      latitudeTotal +=
        latitude;

      pointCount += 1;
    }
  }

  if (pointCount === 0) {
    return null;
  }

  return {
    lat:
      latitudeTotal /
      pointCount,

    lng:
      longitudeTotal /
      pointCount,
  };
}

function getPrimarySignal(
  signals: PropertySignal[]
): PropertySignal {
  const priority:
    PropertySignal[] = [
    "blighted",
    "vacant",
    "tax-delinquent",
    "potential",
  ];

  return (
    priority.find(
      (signal) =>
        signals.includes(
          signal
        )
    ) ?? "potential"
  );
}

function featureToProperty(
  feature: ArcGisFeature<
    ParcelGeometryAttributes,
    ParcelGeometry
  >,

  taxByPin: Map<
    string,
    TaxAggregate
  >,

  attributesByPin: Map<
    string,
    ParcelAssessorAttributes
  >
): Property | null {
  const geometryAttributes =
    feature.attributes ?? {};

  const pin = normalizePin(
    geometryAttributes.PIN ??
      `${geometryAttributes.MAJOR ?? ""}${geometryAttributes.MINOR ?? ""}`
  );

  if (!pin) {
    return null;
  }

  const taxAggregate =
    taxByPin.get(pin);

  if (!taxAggregate) {
    return null;
  }

  const assessor =
    attributesByPin.get(pin);

  const polygonCenter =
    getPolygonCenter(
      feature.geometry
    );

  const assessorLatitude =
    numberOrUndefined(
      assessor?.LAT
    );

  const assessorLongitude =
    numberOrUndefined(
      assessor?.LON
    );

  const latitude =
    assessorLatitude ??
    polygonCenter?.lat;

  const longitude =
    assessorLongitude ??
    polygonCenter?.lng;

  if (
    latitude === undefined ||
    longitude === undefined
  ) {
    return null;
  }

  const major =
    cleanString(
      geometryAttributes.MAJOR
    ) ?? pin.slice(0, 6);

  const minor =
    cleanString(
      geometryAttributes.MINOR
    ) ?? pin.slice(6, 10);

  const propertyName =
    cleanString(
      assessor?.PROP_NAME
    );

  const presentUse =
    cleanString(
      assessor?.PRES_USE
    );

  const ownershipType =
    cleanString(
      assessor?.PUB_OWN_TYPE
    );

  const zoning =
    cleanString(
      assessor?.ZONING
    );

  const parcelSquareFeet =
    integerOrUndefined(
      assessor?.PARCEL_SQFT
    );

  const landSquareFeet =
    integerOrUndefined(
      assessor?.LAND_SQFT
    );

  const buildingSquareFeet =
    integerOrUndefined(
      assessor?.BLDG_GRSS_SQFT
    );

  const landUseCode =
    integerOrUndefined(
      assessor?.LAND_USE_CODE
    );

  const landValue =
    integerOrUndefined(
      assessor?.LAND_AV
    );

  const buildingValue =
    integerOrUndefined(
      assessor?.BLDG_AV
    );

  const yearBuilt =
    yearOrUndefined(
      assessor?.YEAR_BUILT
    );

  const totalAssessedValue =
    landValue !== undefined ||
    buildingValue !== undefined
      ? (landValue ?? 0) +
        (buildingValue ?? 0)
      : undefined;

  const signals:
    PropertySignal[] = [
    "tax-delinquent",
  ];

  const vacantByUse =
    presentUse
      ?.toLowerCase()
      .includes("vacant") ??
    false;

  const vacantByBuildingArea =
    buildingSquareFeet === 0;

  if (
    vacantByUse ||
    vacantByBuildingArea
  ) {
    signals.push("vacant");
  }

  const primaryStatus =
    getPrimarySignal(signals);

  const outstandingCents =
    Math.max(
      0,

      taxAggregate.billedCents -
        taxAggregate.paidCents
    );

  const address =
    cleanString(
      assessor?.ADDRESS
    ) ??
    `Parcel ${major}-${minor}`;

  const billYears =
    Array.from(
      taxAggregate.billYears
    ).sort(
      (first, second) =>
        Number(first) -
        Number(second)
    );

  return {
    id: pin,
    address,

    lat: latitude,
    lng: longitude,

    status: primaryStatus,
    primaryStatus,
    signals,

    major,
    minor,
    propertyName,
    presentUse,
    landUseCode,
    ownershipType,
    parcelSquareFeet,
    landSquareFeet,
    buildingSquareFeet,
    landValue,
    buildingValue,
    totalAssessedValue,
    yearBuilt,
    zoning,

    billedAmount:
      centsToDollars(
        taxAggregate.billedCents
      ),

    paidAmount:
      centsToDollars(
        taxAggregate.paidCents
      ),

    outstandingAmount:
      centsToDollars(
        outstandingCents
      ),

    billYears,

    taxRecordCount:
      taxAggregate.recordCount,
  };
}

function sortTaxRecords(
  records: TaxRecordDetail[]
): TaxRecordDetail[] {
  return [...records].sort(
    (first, second) => {
      const yearDifference =
        Number(
          second.billYear ?? 0
        ) -
        Number(
          first.billYear ?? 0
        );

      if (yearDifference !== 0) {
        return yearDifference;
      }

      return String(
        first.receivableType ??
          ""
      ).localeCompare(
        String(
          second.receivableType ??
            ""
        )
      );
    }
  );
}

export async function getProperties(
  options:
    PropertyQueryOptions = {}
) {
  const limit = Math.min(
    Math.max(
      Math.floor(
        options.limit ?? 100
      ),
      1
    ),
    500
  );

  const offset = Math.max(
    Math.floor(
      options.offset ?? 0
    ),
    0
  );

  const signal =
    options.signal ?? "all";

  const query =
    String(
      options.query ?? ""
    )
      .trim()
      .slice(0, 100);

  const minOutstanding =
    Number.isFinite(
      options.minOutstanding
    )
      ? Math.max(
          options.minOutstanding ??
            0,
          0
        )
      : 0;

  const {
    index: taxIndex,
    status: taxCacheStatus,
  } = await getTaxIndex();

  let candidates =
    taxIndex
      .orderedTaxAggregates;

  const minimumCents =
    Math.round(
      minOutstanding * 100
    );

  if (minimumCents > 0) {
    candidates =
      candidates.filter(
        (aggregate) => {
          const outstanding =
            Math.max(
              0,

              aggregate.billedCents -
                aggregate.paidCents
            );

          return (
            outstanding >=
            minimumCents
          );
        }
      );
  }

  const numericQuery =
    query.replace(/\D/g, "");

  const queryIsNumeric =
    query.length > 0 &&
    /^[\d\s-]+$/.test(query);

  if (
    queryIsNumeric &&
    numericQuery.length > 0
  ) {
    candidates =
      candidates.filter(
        (aggregate) =>
          aggregate.pin.includes(
            numericQuery
          )
      );
  }

  let assessorCacheStatus:
    AssessorCacheStatus =
    "not-needed";

  let assessorCacheGeneratedAt:
    number | null = null;

  let assessorCacheExpiresAt:
    number | null = null;

  if (
    signal === "blighted" ||
    signal === "potential"
  ) {
    candidates = [];
  } else {
    const assessorWhere =
      buildAssessorFilterWhere({
        signal,
        query,
      });

    if (assessorWhere) {
      const assessorResult =
        await getAssessorPinSet(
          assessorWhere
        );

      assessorCacheStatus =
        assessorResult.status;

      assessorCacheGeneratedAt =
        assessorResult.generatedAt;

      assessorCacheExpiresAt =
        assessorResult.expiresAt;

      candidates =
        candidates.filter(
          (aggregate) =>
            assessorResult.pins.has(
              aggregate.pin
            )
        );
    }
  }

  const totalProperties =
    candidates.length;

  const pageAggregates =
    candidates.slice(
      offset,
      offset + limit
    );

  const pageTaxByPin =
    new Map<
      string,
      TaxAggregate
    >(
      pageAggregates.map(
        (aggregate) => [
          aggregate.pin,
          aggregate,
        ]
      )
    );

  const pins =
    pageAggregates.map(
      (aggregate) =>
        aggregate.pin
    );

  const [
    parcelGeometry,
    attributesByPin,
  ] = await Promise.all([
    fetchParcelGeometry(pins),

    fetchParcelAttributes(
      pins
    ),
  ]);

  const propertyByPin =
    new Map<
      string,
      Property
    >();

  for (
    const feature of
    parcelGeometry
  ) {
    const property =
      featureToProperty(
        feature,
        pageTaxByPin,
        attributesByPin
      );

    if (property) {
      propertyByPin.set(
        property.id,
        property
      );
    }
  }

  const properties =
    Array.from(
      propertyByPin.values()
    ).sort(
      (first, second) =>
        (second.outstandingAmount ??
          0) -
        (first.outstandingAmount ??
          0)
    );

  const matchedPins =
    new Set(
      properties.map(
        (property) =>
          property.id
      )
    );

  const nextOffset =
    offset +
    pageAggregates.length;

  const currentTime =
    Date.now();

  return {
    properties,

    count:
      properties.length,

    filters: {
      signal,
      query,
      minOutstanding,
    },

    pagination: {
      limit,
      offset,
      nextOffset,

      totalProperties,

      unfilteredTotalProperties:
        taxIndex
          .orderedTaxAggregates
          .length,

      propertiesRequested:
        pageAggregates.length,

      propertiesReturned:
        properties.length,

      hasMoreProperties:
        nextOffset <
        totalProperties,

      taxRowsScanned:
        taxIndex.taxRowsScanned,

      taxRowsTruncated:
        taxIndex.taxRowsTruncated,
    },

    cache: {
      tax: {
        status:
          taxCacheStatus,

        generatedAt:
          new Date(
            taxIndex.generatedAt
          ).toISOString(),

        expiresAt:
          new Date(
            taxIndex.expiresAt
          ).toISOString(),

        ageSeconds:
          Math.max(
            0,

            Math.floor(
              (currentTime -
                taxIndex.generatedAt) /
                1000
            )
          ),

        ttlSeconds:
          Math.floor(
            TAX_CACHE_TTL_MS /
              1000
          ),
      },

      assessor: {
        status:
          assessorCacheStatus,

        generatedAt:
          assessorCacheGeneratedAt
            ? new Date(
                assessorCacheGeneratedAt
              ).toISOString()
            : null,

        expiresAt:
          assessorCacheExpiresAt
            ? new Date(
                assessorCacheExpiresAt
              ).toISOString()
            : null,

        ttlSeconds:
          Math.floor(
            ASSESSOR_FILTER_CACHE_TTL_MS /
              1000
          ),
      },
    },

    source: {
      taxes:
        "King County Delinquent Taxes",

      geometry:
        "King County PARCEL_AREA_439",

      attributes:
        "King County Tax Parcel Centroids with Assessor Attributes",
    },

    debug: {
      totalUniquePins:
        taxIndex.taxByPin.size,

      filteredPins:
        totalProperties,

      pagePins:
        pins.length,

      parcelFeaturesReturned:
        parcelGeometry.length,

      assessorMatches:
        attributesByPin.size,

      matchedWithGeometry:
        properties.length,

      vacantProperties:
        properties.filter(
          (property) =>
            property.signals.includes(
              "vacant"
            )
        ).length,

      taxDelinquentProperties:
        properties.filter(
          (property) =>
            property.signals.includes(
              "tax-delinquent"
            )
        ).length,

      unmatchedPins:
        pins.filter(
          (pin) =>
            !matchedPins.has(
              pin
            )
        ),
    },
  };
}

export async function getPropertyById(
  value: string
): Promise<
  PropertyDetail | null
> {
  const pin =
    normalizePin(value);

  if (!pin) {
    return null;
  }

  const taxRecords =
    await fetchTaxRecords({
      limit: 5000,
      offset: 0,
      pin,
    });

  const taxByPin =
    aggregateTaxRecords(
      taxRecords,
      true
    );

  const taxAggregate =
    taxByPin.get(pin);

  if (!taxAggregate) {
    return null;
  }

  const [
    parcelGeometry,
    attributesByPin,
  ] = await Promise.all([
    fetchParcelGeometry([pin]),

    fetchParcelAttributes([
      pin,
    ]),
  ]);

  let property:
    | Property
    | null = null;

  for (
    const feature of
    parcelGeometry
  ) {
    const candidate =
      featureToProperty(
        feature,
        taxByPin,
        attributesByPin
      );

    if (
      candidate?.id === pin
    ) {
      property = candidate;
      break;
    }
  }

  if (!property) {
    return null;
  }

  return {
    ...property,

    taxRecords:
      sortTaxRecords(
        taxAggregate.records
      ),
  };
}