"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import dynamic from "next/dynamic";
import {
  Filter,
  Search,
  X,
} from "lucide-react";

import {
  type Property,
  type PropertyDetail,
  type PropertySignal,
} from "../components/property-data";

const PAGE_SIZE = 100;

const Map = dynamic(
  () => import("../components/Map"),
  {
    ssr: false,

    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-100 text-slate-500">
        Loading map...
      </div>
    ),
  }
);

type PaginationInfo = {
  limit: number;
  offset: number;
  nextOffset: number;
  totalProperties: number;
  propertiesRequested: number;
  propertiesReturned: number;
  hasMoreProperties: boolean;
};

type PropertyPageResponse = {
  properties: Property[];
  count: number;
  pagination: PaginationInfo;
  error?: string;
};

const signals: PropertySignal[] = [
  "vacant",
  "tax-delinquent",
  "blighted",
  "potential",
];

const signalLabels: Record<
  PropertySignal,
  string
> = {
  vacant: "Vacant",
  "tax-delinquent": "Tax Delinquent",
  blighted: "Blighted",
  potential: "Potential",
};

const signalTextClasses: Record<
  PropertySignal,
  string
> = {
  vacant: "text-red-700",
  "tax-delinquent": "text-orange-700",
  blighted: "text-yellow-700",
  potential: "text-blue-700",
};

const signalBadgeClasses: Record<
  PropertySignal,
  string
> = {
  vacant:
    "border-red-200 bg-red-50 text-red-700",

  "tax-delinquent":
    "border-orange-200 bg-orange-50 text-orange-700",

  blighted:
    "border-yellow-200 bg-yellow-50 text-yellow-700",

  potential:
    "border-blue-200 bg-blue-50 text-blue-700",
};

const currencyFormatter =
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

const numberFormatter =
  new Intl.NumberFormat("en-US");

function getPropertySignals(
  property: Property
): PropertySignal[] {
  return property.signals?.length
    ? property.signals
    : [property.status];
}

async function fetchPropertyPage(
  offset: number,
  signal?: AbortSignal
): Promise<PropertyPageResponse> {
  const response = await fetch(
    `/api/properties?limit=${PAGE_SIZE}&offset=${offset}`,
    {
      signal,
      cache: "no-store",
    }
  );

  const data =
    (await response.json()) as PropertyPageResponse;

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Unable to load properties"
    );
  }

  if (!Array.isArray(data.properties)) {
    throw new Error(
      "The property API returned invalid data"
    );
  }

  if (!data.pagination) {
    throw new Error(
      "The property API returned no pagination information"
    );
  }

  return data;
}

export default function Home() {
  const [properties, setProperties] =
    useState<Property[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [loadingMore, setLoadingMore] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    loadMoreError,
    setLoadMoreError,
  ] = useState("");

  const [nextOffset, setNextOffset] =
    useState(0);

  const [
    hasMoreProperties,
    setHasMoreProperties,
  ] = useState(false);

  const [
    totalProperties,
    setTotalProperties,
  ] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] =
    useState("");

  const [
    selectedPropertyId,
    setSelectedPropertyId,
  ] = useState<string | null>(null);

  const [
    propertyDetail,
    setPropertyDetail,
  ] = useState<PropertyDetail | null>(
    null
  );

  const [
    detailLoading,
    setDetailLoading,
  ] = useState(false);

  const [
    detailError,
    setDetailError,
  ] = useState("");

  const [filters, setFilters] =
    useState<
      Record<PropertySignal, boolean>
    >({
      vacant: true,
      "tax-delinquent": true,
      blighted: true,
      potential: true,
    });

  /*
   * Load the first page.
   */
  useEffect(() => {
    const controller =
      new AbortController();

    async function loadInitialProperties() {
      try {
        setLoading(true);
        setError("");

        const data =
          await fetchPropertyPage(
            0,
            controller.signal
          );

        setProperties(data.properties);

        setNextOffset(
          data.pagination.nextOffset
        );

        setHasMoreProperties(
          data.pagination
            .hasMoreProperties
        );

        setTotalProperties(
          data.pagination.totalProperties
        );
      } catch (requestError) {
        if (
          requestError instanceof
            DOMException &&
          requestError.name ===
            "AbortError"
        ) {
          return;
        }

        console.error(requestError);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load properties"
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadInitialProperties();

    return () => {
      controller.abort();
    };
  }, []);

  /*
   * Read a parcel ID from the URL.
   */
  useEffect(() => {
    const parameters =
      new URLSearchParams(
        window.location.search
      );

    const parcelId =
      parameters.get("parcel");

    if (
      parcelId &&
      /^\d{10}$/.test(parcelId)
    ) {
      setSelectedPropertyId(parcelId);
    }
  }, []);

  /*
   * Keep the selected parcel in the URL.
   */
  useEffect(() => {
    const url =
      new URL(window.location.href);

    if (selectedPropertyId) {
      url.searchParams.set(
        "parcel",
        selectedPropertyId
      );
    } else {
      url.searchParams.delete(
        "parcel"
      );
    }

    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [selectedPropertyId]);

  /*
   * Load complete details for the
   * selected parcel.
   */
  useEffect(() => {
    if (!selectedPropertyId) {
      setPropertyDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }

    const controller =
      new AbortController();

    async function loadPropertyDetail() {
      try {
        setDetailLoading(true);
        setDetailError("");
        setPropertyDetail(null);

        const response = await fetch(
          `/api/properties/${selectedPropertyId}`,
          {
            signal: controller.signal,
            cache: "no-store",
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Unable to load property details"
          );
        }

        if (!data.property) {
          throw new Error(
            "The detail API returned no property"
          );
        }

        setPropertyDetail(
          data.property
        );
      } catch (requestError) {
        if (
          requestError instanceof
            DOMException &&
          requestError.name ===
            "AbortError"
        ) {
          return;
        }

        console.error(requestError);

        setDetailError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load property details"
        );
      } finally {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      }
    }

    loadPropertyDetail();

    return () => {
      controller.abort();
    };
  }, [selectedPropertyId]);

  const filteredProperties =
    useMemo(() => {
      const textQuery =
        searchQuery
          .trim()
          .toLowerCase();

      const numericQuery =
        searchQuery.replace(/\D/g, "");

      return properties.filter(
        (property) => {
          const propertySignals =
            getPropertySignals(property);

          const matchesSignal =
            propertySignals.some(
              (signal) =>
                filters[signal]
            );

          if (!matchesSignal) {
            return false;
          }

          if (!textQuery) {
            return true;
          }

          const searchableText = [
            property.id,
            property.address,
            property.major,
            property.minor,
            property.propertyName,
            property.presentUse,
            property.zoning,
            property.ownershipType,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          const searchableNumbers = [
            property.id,
            property.major,
            property.minor,
          ]
            .filter(Boolean)
            .join("")
            .replace(/\D/g, "");

          return (
            searchableText.includes(
              textQuery
            ) ||
            (numericQuery.length > 0 &&
              searchableNumbers.includes(
                numericQuery
              ))
          );
        }
      );
    }, [
      properties,
      filters,
      searchQuery,
    ]);

  const selectedProperty =
    useMemo(
      () =>
        properties.find(
          (property) =>
            property.id ===
            selectedPropertyId
        ) ?? null,
      [
        properties,
        selectedPropertyId,
      ]
    );

  useEffect(() => {
    if (
      loading ||
      !selectedPropertyId ||
      !selectedProperty
    ) {
      return;
    }

    const stillVisible =
      filteredProperties.some(
        (property) =>
          property.id ===
          selectedPropertyId
      );

    if (!stillVisible) {
      setSelectedPropertyId(null);
    }
  }, [
    filteredProperties,
    loading,
    selectedProperty,
    selectedPropertyId,
  ]);

  async function loadMoreProperties() {
    if (
      loadingMore ||
      !hasMoreProperties
    ) {
      return;
    }

    try {
      setLoadingMore(true);
      setLoadMoreError("");

      const data =
        await fetchPropertyPage(
          nextOffset
        );

      /*
       * Merge the page by parcel ID so that
       * duplicates cannot appear.
       */
      setProperties((current) => {
        const propertiesById =
          new globalThis.Map<
            string,
            Property
          >();

        for (const property of current) {
          propertiesById.set(
            property.id,
            property
          );
        }

        for (
          const property of
          data.properties
        ) {
          propertiesById.set(
            property.id,
            property
          );
        }

        return Array.from(
          propertiesById.values()
        );
      });

      setNextOffset(
        data.pagination.nextOffset
      );

      setHasMoreProperties(
        data.pagination
          .hasMoreProperties
      );

      setTotalProperties(
        data.pagination.totalProperties
      );
    } catch (requestError) {
      console.error(requestError);

      setLoadMoreError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load more properties"
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleFilter(
    signal: PropertySignal
  ) {
    setFilters((current) => ({
      ...current,
      [signal]: !current[signal],
    }));
  }

  function selectProperty(
    property: Property
  ) {
    setSelectedPropertyId(
      property.id
    );
  }

  function clearSelectedProperty() {
    setSelectedPropertyId(null);
    setPropertyDetail(null);
    setDetailError("");
  }

  const displayedDetail =
    propertyDetail ??
    selectedProperty;

  const displayedSignals =
    displayedDetail
      ? getPropertySignals(
          displayedDetail
        )
      : [];

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="flex w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <header className="border-b border-slate-200 p-4">
          <h1 className="text-xl font-bold text-slate-800">
            VacantWatch
          </h1>

          <div className="mt-1 flex justify-between text-sm text-slate-500">
            <span>King County</span>

            <span>
              {loading
                ? "Loading..."
                : `${filteredProperties.length} shown`}
            </span>
          </div>

          {!loading &&
            totalProperties !== null && (
              <div className="mt-1 text-xs text-slate-400">
                Loaded{" "}
                {numberFormatter.format(
                  properties.length
                )}{" "}
                of{" "}
                {numberFormatter.format(
                  totalProperties
                )}{" "}
                tax parcels
              </div>
            )}
        </header>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />

            <input
              type="search"
              value={searchQuery}
              onChange={(event) =>
                setSearchQuery(
                  event.target.value
                )
              }
              placeholder="Search loaded parcels..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Filter className="h-4 w-4" />
            Filters
          </div>

          <div className="space-y-2 text-sm">
            {signals.map((signal) => (
              <label
                key={signal}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={
                    filters[signal]
                  }
                  onChange={() =>
                    toggleFilter(signal)
                  }
                  className="rounded"
                />

                <span
                  className={
                    signalTextClasses[
                      signal
                    ]
                  }
                >
                  {
                    signalLabels[
                      signal
                    ]
                  }
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border-t border-slate-200">
          {loading && (
            <div className="p-4 text-sm text-slate-500">
              Loading live property
              records...
            </div>
          )}

          {!loading && error && (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            filteredProperties.length ===
              0 && (
              <div className="p-4 text-sm text-slate-500">
                No loaded properties match
                the current search and
                filters.
              </div>
            )}

          {!loading &&
            !error &&
            filteredProperties.map(
              (property) => {
                const selected =
                  property.id ===
                  selectedPropertyId;

                return (
                  <button
                    type="button"
                    key={property.id}
                    onClick={() =>
                      selectProperty(
                        property
                      )
                    }
                    className={`block w-full border-b px-4 py-3 text-left transition ${
                      selected
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-100 hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-sm font-medium text-slate-800">
                      {property.address}
                    </div>

                    <SignalBadges
                      property={property}
                    />

                    {property.presentUse && (
                      <div className="mt-2 text-xs text-slate-500">
                        {
                          property.presentUse
                        }
                      </div>
                    )}

                    {property.outstandingAmount !==
                      undefined && (
                      <div className="mt-1 text-sm font-semibold text-slate-700">
                        {currencyFormatter.format(
                          property.outstandingAmount
                        )}{" "}
                        outstanding
                      </div>
                    )}

                    {property.billYears
                      ?.length ? (
                      <div className="mt-1 text-xs text-slate-500">
                        Tax years:{" "}
                        {property.billYears.join(
                          ", "
                        )}
                      </div>
                    ) : null}
                  </button>
                );
              }
            )}

          {!loading && !error && (
            <div className="p-4">
              {loadMoreError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {loadMoreError}
                </div>
              )}

              {hasMoreProperties ? (
                <button
                  type="button"
                  onClick={
                    loadMoreProperties
                  }
                  disabled={loadingMore}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {loadingMore
                    ? "Loading more..."
                    : "Load More Properties"}
                </button>
              ) : (
                <div className="text-center text-sm text-slate-500">
                  All available properties
                  have been loaded.
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="relative flex-1 overflow-hidden">
        <Map
          properties={
            filteredProperties
          }
          selectedPropertyId={
            selectedPropertyId
          }
          onSelectProperty={
            selectProperty
          }
        />

        {selectedPropertyId && (
          <aside className="absolute inset-y-0 right-0 z-[1000] flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 p-5">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Property details
                </div>

                <h2 className="mt-1 truncate text-xl font-bold text-slate-900">
                  {displayedDetail?.address ??
                    `Parcel ${selectedPropertyId}`}
                </h2>

                <div className="mt-1 text-sm text-slate-500">
                  Parcel ID:{" "}
                  {selectedPropertyId}
                </div>
              </div>

              <button
                type="button"
                onClick={
                  clearSelectedProperty
                }
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close property details"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              {detailLoading && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
                  Loading complete property
                  record...
                </div>
              )}

              {detailError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {detailError}
                </div>
              )}

              {displayedDetail && (
                <div className="space-y-6">
                  <section>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Property signals
                    </h3>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {displayedSignals.map(
                        (signal) => (
                          <span
                            key={signal}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                              signalBadgeClasses[
                                signal
                              ]
                            }`}
                          >
                            {
                              signalLabels[
                                signal
                              ]
                            }
                          </span>
                        )
                      )}
                    </div>
                  </section>

                  <section className="grid grid-cols-2 gap-3">
                    <SummaryCard
                      label="Outstanding"
                      value={
                        displayedDetail.outstandingAmount !==
                        undefined
                          ? currencyFormatter.format(
                              displayedDetail.outstandingAmount
                            )
                          : "Not available"
                      }
                    />

                    <SummaryCard
                      label="Assessed value"
                      value={
                        displayedDetail.totalAssessedValue !==
                        undefined
                          ? currencyFormatter.format(
                              displayedDetail.totalAssessedValue
                            )
                          : "Not available"
                      }
                    />

                    <SummaryCard
                      label="Land value"
                      value={
                        displayedDetail.landValue !==
                        undefined
                          ? currencyFormatter.format(
                              displayedDetail.landValue
                            )
                          : "Not available"
                      }
                    />

                    <SummaryCard
                      label="Building value"
                      value={
                        displayedDetail.buildingValue !==
                        undefined
                          ? currencyFormatter.format(
                              displayedDetail.buildingValue
                            )
                          : "Not available"
                      }
                    />
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Assessor information
                    </h3>

                    <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                      <DetailRow
                        label="Present use"
                        value={
                          displayedDetail.presentUse
                        }
                      />

                      <DetailRow
                        label="Ownership"
                        value={
                          displayedDetail.ownershipType
                        }
                      />

                      <DetailRow
                        label="Land-use code"
                        value={
                          displayedDetail.landUseCode
                        }
                      />

                      <DetailRow
                        label="Zoning"
                        value={
                          displayedDetail.zoning
                        }
                      />

                      <DetailRow
                        label="Year built"
                        value={
                          displayedDetail.yearBuilt
                        }
                      />

                      <DetailRow
                        label="Parcel area"
                        value={
                          displayedDetail.parcelSquareFeet !==
                          undefined
                            ? `${numberFormatter.format(
                                displayedDetail.parcelSquareFeet
                              )} sq. ft.`
                            : undefined
                        }
                      />

                      <DetailRow
                        label="Land area"
                        value={
                          displayedDetail.landSquareFeet !==
                          undefined
                            ? `${numberFormatter.format(
                                displayedDetail.landSquareFeet
                              )} sq. ft.`
                            : undefined
                        }
                      />

                      <DetailRow
                        label="Building area"
                        value={
                          displayedDetail.buildingSquareFeet !==
                          undefined
                            ? `${numberFormatter.format(
                                displayedDetail.buildingSquareFeet
                              )} sq. ft.`
                            : undefined
                        }
                      />
                    </dl>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Parcel information
                    </h3>

                    <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                      <DetailRow
                        label="Major"
                        value={
                          displayedDetail.major
                        }
                      />

                      <DetailRow
                        label="Minor"
                        value={
                          displayedDetail.minor
                        }
                      />

                      <DetailRow
                        label="Latitude"
                        value={displayedDetail.lat.toFixed(
                          6
                        )}
                      />

                      <DetailRow
                        label="Longitude"
                        value={displayedDetail.lng.toFixed(
                          6
                        )}
                      />
                    </dl>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Tax years
                    </h3>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {displayedDetail.billYears
                        ?.length ? (
                        displayedDetail.billYears.map(
                          (year) => (
                            <span
                              key={year}
                              className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700"
                            >
                              {year}
                            </span>
                          )
                        )
                      ) : (
                        <span className="text-sm text-slate-500">
                          No tax years
                          available.
                        </span>
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Tax summary
                    </h3>

                    <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                      <DetailRow
                        label="Billed"
                        value={
                          displayedDetail.billedAmount !==
                          undefined
                            ? currencyFormatter.format(
                                displayedDetail.billedAmount
                              )
                            : undefined
                        }
                      />

                      <DetailRow
                        label="Paid"
                        value={
                          displayedDetail.paidAmount !==
                          undefined
                            ? currencyFormatter.format(
                                displayedDetail.paidAmount
                              )
                            : undefined
                        }
                      />

                      <DetailRow
                        label="Outstanding"
                        value={
                          displayedDetail.outstandingAmount !==
                          undefined
                            ? currencyFormatter.format(
                                displayedDetail.outstandingAmount
                              )
                            : undefined
                        }
                      />

                      <DetailRow
                        label="Tax records"
                        value={
                          displayedDetail.taxRecordCount
                        }
                      />
                    </dl>
                  </section>

                  {propertyDetail?.taxRecords && (
                    <section>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Individual tax records
                      </h3>

                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-slate-500">
                                Year
                              </th>

                              <th className="px-3 py-2 text-left font-medium text-slate-500">
                                Type
                              </th>

                              <th className="px-3 py-2 text-left font-medium text-slate-500">
                                Levy
                              </th>

                              <th className="px-3 py-2 text-right font-medium text-slate-500">
                                Outstanding
                              </th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-100 bg-white">
                            {propertyDetail.taxRecords.map(
                              (
                                taxRecord,
                                index
                              ) => (
                                <tr
                                  key={`${taxRecord.billYear}-${taxRecord.levyCode}-${taxRecord.receivableType}-${index}`}
                                >
                                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                                    {taxRecord.billYear ??
                                      "—"}
                                  </td>

                                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                                    {taxRecord.receivableType ??
                                      "—"}
                                  </td>

                                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                                    {taxRecord.levyCode ??
                                      "—"}
                                  </td>

                                  <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-slate-900">
                                    {currencyFormatter.format(
                                      taxRecord.outstandingAmount
                                    )}
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function SignalBadges({
  property,
}: {
  property: Property;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {getPropertySignals(
        property
      ).map((signal) => (
        <span
          key={signal}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            signalBadgeClasses[signal]
          }`}
        >
          {signalLabels[signal]}
        </span>
      ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">
        {label}
      </div>

      <div className="mt-1 font-semibold text-slate-900">
        {value}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value:
    | string
    | number
    | null
    | undefined;
}) {
  return (
    <div className="flex justify-between gap-4 p-3 text-sm">
      <dt className="text-slate-500">
        {label}
      </dt>

      <dd className="text-right font-medium text-slate-900">
        {value ?? "Not available"}
      </dd>
    </div>
  );
}