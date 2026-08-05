import type {
  Property,
  PropertyDetail,
  PropertySignal,
} from "../types";

import type {
  PropertyListResult,
  PropertyMapBounds,
  PropertyProvider,
  PropertyQueryOptions,
} from "../provider";

const SPOKANE_PARCEL_QUERY_URL =
  "https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/LayersMenu/MapServer/16/query";

const MAX_PAGE_SIZE = 500;

const SPOKANE_OUT_FIELDS = [
  "OBJECTID",
  "PID_NUM",
  "owner_name",
  "prop_use_desc",
  "site_address",
  "site_city",
  "site_state",
  "site_zip",
  "asmt_year",
  "land_value",
  "acreage",
  "seg_status",
].join(",");

type SpokaneParcelAttributes = {
  OBJECTID?: number;
  PID_NUM?: string;
  owner_name?: string;
  prop_use_desc?: string;
  site_address?: string;
  site_city?: string;
  site_state?: string;
  site_zip?: string;
  asmt_year?: number | string;
  land_value?: number | string;
  acreage?: number | string;
  seg_status?: string;
};

type SpokaneParcelGeometry = {
  rings?: number[][][];
};

type ArcGisFeature = {
  attributes?: SpokaneParcelAttributes;
  geometry?: SpokaneParcelGeometry;
};

type ArcGisFeatureResponse = {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;

  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

type ArcGisCountResponse = {
  count?: number;

  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

function cleanString(
  value: unknown
): string | undefined {
  const result = String(
    value ?? ""
  ).trim();

  return result
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

  return result === undefined
    ? undefined
    : Math.round(result);
}

function escapeSqlLiteral(
  value: string
): string {
  return value.replaceAll(
    "'",
    "''"
  );
}

/*
 * Common Spokane parcel numbers resemble:
 *
 * 35182.4601
 *
 * This function also accepts the same number
 * without the period:
 *
 * 351824601
 */
export function normalizeSpokaneParcelId(
  value: unknown
): string | null {
  const original = String(
    value ?? ""
  )
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!original) {
    return null;
  }

  const digits =
    original.replace(/\D/g, "");

  if (digits.length === 9) {
    return `${digits.slice(
      0,
      5
    )}.${digits.slice(5)}`;
  }

  /*
   * Preserve less-common valid parcel formats
   * while rejecting unsafe query characters.
   */
  if (
    /^[A-Z0-9.-]{5,30}$/.test(
      original
    )
  ) {
    return original;
  }

  return null;
}

async function fetchArcGisJson<T>(
  parameters: URLSearchParams,
  description: string
): Promise<T> {
  const response = await fetch(
    SPOKANE_PARCEL_QUERY_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded;charset=UTF-8",

        Accept:
          "application/json",
      },

      body:
        parameters.toString(),

      cache: "no-store",
    }
  );

  if (!response.ok) {
    const responseText =
      await response
        .text()
        .catch(() => "");

    throw new Error(
      [
        `${description} failed with status ${response.status}`,

        responseText
          ? responseText.slice(
              0,
              500
            )
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

  throw new Error(
    [
      `${description} returned an ArcGIS error`,

      response.error.code
        ? `Code ${response.error.code}`
        : "",

      response.error.message,

      response.error.details
        ?.filter(Boolean)
        .join("; "),
    ]
      .filter(Boolean)
      .join(": ")
  );
}

function addBoundsParameters(
  parameters: URLSearchParams,
  bounds:
    | PropertyMapBounds
    | undefined
): void {
  if (!bounds) {
    return;
  }

  parameters.set(
    "geometry",
    [
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north,
    ].join(",")
  );

  parameters.set(
    "geometryType",
    "esriGeometryEnvelope"
  );

  parameters.set(
    "inSR",
    "4326"
  );

  parameters.set(
    "spatialRel",
    "esriSpatialRelIntersects"
  );
}

function buildWhereClause(
  options: PropertyQueryOptions
): string {
  const signal =
    options.signal ?? "all";

  /*
   * Spokane currently supports ordinary neutral
   * parcel browsing. It does not yet assign vacancy,
   * delinquency, blight, or potential-risk signals.
   */
  if (
    signal !== "all" &&
    signal !== "parcel"
  ) {
    return "1=0";
  }

  const conditions = [
    "PID_NUM IS NOT NULL",
  ];

  const query = String(
    options.query ?? ""
  )
    .trim()
    .slice(0, 100);

  if (!query) {
    return conditions.join(
      " AND "
    );
  }

  const escapedQuery =
    escapeSqlLiteral(
      query.toUpperCase()
    );

  const numericQuery =
    query.replace(
      /[^0-9.]/g,
      ""
    );

  const looksLikeParcelId =
    /^[\d.\-\s]+$/.test(
      query
    );

  if (looksLikeParcelId) {
    const normalized =
      normalizeSpokaneParcelId(
        query
      );

    const parcelSearch =
      escapeSqlLiteral(
        normalized ??
          numericQuery
      );

    conditions.push(
      `UPPER(PID_NUM) LIKE '%${parcelSearch}%'`
    );
  } else {
    conditions.push(
      [
        "(",
        `UPPER(site_address) LIKE '%${escapedQuery}%'`,
        " OR ",
        `UPPER(site_city) LIKE '%${escapedQuery}%'`,
        " OR ",
        `UPPER(owner_name) LIKE '%${escapedQuery}%'`,
        " OR ",
        `UPPER(prop_use_desc) LIKE '%${escapedQuery}%'`,
        ")",
      ].join("")
    );
  }

  return conditions.join(
    " AND "
  );
}

async function fetchParcelCount(
  where: string,
  bounds?:
    PropertyMapBounds
): Promise<number> {
  const parameters =
    new URLSearchParams({
      where,
      returnCountOnly: "true",
      f: "json",
    });

  addBoundsParameters(
    parameters,
    bounds
  );

  const response =
    await fetchArcGisJson<
      ArcGisCountResponse
    >(
      parameters,
      "Spokane County parcel-count request"
    );

  assertNoArcGisError(
    response,
    "Spokane County parcel-count request"
  );

  return Math.max(
    Number(response.count ?? 0),
    0
  );
}

async function fetchParcelFeatures({
  where,
  limit,
  offset,
  bounds,
}: {
  where: string;
  limit: number;
  offset: number;
  bounds?:
    PropertyMapBounds;
}): Promise<ArcGisFeature[]> {
  const parameters =
    new URLSearchParams({
      where,

      outFields:
        SPOKANE_OUT_FIELDS,

      returnGeometry: "true",
      outSR: "4326",

      resultOffset:
        String(offset),

      resultRecordCount:
        String(limit),

      orderByFields:
        "PID_NUM ASC",

      geometryPrecision: "7",
      f: "json",
    });

  addBoundsParameters(
    parameters,
    bounds
  );

  const response =
    await fetchArcGisJson<
      ArcGisFeatureResponse
    >(
      parameters,
      "Spokane County parcel request"
    );

  assertNoArcGisError(
    response,
    "Spokane County parcel request"
  );

  return response.features ?? [];
}

function getGeometryCenter(
  geometry:
    | SpokaneParcelGeometry
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

  let minimumLongitude =
    Number.POSITIVE_INFINITY;

  let maximumLongitude =
    Number.NEGATIVE_INFINITY;

  let minimumLatitude =
    Number.POSITIVE_INFINITY;

  let maximumLatitude =
    Number.NEGATIVE_INFINITY;

  for (const ring of rings) {
    for (const point of ring) {
      const longitude =
        Number(point?.[0]);

      const latitude =
        Number(point?.[1]);

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

      minimumLongitude =
        Math.min(
          minimumLongitude,
          longitude
        );

      maximumLongitude =
        Math.max(
          maximumLongitude,
          longitude
        );

      minimumLatitude =
        Math.min(
          minimumLatitude,
          latitude
        );

      maximumLatitude =
        Math.max(
          maximumLatitude,
          latitude
        );
    }
  }

  if (
    !Number.isFinite(
      minimumLongitude
    ) ||
    !Number.isFinite(
      minimumLatitude
    )
  ) {
    return null;
  }

  return {
    lng:
      (
        minimumLongitude +
        maximumLongitude
      ) / 2,

    lat:
      (
        minimumLatitude +
        maximumLatitude
      ) / 2,
  };
}

function buildAddress(
  attributes:
    SpokaneParcelAttributes,
  parcelId: string
): string {
  const street =
    cleanString(
      attributes.site_address
    );

  const city =
    cleanString(
      attributes.site_city
    );

  const state =
    cleanString(
      attributes.site_state
    );

  const zip =
    cleanString(
      attributes.site_zip
    );

  const cityStateZip = [
    city,
    [
      state,
      zip,
    ]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return [
    street,
    cityStateZip,
  ]
    .filter(Boolean)
    .join(", ") ||
    `Parcel ${parcelId}`;
}

function featureToProperty(
  feature: ArcGisFeature
): Property | null {
  const attributes =
    feature.attributes;

  if (!attributes) {
    return null;
  }

  const parcelId =
    normalizeSpokaneParcelId(
      attributes.PID_NUM
    );

  if (!parcelId) {
    return null;
  }

  const center =
    getGeometryCenter(
      feature.geometry
    );

  if (!center) {
    return null;
  }

  const acreage =
    numberOrUndefined(
      attributes.acreage
    );

  const parcelSquareFeet =
    acreage === undefined
      ? undefined
      : Math.round(
          acreage * 43560
        );

  const landValue =
    integerOrUndefined(
      attributes.land_value
    );

  const signals:
    PropertySignal[] = [
    "parcel",
  ];

  const digits =
    parcelId.replace(
      /\D/g,
      ""
    );

  return {
    id: parcelId,

    address:
      buildAddress(
        attributes,
        parcelId
      ),

    lat: center.lat,
    lng: center.lng,

    status: "parcel",
    primaryStatus: "parcel",
    signals,

    major:
      digits.length >= 5
        ? digits.slice(0, 5)
        : undefined,

    minor:
      digits.length > 5
        ? digits.slice(5)
        : undefined,

    presentUse:
      cleanString(
        attributes.prop_use_desc
      ),

    parcelSquareFeet,
    landSquareFeet:
      parcelSquareFeet,

    landValue,

    /*
     * The public parcel layer exposes land value,
     * not a complete assessed-value total.
     */
    totalAssessedValue:
      undefined,

    yearBuilt: undefined,
    zoning: undefined,

    billedAmount: undefined,
    paidAmount: undefined,
    outstandingAmount:
      undefined,

    billYears: [],
    taxRecordCount:
      undefined,
  };
}

export async function getSpokaneCountyProperties(
  options:
    PropertyQueryOptions = {}
): Promise<PropertyListResult> {
  const limit = Math.min(
    Math.max(
      Math.floor(
        options.limit ?? 100
      ),
      1
    ),
    MAX_PAGE_SIZE
  );

  const offset = Math.max(
    Math.floor(
      options.offset ?? 0
    ),
    0
  );

  const where =
    buildWhereClause(options);

  const baseWhere =
    "PID_NUM IS NOT NULL";

  const [
    totalProperties,
    unfilteredTotalProperties,
    features,
  ] = await Promise.all([
    fetchParcelCount(
      where,
      options.bounds
    ),

    where === baseWhere
      ? fetchParcelCount(
          where,
          options.bounds
        )
      : fetchParcelCount(
          baseWhere,
          options.bounds
        ),

    fetchParcelFeatures({
      where,
      limit,
      offset,
      bounds:
        options.bounds,
    }),
  ]);

  const properties =
    features
      .map(featureToProperty)
      .filter(
        (
          property
        ): property is Property =>
          property !== null
      );

  const nextOffset =
    offset + features.length;

  return {
    properties,

    count:
      properties.length,

    filters: {
      signal:
        options.signal ?? "all",

      query:
        String(
          options.query ?? ""
        ).trim(),

      minOutstanding: 0,

      bounds:
        options.bounds,
    },

    pagination: {
      limit,
      offset,
      nextOffset,

      totalProperties,
      unfilteredTotalProperties,

      propertiesRequested:
        features.length,

      propertiesReturned:
        properties.length,

      hasMoreProperties:
        nextOffset <
        totalProperties,
    },

    source: {
      geometry:
        "Spokane County SCOUT Parcel Numbers",

      attributes:
        "Spokane County SCOUT Parcel Numbers",
    },

    debug: {
      where,

      bounds:
        options.bounds,

      featuresReturned:
        features.length,

      propertiesReturned:
        properties.length,
    },
  };
}

export async function getSpokaneCountyPropertyById(
  value: string
): Promise<PropertyDetail | null> {
  const parcelId =
    normalizeSpokaneParcelId(
      value
    );

  if (!parcelId) {
    return null;
  }

  const escapedParcelId =
    escapeSqlLiteral(
      parcelId
    );

  const features =
    await fetchParcelFeatures({
      where:
        `PID_NUM = '${escapedParcelId}'`,

      limit: 1,
      offset: 0,
    });

  const property =
    features.length > 0
      ? featureToProperty(
          features[0]
        )
      : null;

  if (!property) {
    return null;
  }

  return {
    ...property,
    taxRecords: [],
  };
}

export const spokaneCountyProvider = {
  id: "spokane-county",

  displayName:
    "Spokane County, Washington",

  jurisdiction: {
    countryCode: "US",
    stateCode: "WA",
    countyName:
      "Spokane County",
    countyFips: "53063",
  },

  source: {
    geometry:
      "Spokane County SCOUT Parcel Numbers",

    attributes:
      "Spokane County SCOUT Parcel Numbers",
  },

  capabilities: {
    parcelSearch: true,
    propertyDetails: true,

    /*
     * The parcel service does not provide
     * King County-style delinquent-tax records.
     */
    taxDelinquency: false,
    vacancyCandidates: false,
    mapBounds: true,
  },

  map: {
    center: {
      lat: 47.6588,
      lng: -117.426,
    },

    defaultZoom: 14,
  },

  normalizeParcelId:
    normalizeSpokaneParcelId,

  getProperties:
    getSpokaneCountyProperties,

  getPropertyById:
    getSpokaneCountyPropertyById,
} satisfies PropertyProvider;