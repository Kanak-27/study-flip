import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Public, admin-editable switches (signups paused, generation paused,
  // announcement). Fetched once; a stale value only affects copy, the server
  // enforces the real rule on every request.
  const [config, setConfig] = useState({ signupsEnabled: true, generationEnabled: true, announcement: '' });

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    // Restore the session on page load. A 401 just means "not signed in".
    refresh().finally(() => setLoading(false));
    api('/api/config')
      .then((data) => setConfig((prev) => ({ ...prev, ...data })))
      .catch(() => {});
  }, [refresh]);

  // Returns { twoFactorRequired: true } instead of signing in when the account
  // has 2FA on; the caller then collects a code and calls verifyTwoFactor.
  const login = async (email, password) => {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    if (data.user) setUser(data.user);
    return data;
  };

  const verifyTwoFactor = async (code) => {
    const data = await api('/api/auth/login/2fa', { method: 'POST', body: { code } });
    setUser(data.user);
    return data.user;
  };

  // Step one of signup: does not create an account, just emails a code and
  // returns { email, devCode? } so the page can move to the code step.
  const startRegistration = ({ name, email, password }) =>
    api('/api/auth/register', { method: 'POST', body: { name, email, password } });

  // Step two: the account is created and this browser is signed in.
  const completeRegistration = async ({ email, otp }) => {
    const data = await api('/api/auth/register/verify', { method: 'POST', body: { email, otp } });
    setUser(data.user);
    return data.user;
  };

  const forgotPassword = (email) =>
    api('/api/auth/password/forgot', { method: 'POST', body: { email } });

  const resetPassword = ({ email, otp, password }) =>
    api('/api/auth/password/reset', { method: 'POST', body: { email, otp, password } });

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  // Merge a user object returned by profile endpoints (avatar, 2FA, name…)
  // without a second /me round-trip.
  const updateUser = (next) => setUser((prev) => ({ ...prev, ...next }));

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        config,
        refresh,
        login,
        verifyTwoFactor,
        startRegistration,
        completeRegistration,
        forgotPassword,
        resetPassword,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
