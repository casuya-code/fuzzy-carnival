"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthUser,
  changePassword as apiChangePassword,
  getUserToken,
  login as apiLogin,
  logoutAll as apiLogoutAll,
  me,
  setUserToken,
  signup as apiSignup,
  updateProfile as apiUpdateProfile,
} from "@/lib/api";

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const token = getUserToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await me();
      setUser(u);
    } catch {
      setUserToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const res = await apiLogin(email, password);
        setUserToken(res.access_token);
        setUser(res.user);
      },
      signup: async (email, password) => {
        const res = await apiSignup(email, password);
        setUserToken(res.access_token);
        setUser(res.user);
      },
      logout: () => {
        setUserToken(null);
        setUser(null);
      },
      logoutAll: async () => {
        try {
          await apiLogoutAll();
        } finally {
          setUserToken(null);
          setUser(null);
        }
      },
      updateProfile: async (payload) => {
        const updated = await apiUpdateProfile(payload);
        setUser(updated);
      },
      changePassword: async (currentPassword, newPassword) => {
        const res = await apiChangePassword(currentPassword, newPassword);
        setUserToken(res.access_token);
        setUser(res.user);
      },
      refresh,
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
