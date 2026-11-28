"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthUser,
  changePassword as apiChangePassword,
  clearTokenIfAuthError,
  getUserToken,
  login as apiLogin,
  logoutAll as apiLogoutAll,
  me,
  setUserToken,
  signup as apiSignup,
  updateProfile as apiUpdateProfile,
} from "@/lib/api";

const USER_CACHE_KEY = "yakodonyo_auth_user";

function readCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && typeof parsed.email === "string" ? (parsed as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_CACHE_KEY);
  } catch {}
}

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
  logoutAll: () => Promise<void>;
  updateProfile: (payload: { name?: string | null; phone?: string | null; avatar?: string | null }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The first render must be identical on the server and during hydration, so
  // start signed-out and let the mount effect below apply the cached user.
  // Reading localStorage in a useState initializer made the sidebar render
  // "Checking..." on the server and the signed-in controls on the client.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getUserToken();
    if (!token) return;
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = getUserToken();
    if (!token) {
      writeCachedUser(null);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await me();
      writeCachedUser(u);
      setUser(u);
    } catch (error) {
      // Network errors and 5xx must not discard a still-valid session.
      if (clearTokenIfAuthError(error)) {
        writeCachedUser(null);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const res = await apiLogin(email, password);
        setUserToken(res.access_token);
        writeCachedUser(res.user);
        setUser(res.user);
      },
      signup: async (email, password) => {
        const res = await apiSignup(email, password);
        setUserToken(res.access_token);
        writeCachedUser(res.user);
        setUser(res.user);
      },
      logout: () => {
        setUserToken(null);
        writeCachedUser(null);
        setUser(null);
      },
      logoutAll: async () => {
        try {
          await apiLogoutAll();
          setUserToken(null);
          writeCachedUser(null);
          setUser(null);
        } catch (error) {
          // A server failure keeps the local session; an already-invalid one
          // is cleared through the same central auth-failure path as refresh.
          if (clearTokenIfAuthError(error)) {
            writeCachedUser(null);
            setUser(null);
            return;
          }
          throw error;
        }
      },
      updateProfile: async (payload) => {
        const updated = await apiUpdateProfile(payload);
        writeCachedUser(updated);
        setUser(updated);
      },
      changePassword: async (currentPassword, newPassword) => {
        const res = await apiChangePassword(currentPassword, newPassword);
        setUserToken(res.access_token);
        writeCachedUser(res.user);
        setUser(res.user);
      },
      refresh,
    }),
    [user, loading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
