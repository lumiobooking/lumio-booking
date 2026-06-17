'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch, setUnauthorizedHandler } from './api';

export type UserRole = 'SUPER_ADMIN' | 'SALON_ADMIN' | 'STAFF';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  ready: boolean; // true once we've read persisted state
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const STORAGE_KEY = 'lumio_auth';
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Restore session from localStorage on first mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LoginResponse;
        setToken(parsed.accessToken);
        setUser(parsed.user);
      }
    } catch {
      // ignore corrupted storage
    }
    setReady(true);
  }, []);

  // When any authenticated request returns 401 (expired session), clear the
  // stored session and bounce to the login page instead of showing a raw
  // "Unauthorized" error.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(email: string, password: string): Promise<AuthUser> {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(res.accessToken);
    setUser(res.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(res));
    return res.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('lumio_pos_enabled'); // clear cached plan gating
  }

  return (
    <AuthContext.Provider value={{ token, user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
