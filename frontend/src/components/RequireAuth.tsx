"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">Checking account...</div>;
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
              href={`/login?next=${encodeURIComponent(pathname)}`}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Log in
            </Link>
            <Link
              href="/signup"
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
