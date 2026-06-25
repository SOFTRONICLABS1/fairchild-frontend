"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import TopNav from "@/components/flow/top-nav";
import AgencyStepper from "@/components/agency/stepper";
import {
  AGENCY_SESSION_PACKAGES_KEY,
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
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

async function readImageMetrics(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error("Failed to inspect image"));
    image.src = dataUrl;
  });
}

export default function AgencyUploadPage() {
  const [rows, setRows] = useState<AgencyRow[]>([]);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const existing = loadAgencyRows();
    setRows(existing.length > 0 ? existing : [createEmptyAgencyRow()]);
  }, []);

  useEffect(() => {
    if (rows.length === 0) return;
    saveAgencyRows(rows);
  }, [rows]);

  const patchRow = (rowId: string, patch: Partial<AgencyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, createEmptyAgencyRow()]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((row) => row.id !== rowId);
      return next.length > 0 ? next : [createEmptyAgencyRow()];
    });
  };

  const onImageSelected = async (rowId: string, file: File | null) => {
    if (!file) return;
    setBusyRowId(rowId);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const metrics = await readImageMetrics(imageDataUrl);
      patchRow(rowId, {
        imageDataUrl,
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
      <TopNav />
      <AgencyStepper active={1} />
      <div className="page-wrap">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4">
            <Link href="/search" className="btn-secondary">Back</Link>
          </div>
          <div className="mb-6 agency-hero">
            <div>
              <p className="agency-kicker">Agency / Brand Workflow</p>
              <h1 className="agency-title">Upload location creatives</h1>
              <p className="agency-copy">Add one row per location with its image, location name, and landing page URL. These rows become your campaign packages.</p>
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
              return (
                <div key={row.id} className="card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Location {index + 1}</p>
                      <p className="text-xs text-slate-500">{isValid ? "Ready for package generation" : "Add image, location, and landing page URL"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`prod-status-pill ${isValid ? "done" : "waiting"}`}>{isValid ? "Ready" : "Incomplete"}</span>
                      <button type="button" className="btn-secondary" onClick={() => removeRow(row.id)}>Remove</button>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[240px_1fr_1fr]">
                    <div className="agency-upload-box">
                      {row.imageDataUrl ? (
                        <img src={row.imageDataUrl} alt={row.imageName || "Uploaded creative"} className="h-full w-full object-cover" />
                      ) : (
                        <div className="agency-upload-placeholder">
                          <span className="text-sm font-medium text-slate-600">Select image</span>
                          <span className="text-xs text-slate-500">One image per location</span>
                        </div>
                      )}
                      <input
                        ref={(node) => {
                          fileInputRefs.current[row.id] = node;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => void onImageSelected(row.id, event.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        className="btn-primary agency-upload-trigger"
                        onClick={() => fileInputRefs.current[row.id]?.click()}
                        disabled={busyRowId === row.id}
                      >
                        {busyRowId === row.id ? "Processing..." : row.imageDataUrl ? "Replace image" : "Select image"}
                      </button>
                    </div>

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
                Continue to Package
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
