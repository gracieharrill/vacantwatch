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
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/King_County_Tax_Parcel_Centroids_with_select_City_of_Seattle_geographic_overlays/FeatureServer/0/query";

const TAX_BATCH_SIZE = 5000;
const MAX_TAX_ROWS = 200000;
const ARCGIS_BATCH_SIZE = 75;

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

  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

/*
 * Convert a parcel number or 12-digit tax account number
 * into a 10-digit King County PIN.
 *
 * Tax account example:
 * 000740015306
 *
 * Parcel PIN:
 * 0007400153
 */
export function normalizePin(
  value: unknown
): string | null {
  const digits = String(value ?? "").replace(
    /\D/g,
    ""
  );

  if (digits.length < 10) {
    return null;
  }

  return digits.slice(0, 10);
}

function cleanString(
  value: unknown
): string | undefined {
  const result = String(value ?? "").trim();

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
  const result = numberOrUndefined(value);

  if (result === undefined) {
    return undefined;
  }

  return Math.round(result);
}

function yearOrUndefined(
  value: unknown
): number | undefined {
  const result = integerOrUndefined(value);

  if (
    result === undefined ||
    result <= 0
  ) {
    return undefined;
  }

  return result;
}

/*
 * King County stores the tax amounts as integer cents
 * inside text fields.
 */
function parseCents(value: unknown): number {
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
      values.slice(index, index + size)
    );
  }

  return chunks;
}

async function fetchJson<T>(
  url: string,
  description: string
): Promise<T> {
  const response = await fetch(url, {
    next: {
      revalidate: 3600,
    },
  });

  if (!response.ok) {
    throw new Error(
      `${description} failed with status ${response.status}`
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
      `${description} failed`,
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
}: TaxFetchOptions): Promise<TaxRow[]> {
  const parameters =
    new URLSearchParams({
      $select: TAX_SELECT_FIELDS,

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
    /*
     * The tax account begins with the 10-digit parcel PIN
     * and normally ends with a two-digit account suffix.
     */
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

/*
 * Fetch every tax row before parcel pagination.
 *
 * This prevents a parcel's individual tax rows from being
 * divided between two different API pages.
 */
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

    if (batch.length < TAX_BATCH_SIZE) {
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
  records: TaxRow[]
): Map<string, TaxAggregate> {
  const taxByPin =
    new Map<string, TaxAggregate>();

  for (const record of records) {
    /*
     * The correct parcel PIN is the FIRST 10 digits
     * of the 12-digit tax account number.
     */
    const pin = normalizePin(
      record.account_number
    );

    if (!pin) {
      continue;
    }

    const billedCents = parseCents(
      record.billed_amount
    );

    const paidCents = parseCents(
      record.paid_amount
    );

    const outstandingCents = Math.max(
      0,
      billedCents - paidCents
    );

    let aggregate = taxByPin.get(pin);

    if (!aggregate) {
      aggregate = {
        pin,
        billedCents: 0,
        paidCents: 0,
        billYears: new Set<string>(),
        recordCount: 0,
        records: [],
      };

      taxByPin.set(pin, aggregate);
    }

    aggregate.billedCents += billedCents;
    aggregate.paidCents += paidCents;
    aggregate.recordCount += 1;

    const billYear = cleanString(
      record.bill_year
    );

    if (billYear) {
      aggregate.billYears.add(billYear);
    }

    aggregate.records.push({
      billYear,
      levyCode: cleanString(
        record.levy_code
      ),
      receivableType: cleanString(
        record.receivable_type
      ),
      taxStatus: cleanString(
        record.tax_status
      ),
      billedAmount:
        centsToDollars(billedCents),
      paidAmount:
        centsToDollars(paidCents),
      outstandingAmount:
        centsToDollars(
          outstandingCents
        ),
    });
  }

  return taxByPin;
}

function createPinWhereClause(
  pins: string[]
): string {
  return pins
    .map((pin) => `PIN='${pin}'`)
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
          createPinWhereClause(batch),

        outFields:
          "PIN,MAJOR,MINOR",

        returnGeometry: "true",
        outSR: "4326",
        f: "json",
      });

    const response =
      await fetchJson<
        ArcGisResponse<
          ParcelGeometryAttributes,
          ParcelGeometry
        >
      >(
        `${PARCEL_GEOMETRY_URL}?${parameters.toString()}`,
        "King County parcel-geometry request"
      );

    assertNoArcGisError(
      response,
      "King County parcel-geometry request"
    );

    features.push(
      ...(response.features ?? [])
    );
  }

  return features;
}

function chooseBetterAssessorRecord(
  existing:
    | ParcelAssessorAttributes
    | undefined,
  candidate: ParcelAssessorAttributes
): ParcelAssessorAttributes {
  if (!existing) {
    return candidate;
  }

  const existingHasAddress =
    Boolean(
      cleanString(existing.ADDRESS)
    );

  const candidateHasAddress =
    Boolean(
      cleanString(candidate.ADDRESS)
    );

  if (
    !existingHasAddress &&
    candidateHasAddress
  ) {
    return candidate;
  }

  return existing;
}

async function fetchParcelAttributes(
  pins: string[]
): Promise<
  Map<string, ParcelAssessorAttributes>
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
          createPinWhereClause(batch),

        outFields: ASSESSOR_FIELDS,
        returnGeometry: "false",
        f: "json",
      });

    const response =
      await fetchJson<
        ArcGisResponse<
          ParcelAssessorAttributes
        >
      >(
        `${PARCEL_ATTRIBUTES_URL}?${parameters.toString()}`,
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

      const pin = normalizePin(
        attributes?.PIN
      );

      if (!pin || !attributes) {
        continue;
      }

      attributesByPin.set(
        pin,
        chooseBetterAssessorRecord(
          attributesByPin.get(pin),
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
  const rings = geometry?.rings;

  if (!rings?.length) {
    return null;
  }

  let latitudeTotal = 0;
  let longitudeTotal = 0;
  let pointCount = 0;

  for (const ring of rings) {
    for (const point of ring) {
      const longitude = point?.[0];
      const latitude = point?.[1];

      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude)
      ) {
        continue;
      }

      longitudeTotal += longitude;
      latitudeTotal += latitude;
      pointCount += 1;
    }
  }

  if (pointCount === 0) {
    return null;
  }

  return {
    lat: latitudeTotal / pointCount,
    lng: longitudeTotal / pointCount,
  };
}

function getPrimarySignal(
  signals: PropertySignal[]
): PropertySignal {
  const priority: PropertySignal[] = [
    "blighted",
    "vacant",
    "tax-delinquent",
    "potential",
  ];

  return (
    priority.find((signal) =>
      signals.includes(signal)
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

  const center = getPolygonCenter(
    feature.geometry
  );

  if (!center) {
    return null;
  }

  const assessor =
    attributesByPin.get(pin);

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

  const signals: PropertySignal[] = [
    "tax-delinquent",
  ];

  const vacantByUse =
    presentUse
      ?.toLowerCase()
      .includes("vacant") ?? false;

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

  const outstandingCents = Math.max(
    0,
    taxAggregate.billedCents -
      taxAggregate.paidCents
  );

  const address =
    cleanString(assessor?.ADDRESS) ??
    `Parcel ${major}-${minor}`;

  const billYears = Array.from(
    taxAggregate.billYears
  ).sort((first, second) => {
    return (
      Number(first) - Number(second)
    );
  });

  return {
    id: pin,
    address,
    lat: center.lat,
    lng: center.lng,

    /*
     * status remains for compatibility with
     * the existing map and page components.
     */
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
        first.receivableType ?? ""
      ).localeCompare(
        String(
          second.receivableType ?? ""
        )
      );
    }
  );
}

/*
 * Return a page of complete property records.
 *
 * limit and offset refer to properties, not individual
 * delinquent-tax rows.
 */
export async function getProperties(
  options: PropertyQueryOptions = {}
) {
  const limit = Math.min(
    Math.max(
      Math.floor(options.limit ?? 100),
      1
    ),
    500
  );

  const offset = Math.max(
    Math.floor(options.offset ?? 0),
    0
  );

  /*
   * First collect and aggregate every tax row.
   */
  const {
    records: taxRecords,
    truncated: taxRowsTruncated,
  } = await fetchAllTaxRecords();

  const completeTaxByPin =
    aggregateTaxRecords(taxRecords);

  /*
   * Sort complete parcel totals before slicing the page.
   */
  const orderedTaxAggregates =
    Array.from(
      completeTaxByPin.values()
    ).sort((first, second) => {
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

      const amountDifference =
        secondOutstanding -
        firstOutstanding;

      if (amountDifference !== 0) {
        return amountDifference;
      }

      return first.pin.localeCompare(
        second.pin
      );
    });

  /*
   * Apply pagination only after parcel aggregation.
   */
  const pageAggregates =
    orderedTaxAggregates.slice(
      offset,
      offset + limit
    );

  const pageTaxByPin =
    new Map<string, TaxAggregate>(
      pageAggregates.map(
        (aggregate) => [
          aggregate.pin,
          aggregate,
        ]
      )
    );

  const pins = pageAggregates.map(
    (aggregate) => aggregate.pin
  );

  const [
    parcelGeometry,
    attributesByPin,
  ] = await Promise.all([
    fetchParcelGeometry(pins),
    fetchParcelAttributes(pins),
  ]);

  const propertyByPin =
    new Map<string, Property>();

  for (
    const feature of parcelGeometry
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

  const properties = Array.from(
    propertyByPin.values()
  ).sort((first, second) => {
    return (
      (second.outstandingAmount ?? 0) -
      (first.outstandingAmount ?? 0)
    );
  });

  const matchedPins = new Set(
    properties.map(
      (property) => property.id
    )
  );

  const nextOffset =
    offset + pageAggregates.length;

  return {
    properties,
    count: properties.length,

    pagination: {
      limit,
      offset,
      nextOffset,

      totalProperties:
        orderedTaxAggregates.length,

      propertiesRequested:
        pageAggregates.length,

      propertiesReturned:
        properties.length,

      hasMoreProperties:
        nextOffset <
        orderedTaxAggregates.length,

      taxRowsScanned:
        taxRecords.length,

      taxRowsTruncated,
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
        completeTaxByPin.size,

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

      unmatchedPins: pins.filter(
        (pin) =>
          !matchedPins.has(pin)
      ),
    },
  };
}

/*
 * Return the complete record for one parcel.
 */
export async function getPropertyById(
  value: string
): Promise<PropertyDetail | null> {
  const pin = normalizePin(value);

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
    aggregateTaxRecords(taxRecords);

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
    fetchParcelAttributes([pin]),
  ]);

  let property:
    | Property
    | null = null;

  for (
    const feature of parcelGeometry
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

    taxRecords: sortTaxRecords(
      taxAggregate.records
    ),
  };
}