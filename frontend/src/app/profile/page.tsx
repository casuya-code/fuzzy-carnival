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
    <div className="mx-auto max-w-2xl space-y-5 py-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Your profile</h1>
        <p className="mt-1 text-sm text-gray-600">Manage your account details and password.</p>
      </header>

      <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Account details</h2>
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xl font-bold text-white shadow-sm"
            style={avatarStyle}
            aria-label="Profile picture"
          >
            {!avatar && initial}
          </div>
          <div className="space-y-2">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Profile picture</span>
              <input type="file" accept="image/*" onChange={onAvatarChange} className="mt-1 block text-xs text-gray-600" />
            </label>
            {avatar && (
              <button type="button" onClick={() => setAvatar("")} className="text-xs text-blue-600 hover:underline">
                Remove photo
              </button>
            )}
          </div>
        </div>

        <label className="block text-sm">
          <span className="font-medium text-gray-700">Email</span>
          <input value={user.email} readOnly className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-600" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Your name"
            className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-blue-400"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Phone number (optional)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={32}
            placeholder="+255 700 000 000"
            className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-blue-400"
          />
        </label>

        {profileError && <p className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{profileError}</p>}
        {profileMsg && <p className="rounded-md border border-green-100 bg-green-50 p-3 text-sm text-green-700">{profileMsg}</p>}
        <button
          type="submit"
          disabled={savingProfile}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {savingProfile ? "Saving..." : "Save profile"}
        </button>
      </form>

      <form onSubmit={savePassword} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Current password</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-blue-400"
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
            className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-blue-400"
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
            className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-blue-400"
          />
        </label>
        {passwordError && <p className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{passwordError}</p>}
        {passwordMsg && <p className="rounded-md border border-green-100 bg-green-50 p-3 text-sm text-green-700">{passwordMsg}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingPassword}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingPassword ? "Changing..." : "Change password"}
          </button>
          <Link href="/" className="text-sm text-gray-600 hover:underline">Back to home</Link>
        </div>
      </form>
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
