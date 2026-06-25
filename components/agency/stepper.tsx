"use client";

import Link from "next/link";

const STEPS = [
  { href: "/agency/upload", label: "Upload" },
  { href: "/agency/package", label: "Package" },
  { href: "/agency/publish", label: "Publish" }
];

export default function AgencyStepper({ active }: { active: number }) {
  return (
    <div className="stepper-bar">
      <div className="stepper max-w-3xl">
        {STEPS.map((step, index) => {
          const stepNo = index + 1;
          const stateClass = stepNo < active ? "done" : stepNo === active ? "active" : "";
          const canNavigate = stepNo <= active;

          if (!canNavigate) {
            return (
              <div key={step.href} className={`step-item ${stateClass} pointer-events-none opacity-60`} aria-disabled="true">
                <div className="step-circle">{stepNo}</div>
                <span className="step-label">{step.label}</span>
              </div>
            );
          }

          return (
            <Link key={step.href} className={`step-item ${stateClass}`} href={step.href}>
              <div className="step-circle">{stepNo < active ? "✓" : stepNo}</div>
              <span className="step-label">{step.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
