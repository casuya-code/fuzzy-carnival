"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/components/AuthProvider";

const checking = <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">Checking account...</div>;

/** Keep only same-origin paths; login/signup redirect to the result. */
function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function RequireAuthInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const next = safeNext(`${pathname}${query ? `?${query}` : ""}`);

  if (loading) {
    return checking;
  }
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-10">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="space-y-2 border-b border-gray-100 p-6">
            <h1 className="text-xl font-semibold text-gray-900">Account required</h1>
            <p className="text-sm leading-relaxed text-gray-600">
              Log in to use this feature. You can still browse the home page and help.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 bg-gray-50/60 p-4">
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Log in
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={checking}>
      <RequireAuthInner>{children}</RequireAuthInner>
    </Suspense>
  );
}
