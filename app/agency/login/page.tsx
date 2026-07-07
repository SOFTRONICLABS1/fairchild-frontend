"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import { clearAgencyAuth, loadAgencyAuth, saveAgencyAuth } from "@/lib/agency/auth";
import { loginAgencyUser } from "@/lib/agency/api";
import { getDisplayMessage } from "@/lib/api/errors";

export default function AgencyLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = loadAgencyAuth();
    if (auth?.accessToken) {
      router.replace("/agency/upload");
    }
  }, [router]);

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Enter email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await loginAgencyUser(email.trim(), password);
      saveAgencyAuth(session);
      router.replace("/agency/upload");
    } catch (requestError) {
      clearAgencyAuth();
      setError(getDisplayMessage(requestError) || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopNav />
      <div className="page-wrap flex items-center">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-4">
            <Link href="/search" className="btn-secondary">Back</Link>
          </div>
          <div className="card p-6">
            <p className="agency-kicker">Agency / Brand Workflow</p>
            <h1 className="agency-title mb-2">Sign in to continue</h1>
            <p className="agency-copy mb-5">Login to load your available brands and their locations.</p>
            {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Email</span>
                <input
                  className="field"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Password</span>
                <input
                  className="field"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                />
              </label>
              <button type="button" className="btn-primary w-full" onClick={() => void submit()} disabled={submitting}>
                {submitting ? "Signing in..." : "Login"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
