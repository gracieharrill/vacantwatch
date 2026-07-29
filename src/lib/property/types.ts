export type PropertySignal =
  | "vacant"
  | "tax-delinquent"
  | "blighted"
  | "potential";

export type PropertyStatus = PropertySignal;

export type Property = {
  id: string;
  address: string;
  lat: number;
  lng: number;

  /*
   * Kept for compatibility with the page and map.
   */
  status: PropertyStatus;

  primaryStatus: PropertySignal;
  signals: PropertySignal[];

  major?: string;
  minor?: string;
  propertyName?: string;
  presentUse?: string;
  landUseCode?: number;
  ownershipType?: string;

  parcelSquareFeet?: number;
  landSquareFeet?: number;
  buildingSquareFeet?: number;

  landValue?: number;
  buildingValue?: number;
  totalAssessedValue?: number;

  yearBuilt?: number;
  zoning?: string;

  billedAmount?: number;
  paidAmount?: number;
  outstandingAmount?: number;

  billYears?: string[];
  taxRecordCount?: number;
};

export type TaxRecordDetail = {
  billYear?: string;
  levyCode?: string;
  receivableType?: string;
  taxStatus?: string;

  billedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
};

export type PropertyDetail = Property & {
  taxRecords: TaxRecordDetail[];
};