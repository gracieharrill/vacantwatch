"use client";

import {
  useEffect,
  useMemo,
  useRef,
} from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type {
  Property,
} from "./property-data";

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type MapProps = {
  properties?: Property[];
  selectedPropertyId?: string | null;
  onSelectProperty?: (
    property: Property
  ) => void;

  boundsSearchEnabled?: boolean;

  initialCenter?: [
    number,
    number,
  ];

  initialZoom?: number;
  viewKey?: string;

  onBoundsChange?: (
    bounds: MapBounds
  ) => void;
};

type LeafletContainer =
  HTMLDivElement & {
    _leaflet_id?: number;
  };

const statusColors: Record<
  Property["status"],
  string
> = {
  parcel: "#64748b",
  vacant: "#dc2626",
  "tax-delinquent":
    "#ea580c",
  blighted: "#ca8a04",
  potential: "#2563eb",
};

const statusLabels: Record<
  Property["status"],
  string
> = {
  parcel: "Parcel",
  vacant: "Vacant",
  "tax-delinquent":
    "Tax Delinquent",
  blighted: "Blighted",
  potential: "Potential",
};

const currencyFormatter =
  new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
    }
  );

function escapeHtml(
  value: unknown
): string {
  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getMapBounds(
  map: L.Map
): MapBounds {
  const bounds =
    map.getBounds();

  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

function createMarkerIcon(
  status:
    Property["status"],
  selected: boolean
): L.DivIcon {
  const color =
    statusColors[status];

  const size =
    selected ? 34 : 28;

  return L.divIcon({
    className: "",

    iconSize: [
      size,
      size,
    ],

    iconAnchor: [
      size / 2,
      size / 2,
    ],

    popupAnchor: [
      0,
      -(size / 2),
    ],

    html: `
      <div
        style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 9999px;
          background: ${color};
          border: ${selected ? 4 : 3}px solid white;
          box-sizing: border-box;
          box-shadow:
            0 2px 8px rgba(0, 0, 0, 0.45)
            ${
              selected
                ? ", 0 0 0 4px rgba(15, 23, 42, 0.30)"
                : ""
            };
          display: flex;
          align-items: center;
          justify-content: center;
        "
      >
        <div
          style="
            width: ${selected ? 9 : 7}px;
            height: ${selected ? 9 : 7}px;
            border-radius: 9999px;
            background: white;
          "
        ></div>
      </div>
    `,
  });
}

function createPopupHtml(
  property: Property
): string {
  const propertySignals =
    property.signals
      ?.length > 0
      ? property.signals
      : [
          property.status,
        ];

  const badges =
    propertySignals
      .map(
        (signal) => {
          const color =
            statusColors[
              signal
            ];

          const label =
            statusLabels[
              signal
            ];

          return `
            <span
              style="
                display: inline-block;
                margin: 2px 4px 2px 0;
                padding: 3px 7px;
                border: 1px solid ${color};
                border-radius: 9999px;
                color: ${color};
                font-size: 11px;
                font-weight: 600;
              "
            >
              ${escapeHtml(
                label
              )}
            </span>
          `;
        }
      )
      .join("");

  const outstanding =
    property
      .outstandingAmount !==
    undefined
      ? `
        <div style="margin-top: 9px;">
          <span style="color: #64748b;">Outstanding:</span>

          <strong style="margin-left: 4px;">
            ${escapeHtml(
              currencyFormatter.format(
                property
                  .outstandingAmount
              )
            )}
          </strong>
        </div>
      `
      : "";

  const assessedValue =
    property
      .totalAssessedValue !==
    undefined
      ? `
        <div style="margin-top: 5px;">
          <span style="color: #64748b;">Assessed value:</span>

          <span style="margin-left: 4px;">
            ${escapeHtml(
              currencyFormatter.format(
                property
                  .totalAssessedValue
              )
            )}
          </span>
        </div>
      `
      : "";

  const presentUse =
    property.presentUse
      ? `
        <div style="margin-top: 6px; color: #475569;">
          ${escapeHtml(
            property.presentUse
          )}
        </div>
      `
      : "";

  return `
    <div
      style="
        min-width: 210px;
        max-width: 280px;
        font-family: Arial, sans-serif;
        font-size: 13px;
        line-height: 1.4;
      "
    >
      <div
        style="
          color: #0f172a;
          font-size: 14px;
          font-weight: 700;
        "
      >
        ${escapeHtml(
          property.address
        )}
      </div>

      <div style="margin-top: 6px;">
        ${badges}
      </div>

      ${presentUse}
      ${outstanding}
      ${assessedValue}

      <div
        style="
          margin-top: 9px;
          color: #94a3b8;
          font-size: 11px;
        "
      >
        Parcel ID:
        ${escapeHtml(
          property.id
        )}
      </div>
    </div>
  `;
}

export default function Map({
  properties = [],
  selectedPropertyId = null,
  onSelectProperty,
  boundsSearchEnabled = false,
  initialCenter = [
    47.6062,
    -122.3321,
  ],
  initialZoom = 10,
  viewKey = "default",
  onBoundsChange,
}: MapProps) {
  const initialLatitude =
    initialCenter[0];

  const initialLongitude =
    initialCenter[1];

  const safeProperties =
    useMemo(
      () =>
        Array.isArray(
          properties
        )
          ? properties
          : [],
      [
        properties,
      ]
    );

  const containerRef =
    useRef<
      HTMLDivElement | null
    >(null);

  const mapRef =
    useRef<
      L.Map | null
    >(null);

  const markerLayerRef =
    useRef<
      L.LayerGroup | null
    >(null);

  const onSelectPropertyRef =
    useRef(
      onSelectProperty
    );

  const onBoundsChangeRef =
    useRef(
      onBoundsChange
    );

  const boundsSearchEnabledRef =
    useRef(
      boundsSearchEnabled
    );

  useEffect(() => {
    onSelectPropertyRef
      .current =
        onSelectProperty;
  }, [
    onSelectProperty,
  ]);

  useEffect(() => {
    onBoundsChangeRef
      .current =
        onBoundsChange;
  }, [
    onBoundsChange,
  ]);

  useEffect(() => {
    boundsSearchEnabledRef
      .current =
        boundsSearchEnabled;
  }, [
    boundsSearchEnabled,
  ]);

  useEffect(() => {
    const container =
      containerRef.current as
        | LeafletContainer
        | null;

    if (
      !container ||
      mapRef.current
    ) {
      return;
    }

    container
      .replaceChildren();

    if (
      container
        ._leaflet_id !==
      undefined
    ) {
      delete container
        ._leaflet_id;
    }

    const map =
      L.map(
        container,
        {
          center: [
            initialLatitude,
            initialLongitude,
          ],

          zoom:
            initialZoom,

          scrollWheelZoom:
            true,

          zoomControl:
            true,
        }
      );

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',

        maxZoom: 19,
      }
    ).addTo(map);

    const markerLayer =
      L.layerGroup()
        .addTo(map);

    function reportBounds() {
      if (
        !boundsSearchEnabledRef
          .current
      ) {
        return;
      }

      onBoundsChangeRef
        .current?.(
          getMapBounds(
            map
          )
        );
    }

    map.on(
      "moveend",
      reportBounds
    );

    mapRef.current =
      map;

    markerLayerRef.current =
      markerLayer;

    const animationFrame =
      window
        .requestAnimationFrame(
          () => {
            map.invalidateSize();
            reportBounds();
          }
        );

    return () => {
      window
        .cancelAnimationFrame(
          animationFrame
        );

      map.off(
        "moveend",
        reportBounds
      );

      markerLayer
        .clearLayers();

      map.off();
      map.remove();

      markerLayerRef.current =
        null;

      mapRef.current =
        null;

      container
        .replaceChildren();

      if (
        container
          ._leaflet_id !==
        undefined
      ) {
        delete container
          ._leaflet_id;
      }
    };
  }, [
    initialLatitude,
    initialLongitude,
    initialZoom,
  ]);

  useEffect(() => {
    const map =
      mapRef.current;

    if (
      !map ||
      !boundsSearchEnabled
    ) {
      return;
    }

    map.setView(
      [
        initialLatitude,
        initialLongitude,
      ],
      initialZoom,
      {
        animate: false,
      }
    );

    const animationFrame =
      window
        .requestAnimationFrame(
          () => {
            map.invalidateSize();

            onBoundsChangeRef
              .current?.(
                getMapBounds(
                  map
                )
              );
          }
        );

    return () => {
      window
        .cancelAnimationFrame(
          animationFrame
        );
    };
  }, [
    boundsSearchEnabled,
    initialLatitude,
    initialLongitude,
    initialZoom,
    viewKey,
  ]);

  useEffect(() => {
    const map =
      mapRef.current;

    const markerLayer =
      markerLayerRef.current;

    if (
      !map ||
      !markerLayer
    ) {
      return;
    }

    markerLayer
      .clearLayers();

    map.closePopup();

    const validProperties =
      safeProperties.filter(
        (property) =>
          Number.isFinite(
            property.lat
          ) &&
          Number.isFinite(
            property.lng
          )
      );

    if (
      validProperties
        .length === 0
    ) {
      return;
    }

    const bounds =
      L.latLngBounds(
        []
      );

    let selectedMarker:
      | L.Marker
      | null = null;

    let selectedProperty:
      | Property
      | null = null;

    for (
      const property of
      validProperties
    ) {
      const selected =
        property.id ===
        selectedPropertyId;

      const marker =
        L.marker(
          [
            property.lat,
            property.lng,
          ],
          {
            icon:
              createMarkerIcon(
                property.status,
                selected
              ),

            zIndexOffset:
              selected
                ? 1000
                : 0,
          }
        );

      marker.bindPopup(
        createPopupHtml(
          property
        ),
        {
          maxWidth: 300,
          closeButton:
            true,
        }
      );

      marker.on(
        "click",
        () => {
          onSelectPropertyRef
            .current?.(
              property
            );
        }
      );

      marker.addTo(
        markerLayer
      );

      bounds.extend([
        property.lat,
        property.lng,
      ]);

      if (selected) {
        selectedMarker =
          marker;

        selectedProperty =
          property;
      }
    }

    map.invalidateSize();

    let popupTimer:
      | ReturnType<
          typeof setTimeout
        >
      | undefined;

    if (
      selectedProperty
    ) {
      const target =
        L.latLng(
          selectedProperty.lat,
          selectedProperty.lng
        );

      const shouldMove =
        map
          .getCenter()
          .distanceTo(
            target
          ) > 5 ||
        map.getZoom() <
          17;

      if (shouldMove) {
        map.flyTo(
          target,
          17,
          {
            duration: 0.8,
          }
        );
      }

      popupTimer =
        setTimeout(
          () => {
            selectedMarker
              ?.openPopup();
          },
          shouldMove
            ? 450
            : 0
        );
    } else if (
      !boundsSearchEnabled &&
      validProperties
        .length === 1
    ) {
      map.setView(
        [
          validProperties[
            0
          ].lat,

          validProperties[
            0
          ].lng,
        ],

        15
      );
    } else if (
      !boundsSearchEnabled &&
      bounds.isValid()
    ) {
      map.fitBounds(
        bounds,
        {
          padding: [
            50,
            50,
          ],

          maxZoom: 15,
        }
      );
    }

    return () => {
      if (
        popupTimer
      ) {
        clearTimeout(
          popupTimer
        );
      }
    };
  }, [
    safeProperties,
    selectedPropertyId,
    boundsSearchEnabled,
  ]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      aria-label="Property map"
    />
  );
}
