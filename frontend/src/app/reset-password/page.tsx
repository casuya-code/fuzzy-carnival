"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmPasswordReset, requestPasswordReset } from "@/lib/api";

function ResetPasswordInner() {
  const sp = useSearchParams();
  const initialToken = sp.get("token") || "";
  const [email, setEmail] = useState("");
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setMsg(null); setLoading(true);
    try {
      const res = await requestPasswordReset(email);
      setMsg(res.reset_token ? `Reset token (dev): ${res.reset_token}` : (res.message || "If the account exists, a reset token was created."));
      if (res.reset_token) setToken(res.reset_token);
    } catch (err: any) {
      setError(err?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const submitConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setMsg(null); setLoading(true);
    try {
      await confirmPasswordReset(token, newPassword);
      setMsg("Password reset successful. You can now log in.");
    } catch (err: any) {
      setError(err?.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8 space-y-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Reset password</h1>
        <p className="mt-1 text-sm text-gray-600">Request a reset token, then set a new password.</p>

        <form className="mt-6 space-y-4" onSubmit={submitRequest}>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <button type="submit" disabled={loading} className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Request reset token</button>
        </form>

        <hr className="my-6" />

        <form className="space-y-4" onSubmit={submitConfirm}>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Reset token</span>
            <input type="text" required value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">New password</span>
            <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Set new password</button>
        </form>

        {msg && <p className="mt-4 rounded-md bg-green-50 border border-green-100 p-3 text-sm text-green-700">{msg}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</p>}
        <p className="mt-4 text-sm text-gray-600"><Link href="/login" className="text-blue-600 hover:underline">Back to login</Link></p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-gray-600">Loading...</div>}><ResetPasswordInner /></Suspense>;
}
