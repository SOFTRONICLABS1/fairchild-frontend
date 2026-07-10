"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import AgencyStepper from "@/components/agency/stepper";
import AgencyLogoutButton from "@/components/agency/logout-button";
import { fetchAgencyBrands, fetchAgencyLocations, type AgencyBrand, type AgencyLocation } from "@/lib/agency/api";
import { clearAgencyAuth, loadAgencyAuth, loadSelectedBrandId, saveSelectedBrandId } from "@/lib/agency/auth";
import { getDisplayMessage } from "@/lib/api/errors";
import {
  AGENCY_SESSION_PACKAGES_KEY,
  AgencyAssetType,
  AgencyRow,
  createEmptyAgencyRow,
  loadAgencyRows,
  rowIsValid,
  saveAgencyRows
} from "@/lib/agency/mock";

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function fileToPreviewUrl(file: File, assetType: AgencyAssetType): Promise<string> {
  if (assetType === "video") {
    return URL.createObjectURL(file);
  }
  return fileToDataUrl(file);
}

async function readMediaMetrics(
  dataUrl: string,
  assetType: AgencyAssetType
): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  if (assetType === "video") {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve({
          width: video.videoWidth,
          height: video.videoHeight,
          durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : undefined
        });
      video.onerror = () => reject(new Error("Failed to inspect video"));
      video.src = dataUrl;
    });
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error("Failed to inspect image"));
    image.src = dataUrl;
  });
}

export default function AgencyUploadPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AgencyRow[]>([]);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [previewRow, setPreviewRow] = useState<AgencyRow | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [brandOptions, setBrandOptions] = useState<AgencyBrand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [locationOptions, setLocationOptions] = useState<AgencyLocation[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [helperOpen, setHelperOpen] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const lastBrandIdRef = useRef<string | null>(null);

  useEffect(() => {
    const auth = loadAgencyAuth();
    if (!auth?.accessToken) {
      router.replace("/agency/login");
      return;
    }
    setAuthReady(true);
    const existing = loadAgencyRows();
    setRows(existing.length > 0 ? existing : [createEmptyAgencyRow()]);
    setSelectedBrandId(loadSelectedBrandId());
  }, [router]);

  useEffect(() => {
    if (!authReady) return;
    const loadBrands = async () => {
      const auth = loadAgencyAuth();
      if (!auth?.accessToken) {
        router.replace("/agency/login");
        return;
      }
      setBrandsLoading(true);
      setApiError(null);
      try {
        const items = await fetchAgencyBrands(auth.accessToken);
        setBrandOptions(items);
      } catch (requestError) {
        clearAgencyAuth();
        setApiError(getDisplayMessage(requestError) || "Failed to load brands");
        router.replace("/agency/login");
      } finally {
        setBrandsLoading(false);
      }
    };
    void loadBrands();
  }, [authReady, router]);

  useEffect(() => {
    if (!authReady) return;
    if (!selectedBrandId) {
      saveSelectedBrandId("");
      setLocationOptions([]);
      return;
    }
    const loadLocations = async () => {
      const auth = loadAgencyAuth();
      if (!auth?.accessToken) {
        router.replace("/agency/login");
        return;
      }
      setLocationsLoading(true);
      setApiError(null);
      try {
        const items = await fetchAgencyLocations(auth.accessToken, selectedBrandId);
        setLocationOptions(items);
        saveSelectedBrandId(selectedBrandId);
      } catch (requestError) {
        clearAgencyAuth();
        setApiError(getDisplayMessage(requestError) || "Failed to load locations");
        router.replace("/agency/login");
      } finally {
        setLocationsLoading(false);
      }
    };
    void loadLocations();
  }, [authReady, router, selectedBrandId]);

  useEffect(() => {
    if (rows.length === 0) return;
    saveAgencyRows(rows);
  }, [rows]);

  useEffect(() => {
    if (lastBrandIdRef.current === null) {
      lastBrandIdRef.current = selectedBrandId;
      return;
    }

    if (lastBrandIdRef.current === selectedBrandId) {
      return;
    }

    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        brandId: selectedBrandId || undefined,
        locationId: undefined,
        location: "",
        landingPageUrl: ""
      }))
    );
    sessionStorage.removeItem(AGENCY_SESSION_PACKAGES_KEY);
    lastBrandIdRef.current = selectedBrandId;
  }, [selectedBrandId]);

  const patchRow = (rowId: string, patch: Partial<AgencyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { ...createEmptyAgencyRow(), brandId: selectedBrandId || undefined }]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((row) => row.id !== rowId);
      return next.length > 0 ? next : [createEmptyAgencyRow()];
    });
  };

  const applyLocationSelection = (rowId: string, locationId: string) => {
    const selected = locationOptions.find((item) => item.id === locationId);
    if (!selected) {
      patchRow(rowId, {
        brandId: selectedBrandId || undefined,
        locationId: undefined,
        location: "",
        landingPageUrl: ""
      });
      return;
    }
    patchRow(rowId, {
      brandId: selectedBrandId || undefined,
      locationId: selected.id,
      location: selected.name,
      landingPageUrl: selected.url ?? ""
    });
  };

  const onAssetSelected = async (rowId: string, file: File | null) => {
    if (!file) return;
    setBusyRowId(rowId);
    try {
      const assetType: AgencyAssetType = file.type.startsWith("video/") ? "video" : "image";
      const assetDataUrl = await fileToPreviewUrl(file, assetType);
      const metrics = await readMediaMetrics(assetDataUrl, assetType);
      patchRow(rowId, {
        assetType,
        assetDataUrl,
        assetName: file.name,
        assetDurationSeconds: metrics.durationSeconds,
        imageDataUrl: assetDataUrl,
        imageName: file.name,
        imageWidth: metrics.width,
        imageHeight: metrics.height
      });
    } finally {
      setBusyRowId(null);
    }
  };

  const validRows = rows.filter(rowIsValid);

  const continueToPackage = () => {
    saveAgencyRows(rows);
    sessionStorage.removeItem(AGENCY_SESSION_PACKAGES_KEY);
  };

  return (
    <>
      <TopNav right={<AgencyLogoutButton />} />
      <AgencyStepper active={1} />
      <div className="page-wrap">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4">
            <Link href="/search" className="btn-secondary">Back</Link>
          </div>
          <div className="card mb-4 p-4">
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Brand</span>
                <select
                  className="field"
                  value={selectedBrandId}
                  onChange={(event) => setSelectedBrandId(event.target.value)}
                  disabled={brandsLoading}
                >
                  <option value="">Select a brand</option>
                  {brandOptions.map((brand) => (
                    <option key={brand.id} value={brand.id}>{brand.name}</option>
                  ))}
                </select>
              </label>
              <div className="text-sm text-slate-500 md:self-center">
                {brandsLoading ? "Loading brands..." : locationsLoading ? "Loading locations..." : "Select a Brand"}
              </div>
            </div>
            {apiError ? <p className="mt-3 text-sm text-amber-700">{apiError}</p> : null}
          </div>
          <div className="mb-6 agency-hero">
            <div>
              <p className="agency-kicker">Agency / Brand Workflow</p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="agency-title">Upload location creatives</h1>
                <button
                  type="button"
                  onClick={() => setHelperOpen((prev) => !prev)}
                  className="-mt-2 grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-[#185FA5] shadow-sm transition hover:border-[#185FA5]/30 hover:bg-[#F3F8FE]"
                  aria-label="Location entry help"
                >
                  ℹ
                </button>
              </div>
              <p className="agency-copy">Add one row per location with its image, location name, and landing page URL. These rows become your campaign packages.</p>
              {helperOpen ? (
                <div className="mt-3 max-w-2xl rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                  Choose a location directly from your Loclshop AEO brand list, or enter the location name and landing page manually if needed.
                </div>
              ) : null}
            </div>
            <div className="agency-hero-stats">
              <div className="stat">
                <p className="text-xs text-slate-500">Rows</p>
                <p className="text-lg font-semibold">{rows.length}</p>
              </div>
              <div className="stat">
                <p className="text-xs text-slate-500">Ready</p>
                <p className="text-lg font-semibold">{validRows.length}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {rows.map((row, index) => {
              const isValid = rowIsValid(row);
              const selectedLocationIds = new Set(
                rows
                  .filter((item) => item.id !== row.id)
                  .map((item) => item.locationId)
                  .filter((item): item is string => Boolean(item))
              );
              const visibleLocations = locationOptions.filter(
                (location) => location.id === row.locationId || !selectedLocationIds.has(location.id)
              );
              return (
                <div key={row.id} className="card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Location {index + 1}</p>
                      <p className="text-xs text-slate-500">{isValid ? "Ready for package generation" : "Add image or video, location, and landing page URL"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`prod-status-pill ${isValid ? "done" : "waiting"}`}>{isValid ? "Ready" : "Incomplete"}</span>
                      <button type="button" className="btn-secondary" onClick={() => removeRow(row.id)}>Remove</button>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[240px_1fr_1fr_1fr]">
                    <div className="agency-upload-box">
                      {row.assetDataUrl || row.imageDataUrl ? (
                        row.assetType === "video" ? (
                          <div className="h-full w-full bg-slate-100">
                            <video
                              src={row.assetDataUrl || row.imageDataUrl}
                              className="h-full w-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                            />
                          </div>
                        ) : (
                          <img src={row.assetDataUrl || row.imageDataUrl} alt={row.assetName || row.imageName || "Uploaded creative"} className="h-full w-full object-cover" />
                        )
                      ) : (
                        <div className="agency-upload-placeholder">
                          <span className="text-sm font-medium text-slate-600">Select an image or video</span>
                          <span className="text-xs text-slate-500">One image or video per location</span>
                        </div>
                      )}
                      <input
                        ref={(node) => {
                          fileInputRefs.current[row.id] = node;
                        }}
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(event) => void onAssetSelected(row.id, event.target.files?.[0] ?? null)}
                      />
                      <div className="absolute bottom-3 left-3 right-3 flex gap-2">
                        <button
                          type="button"
                          className="btn-primary flex-1"
                          onClick={() => fileInputRefs.current[row.id]?.click()}
                          disabled={busyRowId === row.id}
                        >
                          {busyRowId === row.id ? "Processing..." : row.assetDataUrl || row.imageDataUrl ? "Replace" : "Select an image or video"}
                        </button>
                        {row.assetDataUrl || row.imageDataUrl ? (
                          <button
                            type="button"
                            className="btn-secondary flex-1"
                            onClick={() => setPreviewRow(row)}
                          >
                            Preview
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Location from Brand</span>
                      <select
                        className="field"
                        value={row.locationId ?? ""}
                        onChange={(event) => applyLocationSelection(row.id, event.target.value)}
                        disabled={!selectedBrandId || locationsLoading || locationOptions.length === 0}
                      >
                        <option value="">Select location</option>
                        {visibleLocations.map((location) => (
                          <option key={location.id} value={location.id}>{location.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Location</span>
                      <input
                        className="field"
                        placeholder="e.g. Urban Air - Dallas"
                        value={row.location}
                        onChange={(event) => patchRow(row.id, { location: event.target.value })}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Landing page URL</span>
                      <input
                        className="field"
                        placeholder="https://brand.com/location/dallas"
                        value={row.landingPageUrl}
                        onChange={(event) => patchRow(row.id, { landingPageUrl: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button type="button" className="btn-secondary" onClick={addRow}>+ Add location</button>
            <div className="flex items-center gap-2">
              <Link href="/search" className="btn-secondary">Back to Search</Link>
              <Link
                href={validRows.length > 0 ? "/agency/package" : "#"}
                className={`btn-primary ${validRows.length === 0 ? "pointer-events-none opacity-50" : ""}`}
                onClick={continueToPackage}
              >
                Continue to Campaign Package
              </Link>
            </div>
          </div>
        </div>
      </div>
      {previewRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4" onClick={() => setPreviewRow(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{previewRow.location || "Creative preview"}</p>
                <p className="text-xs text-slate-500">{previewRow.assetName || previewRow.imageName || "Uploaded asset"}</p>
              </div>
              <button type="button" className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setPreviewRow(null)}>
                Close
              </button>
            </div>
            {previewRow.assetType === "video" ? (
              <video
                src={previewRow.assetDataUrl || previewRow.imageDataUrl}
                className="max-h-[70vh] w-full rounded-xl bg-black"
                controls
                autoPlay
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={previewRow.assetDataUrl || previewRow.imageDataUrl}
                alt={previewRow.assetName || previewRow.imageName || "Uploaded creative"}
                className="max-h-[70vh] w-full rounded-xl object-contain bg-slate-50"
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
