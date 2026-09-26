import { useEffect, useState } from "react";
import {
  animateWindowSize,
  api,
  invokeErrorMessage,
  type AuthState,
} from "@/lib/tauri";

const emptyAuth: AuthState = {
  signed_in: false,
  user_id: null,
  email: null,
  bridge_url: "",
  api_url: "",
  has_phone: false,
  user_name: null,
  avatar_url: null,
};

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(emptyAuth);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    void api.centerWindow().catch(() => undefined);
  }, []);

  // Check auth state immediately on startup
  useEffect(() => {
    let active = true;
    void api
      .getAuthState()
      .then((initial) => {
        if (!active) return;
        setAuth(initial);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (auth.signed_in)
      void animateWindowSize(1290, 800).catch(() => undefined);
    else void animateWindowSize(800, 600).catch(() => undefined);
  }, [auth.signed_in, authLoading]);

  useEffect(() => {
    if (auth.signed_in) return;
    const id = window.setInterval(() => {
      void api.getAuthState().then((next) => {
        if (next.signed_in) {
          setAuth(next);
          setAuthBusy(false);
          setAuthError("");
        }
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [auth.signed_in]);

  // afterSignIn lets a caller (App) chain a post-sign-in load — e.g. tasks —
  // while authBusy stays true, matching the original inline behavior.
  async function googleSignIn(afterSignIn?: () => Promise<void>) {
    setAuthBusy(true);
    setAuthError("");
    try {
      const next = await api.signInWithGoogle();
      setAuth(next);
      if (afterSignIn) await afterSignIn();
    } catch (err) {
      setAuthError(invokeErrorMessage(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      const next = await api.signOut();
      setAuth(next);
    } catch {
      /* ignore */
    }
    setAuthError("");
  }

  async function linkPhone(phoneNumber: string) {
    setAuthBusy(true);
    setAuthError("");
    try {
      const next = await api.linkPhone(phoneNumber);
      setAuth(next);
    } catch (err) {
      setAuthError(invokeErrorMessage(err));
    } finally {
      setAuthBusy(false);
    }
  }

  return { auth, authLoading, authBusy, authError, googleSignIn, signOut, linkPhone };
}
