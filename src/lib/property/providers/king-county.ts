import {
  getProperties as getKingCountyProperties,
  getPropertyById as getKingCountyPropertyById,
  normalizePin,
} from "../king-county";

import type {
  PropertyProvider,
} from "../provider";

export const kingCountyProvider = {
  id: "king-county",

  displayName:
    "King County, Washington",

  jurisdiction: {
    countryCode: "US",
    stateCode: "WA",
    countyName: "King County",
    countyFips: "53033",
  },

  source: {
    taxes:
      "King County Delinquent Taxes",

    geometry:
      "King County PARCEL_AREA_439",

    attributes:
      "King County Tax Parcel Centroids with Assessor Attributes",
  },

  capabilities: {
    parcelSearch: true,
    propertyDetails: true,
    taxDelinquency: true,
    vacancyCandidates: true,

    /*
     * The current provider searches county-wide
     * datasets but does not yet query by visible
     * map boundaries.
     */
    mapBounds: false,
  },

  normalizeParcelId:
    normalizePin,

  getProperties:
    getKingCountyProperties,

  getPropertyById:
    getKingCountyPropertyById,
} satisfies PropertyProvider;