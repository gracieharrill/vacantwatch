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

  normalizeParcelId:
    normalizePin,

  getProperties:
    getKingCountyProperties,

  getPropertyById:
    getKingCountyPropertyById,
} satisfies PropertyProvider;