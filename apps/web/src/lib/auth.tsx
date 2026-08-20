'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { scopedKey } from './region';
import { apiFetch, setUnauthorizedHandler } from './api';

export type UserRole = 'SUPER_ADMIN' | 'SALON_ADMIN' | 'STAFF' | 'SUPPORT';

export type StaffRole = 'MANAGER' | 'RECEPTIONIST' | 'TECHNICIAN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  staffRole?: StaffRole | null;
  capabilities?: string[]; // feature permissions (absent on older sessions)
  // Lumio SUPPORT staff working inside one salon on a short-lived session.
  supportSession?: boolean;
  tenantName?: string; // shown in the support banner
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

// Scoped by region at read/write time, not here.
//
// One origin now serves both markets, so a single 'lumio_auth' slot would let a
// Vietnamese sign-in overwrite a US session and start posting the wrong token to
// the wrong server. The US keeps the bare key, so everyone already signed in to
// lumiobooking.com stays signed in when this deploys.
const STORAGE_KEY = 'lumio_auth';
const sessionKey = () => scopedKey(STORAGE_KEY);
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Restore session from localStorage on first mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(sessionKey());
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
        localStorage.removeItem(sessionKey());
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
    localStorage.setItem(sessionKey(), JSON.stringify(res));
    localStorage.removeItem(scopedKey('lumio_active_branch')); // a fresh login starts at the home branch
    return res.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(sessionKey());
    localStorage.removeItem(scopedKey('lumio_pos_enabled')); // clear cached plan gating
    localStorage.removeItem(scopedKey('lumio_active_branch'));
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
