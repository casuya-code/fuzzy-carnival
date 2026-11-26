"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import RequireAuth from "@/components/RequireAuth";

const MAX_IMAGE_BYTES = 5_000_000;
const AVATAR_MAX_BYTES = 300_000;

/** Re-encode a square canvas as a JPEG data URL within the backend cap. */
function toAvatarDataUrl(canvas: HTMLCanvasElement): string | null {
  for (const quality of [0.82, 0.7, 0.6, 0.5]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const encoded = dataUrl.split(",", 2)[1] || "";
    const bytes = Math.floor((encoded.length * 3) / 4);
    if (bytes <= AVATAR_MAX_BYTES) return dataUrl;
  }
  return null;
}

function ProfileForm() {
  const { user, updateProfile, changePassword } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarFileName, setAvatarFileName] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setPhone(user.phone || "");
      setAvatar(user.avatar || "");
      setAvatarFileName("");
    }
  }, [user]);

  if (!user) return null;

  const initial = (user.email || "?").trim().charAt(0).toUpperCase() || "?";
  const avatarStyle = avatar
    ? { backgroundImage: `url("${avatar}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

  const onAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileError(null);
    setProfileMsg(null);
    if (!file.type.startsWith("image/")) {
      setProfileError("Choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setProfileError("Image must be smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
        const resized = toAvatarDataUrl(canvas);
        if (!resized) {
          setProfileError("Profile image is too large even after resizing.");
          return;
        }
        setAvatar(resized);
        setAvatarFileName(file.name);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      await updateProfile({ name, phone, avatar });
      setAvatarFileName("");
      setProfileMsg("Profile saved.");
    } catch (err: any) {
      setProfileError(err?.message || "Could not save profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg("Password changed. Other sessions were signed out.");
    } catch (err: any) {
      setPasswordError(err?.message || "Could not change password.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Account settings</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Your profile</h1>
          <p className="mt-1 text-sm text-gray-600">Manage your account details and password.</p>
        </div>
        <Link
          href="/"
          className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
        >
          ← Back to home
        </Link>
      </header>

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <form onSubmit={saveProfile} className="h-fit space-y-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-lg" aria-hidden="true">👤</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Account details</h2>
              <p className="text-xs text-gray-500">How your account appears in Yakodonyo.</p>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-5 text-center">
            <div
              className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-blue-600 text-2xl font-bold text-white shadow-md ring-4 ring-white"
              style={avatarStyle}
              aria-label="Profile picture"
            >
              {!avatar && initial}
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-800">Profile picture</p>
            <p className="truncate text-xs text-gray-500" title={avatarFileName}>{avatarFileName || "No file chosen"}</p>
            <input id="avatar-upload" type="file" accept="image/*" onChange={onAvatarChange} className="sr-only" />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <label
                htmlFor="avatar-upload"
                className="cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Choose photo
              </label>
              {avatar && (
                <button
                  type="button"
                  onClick={() => { setAvatar(""); setAvatarFileName(""); }}
                  className="rounded-lg border bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Remove photo
                </button>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-gray-400">JPG, PNG or other image up to 5 MB · resized to 256×256 · max 300 KB</p>
          </div>

          <div className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Email</span>
              <input
                value={user.email}
                readOnly
                className="mt-1 w-full cursor-default rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-600"
              />
              <span className="mt-1 block text-xs text-gray-400">Your email cannot be changed here.</span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Name <span className="font-normal text-gray-400">(optional)</span></span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Your name"
                className="mt-1 w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Phone number <span className="font-normal text-gray-400">(optional)</span></span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={32}
                placeholder="+255 700 000 000"
                className="mt-1 w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>

          {profileError && <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{profileError}</p>}
          {profileMsg && <p className="rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-700">{profileMsg}</p>}
          <button
            type="submit"
            disabled={savingProfile}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
          >
            {savingProfile ? "Saving..." : "Save profile"}
          </button>
        </form>

        <div className="space-y-5">
          <form onSubmit={savePassword} className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-lg" aria-hidden="true">🔒</span>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
                <p className="text-xs text-gray-500">Keep your account secure.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="font-medium text-gray-700">Current password</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="Enter current password"
                  className="mt-1 w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">New password</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                  placeholder="At least 8 characters"
                  className="mt-1 w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Confirm new password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                  placeholder="Repeat new password"
                  className="mt-1 w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            {passwordError && <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{passwordError}</p>}
            {passwordMsg && <p className="rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-700">{passwordMsg}</p>}
            <button
              type="submit"
              disabled={savingPassword}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {savingPassword ? "Changing..." : "Change password"}
            </button>
          </form>

          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-sm font-semibold text-blue-900">Security tip</p>
            <p className="mt-1 text-sm leading-relaxed text-blue-800/80">
              Use a password you don&apos;t use elsewhere. Changing it signs out your other devices.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileForm />
    </RequireAuth>
  );
}
