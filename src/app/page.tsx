"use client";

import {
  FormEvent,
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

import type {
  Property,
  PropertyDetail,
  PropertySignal,
} from "../components/property-data";

const PAGE_SIZE = 100;

type ServerSignal =
  | "all"
  | "vacant"
  | "tax-delinquent";

type PaginationInfo = {
  limit: number;
  offset: number;
  nextOffset: number;
  totalProperties: number;
  unfilteredTotalProperties: number;
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

type PropertyPageOptions = {
  offset: number;
  signal: ServerSignal;
  query: string;
  minOutstanding: number;
  abortSignal?: AbortSignal;
};

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

const signalLabels: Record<
  PropertySignal,
  string
> = {
  vacant: "Vacant",
  "tax-delinquent": "Tax Delinquent",
  blighted: "Blighted",
  potential: "Potential",
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

function parseMoneyInput(
  value: string
): number {
  const cleaned = value.replace(
    /[$,\s]/g,
    ""
  );

  if (!cleaned) {
    return 0;
  }

  const amount = Number(cleaned);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(amount, 0);
}

async function fetchPropertyPage({
  offset,
  signal,
  query,
  minOutstanding,
  abortSignal,
}: PropertyPageOptions): Promise<PropertyPageResponse> {
  const parameters =
    new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

  if (signal !== "all") {
    parameters.set(
      "signal",
      signal
    );
  }

  if (query.trim()) {
    parameters.set(
      "q",
      query.trim()
    );
  }

  if (minOutstanding > 0) {
    parameters.set(
      "minOutstanding",
      String(minOutstanding)
    );
  }

  const response = await fetch(
    `/api/properties?${parameters.toString()}`,
    {
      signal: abortSignal,
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
      "The property API returned invalid property data"
    );
  }

  if (!data.pagination) {
    throw new Error(
      "The property API returned no pagination data"
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
  ] = useState(0);

  const [
    unfilteredTotalProperties,
    setUnfilteredTotalProperties,
  ] = useState(0);

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

  /*
   * Values currently typed into the form.
   */
  const [
    searchInput,
    setSearchInput,
  ] = useState("");

  const [
    minOutstandingInput,
    setMinOutstandingInput,
  ] = useState("");

  /*
   * Values currently applied to the API.
   */
  const [
    appliedQuery,
    setAppliedQuery,
  ] = useState("");

  const [
    appliedMinOutstanding,
    setAppliedMinOutstanding,
  ] = useState(0);

  const [
    serverSignal,
    setServerSignal,
  ] = useState<ServerSignal>("all");

  /*
   * Load the first page whenever an applied
   * server-side filter changes.
   */
  useEffect(() => {
    const controller =
      new AbortController();

    async function loadInitialPage() {
      try {
        setLoading(true);
        setError("");
        setLoadMoreError("");
        setProperties([]);
        setNextOffset(0);
        setHasMoreProperties(false);

        const data =
          await fetchPropertyPage({
            offset: 0,
            signal: serverSignal,
            query: appliedQuery,
            minOutstanding:
              appliedMinOutstanding,
            abortSignal:
              controller.signal,
          });

        setProperties(
          data.properties
        );

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

        setUnfilteredTotalProperties(
          data.pagination
            .unfilteredTotalProperties
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

    loadInitialPage();

    return () => {
      controller.abort();
    };
  }, [
    serverSignal,
    appliedQuery,
    appliedMinOutstanding,
  ]);

  /*
   * Read a bookmarked parcel from the URL.
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
      setSelectedPropertyId(
        parcelId
      );
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
   * Load the complete record for the
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

  const displayedDetail =
    propertyDetail ??
    selectedProperty;

  const displayedSignals =
    displayedDetail
      ? getPropertySignals(
          displayedDetail
        )
      : [];

  const filtersAreApplied =
    serverSignal !== "all" ||
    appliedQuery.length > 0 ||
    appliedMinOutstanding > 0;

  async function loadMoreProperties() {
    if (
      loadingMore ||
      loading ||
      !hasMoreProperties
    ) {
      return;
    }

    try {
      setLoadingMore(true);
      setLoadMoreError("");

      const data =
        await fetchPropertyPage({
          offset: nextOffset,
          signal: serverSignal,
          query: appliedQuery,
          minOutstanding:
            appliedMinOutstanding,
        });

      setProperties((current) => {
        const propertiesById =
          new globalThis.Map<
            string,
            Property
          >();

        for (
          const property of current
        ) {
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

      setUnfilteredTotalProperties(
        data.pagination
          .unfilteredTotalProperties
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

  function applyFilters(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setAppliedQuery(
      searchInput.trim()
    );

    setAppliedMinOutstanding(
      parseMoneyInput(
        minOutstandingInput
      )
    );
  }

  function clearFilters() {
    setSearchInput("");
    setMinOutstandingInput("");
    setAppliedQuery("");
    setAppliedMinOutstanding(0);
    setServerSignal("all");
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

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="flex w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <header className="border-b border-slate-200 p-4">
          <h1 className="text-xl font-bold text-slate-800">
            VacantWatch
          </h1>

          <div className="mt-1 text-sm text-slate-500">
            King County
          </div>

          <div className="mt-2 text-xs text-slate-500">
            {loading ? (
              "Loading properties..."
            ) : (
              <>
                Loaded{" "}
                {numberFormatter.format(
                  properties.length
                )}{" "}
                of{" "}
                {numberFormatter.format(
                  totalProperties
                )}{" "}
                matching parcels
              </>
            )}
          </div>

          {!loading &&
            unfilteredTotalProperties >
              0 && (
              <div className="mt-1 text-xs text-slate-400">
                {numberFormatter.format(
                  unfilteredTotalProperties
                )}{" "}
                total delinquent parcels
              </div>
            )}
        </header>

        <form
          onSubmit={applyFilters}
          className="border-b border-slate-200 p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Filter className="h-4 w-4" />
            County-wide filters
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">
              Search address, property
              name, or parcel ID
            </span>

            <div className="relative mt-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />

              <input
                type="search"
                value={searchInput}
                onChange={(event) =>
                  setSearchInput(
                    event.target.value
                  )
                }
                placeholder="Example: BEACON"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </label>

          <label className="mt-3 block">
            <span className="text-xs font-medium text-slate-600">
              Property category
            </span>

            <select
              value={serverSignal}
              onChange={(event) =>
                setServerSignal(
                  event.target
                    .value as ServerSignal
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">
                All delinquent parcels
              </option>

              <option value="vacant">
                Vacant candidates
              </option>

              <option value="tax-delinquent">
                Tax delinquent
              </option>
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-xs font-medium text-slate-600">
              Minimum outstanding balance
            </span>

            <input
              type="text"
              inputMode="decimal"
              value={
                minOutstandingInput
              }
              onChange={(event) =>
                setMinOutstandingInput(
                  event.target.value
                )
              }
              placeholder="Example: 5000"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading
                ? "Loading..."
                : "Apply Filters"}
            </button>

            <button
              type="button"
              onClick={clearFilters}
              disabled={
                loading ||
                !filtersAreApplied
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Clear
            </button>
          </div>

          {serverSignal ===
            "vacant" && (
            <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              Vacant candidates include
              assessor records marked vacant
              or showing zero building area.
            </div>
          )}
        </form>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 text-sm text-slate-500">
              Searching King County
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
            properties.length === 0 && (
              <div className="p-4 text-sm text-slate-500">
                No properties match these
                filters.
              </div>
            )}

          {!loading &&
            !error &&
            properties.map(
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

                    {property.propertyName && (
                      <div className="mt-2 text-xs font-medium text-slate-600">
                        {
                          property.propertyName
                        }
                      </div>
                    )}

                    {property.presentUse && (
                      <div className="mt-1 text-xs text-slate-500">
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
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {loadingMore
                    ? "Loading more..."
                    : "Load More Properties"}
                </button>
              ) : properties.length >
                0 ? (
                <div className="text-center text-sm text-slate-500">
                  All matching properties
                  have been loaded.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </aside>

      <main className="relative flex-1 overflow-hidden">
        <Map
          properties={properties}
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
                        label="Property name"
                        value={
                          displayedDetail.propertyName
                        }
                      />

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