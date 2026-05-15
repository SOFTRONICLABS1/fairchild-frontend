"use client";

import Link from "next/link";

type Step = {
  href: string;
  label: string;
};

const FLOW_STEPS: Step[] = [
  { href: "/search", label: "Search" },
  { href: "/results", label: "Select Products" },
  { href: "/review", label: "Review" },
  { href: "/template", label: "Select Template" },
  { href: "/package", label: "Post package" },
  { href: "/pipeline", label: "Start Pipeline" }
];

export default function FlowStepper({ active }: { active: number }) {
  const markResultsRestore = (href: string) => {
    if (href === "/results" && active > 2) {
      sessionStorage.setItem("pipeline:allow-results-restore", "1");
    }
  };

  return (
    <div className="stepper-bar">
      <div className="stepper">
        {FLOW_STEPS.map((step, index) => {
          const stepNo = index + 1;
          const stateClass = stepNo < active ? "done" : stepNo === active ? "active" : "";
          const canNavigate = stepNo <= active;

          if (!canNavigate) {
            return (
              <div
                key={step.href}
                className={`step-item ${stateClass} pointer-events-none opacity-60`}
                aria-disabled="true"
              >
                <div className="step-circle">{stepNo}</div>
                <span className="step-label">{step.label}</span>
              </div>
            );
          }

          return (
            <Link key={step.href} className={`step-item ${stateClass}`} href={step.href} onClick={() => markResultsRestore(step.href)}>
              <div className="step-circle">{stepNo < active ? "✓" : stepNo}</div>
              <span className="step-label">{step.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
