"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearTokens, setTokens } from "@/lib/api";

type User = {
  id: string;
  email: string;
  is_active: boolean;
  trading_paused: boolean;
  phone_number?: string | null;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, phoneNumber?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const hasToken = typeof window !== "undefined" && window.localStorage.getItem("access_token");
    if (!hasToken) {
      setLoading(false);
      return;
    }
    apiFetch("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const tokens = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(tokens.user);
    router.push("/trade");
  };

  const register = async (email: string, password: string, phoneNumber?: string) => {
    const tokens = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, phone_number: phoneNumber || undefined }),
    });
    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(tokens.user);
    router.push("/trade");
  };

  const refreshUser = async () => {
    setUser(await apiFetch("/api/auth/me"));
  };

  const logout = () => {
    clearTokens();
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
