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
     * Parcel candidates are restricted to the
     * visible map envelope before pagination.
     */
    mapBounds: true,
  },

  map: {
    center: {
      lat: 47.6062,
      lng: -122.3321,
    },

    defaultZoom: 16,
  },

  normalizeParcelId:
    normalizePin,

  getProperties:
    getKingCountyProperties,

  getPropertyById:
    getKingCountyPropertyById,
} satisfies PropertyProvider;
