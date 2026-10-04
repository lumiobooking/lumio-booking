'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch, setUnauthorizedHandler, setSessionTenant } from './api';
import { readSession, clearAllSessions, AUTH_KEY } from './support-session';

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
  /** SUPPORT sessions: how much of the salon this employee may see. */
  supportLevel?: string;
  /**
   * SUPPORT sessions: true when this employee's own ticked list is in force
   * instead of the level's preset. Only the banner reads it — `capabilities` is
   * what actually shapes the menu, and the token is what the API checks.
   */
  supportCustom?: boolean;
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

const STORAGE_KEY = AUTH_KEY;
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Restore the session on first mount: this tab's own salon session (Lumio
  // Support working inside one salon — per tab, see support-session.ts), else
  // the login every tab shares.
  useEffect(() => {
    const parsed = readSession();
    if (parsed) {
      setToken(parsed.accessToken);
      setUser(parsed.user as unknown as AuthUser);
      setSessionTenant(parsed.user.tenantId ?? null);
    }
    setReady(true);
  }, []);

  // When any authenticated request returns 401 (expired session), clear the
  // stored session and bounce to the login page instead of showing a raw
  // "Unauthorized" error.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAllSessions();
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
    setSessionTenant(res.user.tenantId ?? null);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(res));
    localStorage.removeItem('lumio_active_branch'); // a fresh login starts at the home branch
    return res.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
    setSessionTenant(null);
    clearAllSessions();
    localStorage.removeItem('lumio_pos_enabled'); // clear cached plan gating
    localStorage.removeItem('lumio_active_branch');
  }

  return (
    <AuthContext.Provider value={{ token, user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * May the signed-in person do this? Owners (and the platform team, and Lumio
 * support working inside a salon) always may; a staff member may when the
 * owner gave them that permission. The server checks the same rule — this
 * only keeps buttons that would be refused off the screen.
 */
/**
 * Where a signed-in person's work starts. A staff member is placed by what
 * they may open, not by the word "staff": a receptionist works at the counter
 * (/salon/front-desk), a manager on the dashboard, a technician in the
 * technicians' app. Used by the login page, the home page and the tech app,
 * so a receptionist can never end up in the technicians' screens.
 */
export function homeFor(user: { role: string; staffRole?: string | null; capabilities?: string[] } | null | undefined): string {
  if (!user) return '/login';
  if (user.role === 'SUPER_ADMIN') return '/super-admin/tenants';
  if (user.role === 'SUPPORT') return '/agency';
  if (user.role !== 'STAFF') return '/salon';
  const caps = user.capabilities ?? [];
  // A technician stays in the technicians' app even when the owner lets her
  // help at the till — those screens are one tap away from the salon menu.
  if (user.staffRole === 'TECHNICIAN' || !caps.length) return '/staff/today';
  if (caps.includes('dashboard')) return '/salon';
  if (caps.includes('walkins')) return '/salon/front-desk';
  return '/salon';
}

export function useCan(): (cap: string) => boolean {
  const { user } = useAuth();
  return (cap: string) => !!user && (user.role === 'SALON_ADMIN' || user.role === 'SUPER_ADMIN' || (user.capabilities ?? []).includes(cap));
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
