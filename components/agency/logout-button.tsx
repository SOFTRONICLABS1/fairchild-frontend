"use client";

import { useRouter } from "next/navigation";
import { clearAgencyAuth } from "@/lib/agency/auth";
import { AGENCY_SESSION_PACKAGES_KEY, AGENCY_SESSION_ROWS_KEY } from "@/lib/agency/mock";

export default function AgencyLogoutButton() {
  const router = useRouter();

  const logout = () => {
    if (!window.confirm("Logout from Agency/Brand Workflow?")) {
      return;
    }
    clearAgencyAuth();
    sessionStorage.removeItem(AGENCY_SESSION_ROWS_KEY);
    sessionStorage.removeItem(AGENCY_SESSION_PACKAGES_KEY);
    router.replace("/agency/login");
  };

  return (
    <button type="button" className="btn-secondary" onClick={logout} aria-label="Logout">
      ⎋ Logout
    </button>
  );
}
