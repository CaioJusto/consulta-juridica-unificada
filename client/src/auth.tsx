import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthContextValue = {
  authenticated: boolean;
  username: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAuthStatus() {
  const response = await fetch("/api/auth/status");
  if (!response.ok) {
    return { authenticated: false, username: null };
  }
  const data = await response.json();
  return {
    authenticated: Boolean(data.authenticated),
    username: (data.username as string | undefined) || null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchAuthStatus();
      setAuthenticated(status.authenticated);
      setUsername(status.username);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (usernameInput: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: usernameInput,
        password,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "Falha no login.");
    }

    const payload = await response.json();
    setAuthenticated(true);
    setUsername((payload.username as string | undefined) || usernameInput);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    setAuthenticated(false);
    setUsername(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated,
      username,
      loading,
      login,
      logout,
      refresh,
    }),
    [authenticated, username, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa ser usado dentro de AuthProvider.");
  }
  return context;
}
