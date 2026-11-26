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
      <div className="mx-auto max-w-lg py-8">
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h1 className="text-xl font-semibold text-gray-900">Account required</h1>
          <p className="text-sm text-gray-600">Log in to use this feature. You can still browse the home page and help.</p>
          <div className="flex gap-3">
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">Log in</Link>
            <Link href="/signup" className="rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Create account</Link>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
