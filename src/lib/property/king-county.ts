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

type TaxRecord = {
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
  rows: number;
  billYears: Set<string>;
};

type ParcelGeometryFeature = {
  attributes?: {
    PIN?: string;
    MAJOR?: string;
    MINOR?: string;
  };

  geometry?: {
    rings?: number[][][];
  };
};

type ParcelAttributeFeature = {
  attributes?: {
    PIN?: string;
    ADDRESS?: string;
    PROP_NAME?: string;

    PARCEL_SQFT?: number;
    LAND_SQFT?: number;

    LAND_USE_CODE?: number;
    PRES_USE?: string;
    PUB_OWN_TYPE?: string;

    BLDG_GRSS_SQFT?: number;

    LAND_AV?: number;
    BLDG_AV?: number;

    YEAR_BUILT?: string | number;
    ZONING?: string;

    LAT?: number;
    LON?: number;
  };
};

type ParcelAttributes = NonNullable<
  ParcelAttributeFeature["attributes"]
>;

type PropertyQueryOptions = {
  limit?: number;
  offset?: number;
};

function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizePin(
  value: unknown
): string | null {
  const normalized = normalizeDigits(value);

  if (normalized.length !== 10) {
    return null;
  }

  return normalized;
}

function accountNumberToPin(
  accountNumber: unknown
): string | null {
  const normalized = normalizeDigits(accountNumber);

  if (normalized.length < 10) {
    return null;
  }

  return normalized.slice(0, 10);
}

function parseCents(value: unknown): number {
  const normalized = String(value ?? "").replace(
    /[^\d-]/g,
    ""
  );

  const amount = Number.parseInt(normalized, 10);

  return Number.isFinite(amount) ? amount : 0;
}

function cleanText(
  value: unknown
): string | undefined {
  const text = String(value ?? "").trim();

  return text.length > 0 ? text : undefined;
}

function optionalNumber(
  value: unknown
): number | undefined {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return undefined;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? numberValue
    : undefined;
}

function optionalYear(
  value: unknown
): number | undefined {
  const normalized = String(value ?? "").trim();

  if (!/^\d{4}$/.test(normalized)) {
    return undefined;
  }

  const year = Number.parseInt(normalized, 10);

  return year > 0 ? year : undefined;
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
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function aggregateTaxRecords(
  taxRecords: TaxRecord[]
): Map<string, TaxAggregate> {
  const taxByPin =
    new Map<string, TaxAggregate>();

  for (const record of taxRecords) {
    const pin = accountNumberToPin(
      record.account_number
    );

    if (!pin) {
      continue;
    }

    const existing = taxByPin.get(pin) ?? {
      pin,
      billedCents: 0,
      paidCents: 0,
      rows: 0,
      billYears: new Set<string>(),
    };

    existing.billedCents += parseCents(
      record.billed_amount
    );

    existing.paidCents += parseCents(
      record.paid_amount
    );

    existing.rows += 1;

    if (record.bill_year) {
      existing.billYears.add(record.bill_year);
    }

    taxByPin.set(pin, existing);
  }

  return taxByPin;
}

function calculateGeometryCenter(
  geometry: ParcelGeometryFeature["geometry"]
): { lat: number; lng: number } | null {
  const points = geometry?.rings?.flat() ?? [];

  const validPoints = points.filter(
    (point) =>
      Array.isArray(point) &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
  );

  if (validPoints.length === 0) {
    return null;
  }

  const longitudes = validPoints.map(
    (point) => point[0]
  );

  const latitudes = validPoints.map(
    (point) => point[1]
  );

  return {
    lng:
      (Math.min(...longitudes) +
        Math.max(...longitudes)) /
      2,

    lat:
      (Math.min(...latitudes) +
        Math.max(...latitudes)) /
      2,
  };
}

function getMarkerPoint(
  geometry: ParcelGeometryFeature["geometry"],
  attributes?: ParcelAttributes
): { lat: number; lng: number } | null {
  const attributeLat = optionalNumber(
    attributes?.LAT
  );

  const attributeLng = optionalNumber(
    attributes?.LON
  );

  if (
    attributeLat !== undefined &&
    attributeLng !== undefined
  ) {
    return {
      lat: attributeLat,
      lng: attributeLng,
    };
  }

  return calculateGeometryCenter(geometry);
}

function determineSignals({
  presentUse,
  buildingSquareFeet,
}: {
  presentUse?: string;
  buildingSquareFeet?: number;
}): PropertySignal[] {
  const signals = new Set<PropertySignal>();

  /*
   * Every property in this adapter came from the
   * delinquent-tax data source.
   */
  signals.add("tax-delinquent");

  const normalizedPresentUse =
    presentUse?.toLowerCase() ?? "";

  const assessorSaysVacant =
    normalizedPresentUse.includes("vacant");

  const hasNoBuilding =
    buildingSquareFeet === 0;

  if (assessorSaysVacant || hasNoBuilding) {
    signals.add("vacant");
  }

  return Array.from(signals);
}

function determinePrimaryStatus(
  signals: PropertySignal[]
): PropertySignal {
  /*
   * Higher-priority signals appear first.
   * This controls the map marker and main label.
   */
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

async function fetchTaxRecords({
  limit,
  offset,
  pin,
}: {
  limit: number;
  offset: number;
  pin?: string;
}): Promise<TaxRecord[]> {
  const params = new URLSearchParams({
    $limit: String(limit),
    $offset: String(offset),
    $order: "account_number ASC, bill_year ASC",
  });

  if (pin) {
    params.set(
      "$where",
      `account_number like '${pin}%'`
    );
  }

  const response = await fetch(
    `${DELINQUENT_TAX_URL}?${params.toString()}`,
    {
      next: {
        revalidate: 3600,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Delinquent-tax request failed with ${response.status}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "The delinquent-tax API returned an invalid response"
    );
  }

  return data as TaxRecord[];
}

async function fetchParcelGeometry(
  pins: string[]
): Promise<ParcelGeometryFeature[]> {
  if (pins.length === 0) {
    return [];
  }

  const features: ParcelGeometryFeature[] = [];
  const batches = chunkArray(pins, 40);

  for (const batch of batches) {
    const validPins = batch
      .map(normalizePin)
      .filter(
        (pin): pin is string => pin !== null
      );

    if (validPins.length === 0) {
      continue;
    }

    const where = validPins
      .map((pin) => `PIN='${pin}'`)
      .join(" OR ");

    const params = new URLSearchParams({
      where,
      outFields: "PIN,MAJOR,MINOR",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "6",
      resultRecordCount: String(
        validPins.length
      ),
      f: "json",
    });

    const response = await fetch(
      `${PARCEL_GEOMETRY_URL}?${params.toString()}`,
      {
        next: {
          revalidate: 3600,
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Parcel geometry request failed with ${response.status}`
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Parcel geometry error ${data.error.code}: ${data.error.message}`
      );
    }

    if (Array.isArray(data.features)) {
      features.push(...data.features);
    }
  }

  return features;
}

async function fetchParcelAttributes(
  pins: string[]
): Promise<Map<string, ParcelAttributes>> {
  const attributesByPin =
    new Map<string, ParcelAttributes>();

  if (pins.length === 0) {
    return attributesByPin;
  }

  const batches = chunkArray(pins, 40);

  for (const batch of batches) {
    const validPins = batch
      .map(normalizePin)
      .filter(
        (pin): pin is string => pin !== null
      );

    if (validPins.length === 0) {
      continue;
    }

    const where = validPins
      .map((pin) => `PIN='${pin}'`)
      .join(" OR ");

    const params = new URLSearchParams({
      where,

      outFields: [
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
      ].join(","),

      returnGeometry: "false",

      resultRecordCount: String(
        validPins.length
      ),

      f: "json",
    });

    const response = await fetch(
      `${PARCEL_ATTRIBUTES_URL}?${params.toString()}`,
      {
        next: {
          revalidate: 3600,
        },
      }
    );

    /*
     * Attribute enrichment is optional.
     * Tax and geometry data should still work if this layer fails.
     */
    if (!response.ok) {
      console.warn(
        `Parcel attributes request failed with ${response.status}`
      );

      continue;
    }

    const data = await response.json();

    if (data.error) {
      console.warn(
        `Parcel attributes error ${data.error.code}: ${data.error.message}`
      );

      continue;
    }

    const features: ParcelAttributeFeature[] =
      Array.isArray(data.features)
        ? data.features
        : [];

    for (const feature of features) {
      const pin = normalizePin(
        feature.attributes?.PIN
      );

      if (pin && feature.attributes) {
        attributesByPin.set(
          pin,
          feature.attributes
        );
      }
    }
  }

  return attributesByPin;
}

function featureToProperty(
  feature: ParcelGeometryFeature,
  taxByPin: Map<string, TaxAggregate>,
  attributesByPin: Map<
    string,
    ParcelAttributes
  >
): Property | null {
  const pin = normalizePin(
    feature.attributes?.PIN
  );

  if (!pin) {
    return null;
  }

  const tax = taxByPin.get(pin);

  if (!tax) {
    return null;
  }

  const attributes = attributesByPin.get(pin);

  const markerPoint = getMarkerPoint(
    feature.geometry,
    attributes
  );

  if (!markerPoint) {
    return null;
  }

  const major =
    feature.attributes?.MAJOR ??
    pin.slice(0, 6);

  const minor =
    feature.attributes?.MINOR ??
    pin.slice(6);

  const assessorAddress = cleanText(
    attributes?.ADDRESS
  );

  const propertyName = cleanText(
    attributes?.PROP_NAME
  );

  const presentUse = cleanText(
    attributes?.PRES_USE
  );

  const buildingSquareFeet = optionalNumber(
    attributes?.BLDG_GRSS_SQFT
  );

  const landValue = optionalNumber(
    attributes?.LAND_AV
  );

  const buildingValue = optionalNumber(
    attributes?.BLDG_AV
  );

  const totalAssessedValue =
    landValue !== undefined ||
    buildingValue !== undefined
      ? (landValue ?? 0) +
        (buildingValue ?? 0)
      : undefined;

  const signals = determineSignals({
    presentUse,
    buildingSquareFeet,
  });

  const primaryStatus =
    determinePrimaryStatus(signals);

  const outstandingCents = Math.max(
    0,
    tax.billedCents - tax.paidCents
  );

  return {
    id: pin,

    address:
      assessorAddress ??
      propertyName ??
      `Parcel ${major}-${minor}`,

    lat: markerPoint.lat,
    lng: markerPoint.lng,

    /*
     * status keeps the current frontend working.
     * signals contains all applicable conditions.
     */
    status: primaryStatus,
    primaryStatus,
    signals,

    major,
    minor,

    propertyName,
    presentUse,

    landUseCode: optionalNumber(
      attributes?.LAND_USE_CODE
    ),

    ownershipType: cleanText(
      attributes?.PUB_OWN_TYPE
    ),

    parcelSquareFeet: optionalNumber(
      attributes?.PARCEL_SQFT
    ),

    landSquareFeet: optionalNumber(
      attributes?.LAND_SQFT
    ),

    buildingSquareFeet,

    landValue,
    buildingValue,
    totalAssessedValue,

    yearBuilt: optionalYear(
      attributes?.YEAR_BUILT
    ),

    zoning: cleanText(
      attributes?.ZONING
    ),

    billedAmount:
      tax.billedCents / 100,

    paidAmount:
      tax.paidCents / 100,

    outstandingAmount:
      outstandingCents / 100,

    billYears: Array.from(
      tax.billYears
    ).sort(
      (first, second) =>
        Number(first) - Number(second)
    ),

    taxRecordCount: tax.rows,
  };
}

function taxRecordToDetail(
  record: TaxRecord
): TaxRecordDetail {
  const billedCents = parseCents(
    record.billed_amount
  );

  const paidCents = parseCents(
    record.paid_amount
  );

  return {
    billYear: record.bill_year,
    levyCode: record.levy_code,
    receivableType:
      record.receivable_type,
    taxStatus: record.tax_status,

    billedAmount:
      billedCents / 100,

    paidAmount:
      paidCents / 100,

    outstandingAmount:
      Math.max(
        0,
        billedCents - paidCents
      ) / 100,
  };
}

export async function getProperties(
  options: PropertyQueryOptions = {}
) {
  const limit = Math.min(
    Math.max(options.limit ?? 1000, 1),
    5000
  );

  const offset = Math.max(
    options.offset ?? 0,
    0
  );

  const taxRecords =
    await fetchTaxRecords({
      limit,
      offset,
    });

  const taxByPin =
    aggregateTaxRecords(taxRecords);

  const pins = Array.from(
    taxByPin.keys()
  );

  const [
    parcelGeometry,
    attributesByPin,
  ] = await Promise.all([
    fetchParcelGeometry(pins),
    fetchParcelAttributes(pins),
  ]);

  const matchedPins = new Set<string>();

  const properties = parcelGeometry
    .map((feature) => {
      const property = featureToProperty(
        feature,
        taxByPin,
        attributesByPin
      );

      if (property) {
        matchedPins.add(property.id);
      }

      return property;
    })
    .filter(
      (property): property is Property =>
        property !== null
    )
    .sort(
      (first, second) =>
        (second.outstandingAmount ?? 0) -
        (first.outstandingAmount ?? 0)
    );

  return {
    properties,
    count: properties.length,

    pagination: {
      limit,
      offset,

      taxRowsReturned:
        taxRecords.length,

      hasMoreTaxRows:
        taxRecords.length === limit,
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
      uniquePins: pins.length,

      parcelFeaturesReturned:
        parcelGeometry.length,

      assessorMatches:
        attributesByPin.size,

      matchedWithGeometry:
        properties.length,

      vacantProperties:
        properties.filter((property) =>
          property.signals.includes("vacant")
        ).length,

      taxDelinquentProperties:
        properties.filter((property) =>
          property.signals.includes(
            "tax-delinquent"
          )
        ).length,

      unmatchedPins: pins
        .filter(
          (pin) =>
            !matchedPins.has(pin)
        )
        .slice(0, 20),
    },
  };
}

export async function getPropertyById(
  rawPin: string
): Promise<PropertyDetail | null> {
  const pin = normalizePin(rawPin);

  if (!pin) {
    return null;
  }

  const taxRecords =
    await fetchTaxRecords({
      pin,
      limit: 500,
      offset: 0,
    });

  if (taxRecords.length === 0) {
    return null;
  }

  const taxByPin =
    aggregateTaxRecords(taxRecords);

  const [
    parcelGeometry,
    attributesByPin,
  ] = await Promise.all([
    fetchParcelGeometry([pin]),
    fetchParcelAttributes([pin]),
  ]);

  const parcelFeature =
    parcelGeometry.find(
      (feature) =>
        normalizePin(
          feature.attributes?.PIN
        ) === pin
    );

  if (!parcelFeature) {
    return null;
  }

  const property = featureToProperty(
    parcelFeature,
    taxByPin,
    attributesByPin
  );

  if (!property) {
    return null;
  }

  const detailedTaxRecords =
    taxRecords
      .map(taxRecordToDetail)
      .sort((first, second) => {
        const yearDifference =
          Number(
            first.billYear ?? 0
          ) -
          Number(
            second.billYear ?? 0
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
      });

  return {
    ...property,
    taxRecords:
      detailedTaxRecords,
  };
}