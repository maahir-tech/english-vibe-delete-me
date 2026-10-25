// App.jsx
// Web page for Google Play's "account & data deletion" requirement.
//
// Flow:  sign in (Google or email + password)
//        -> GET /onboarding/status   (only a literal `true` means the user has data)
//        -> true:  show the single "Delete my data" action  -> DELETE /account
//        -> false: tell the user there is no data to delete
//
// Setup: npm i @supabase/supabase-js, and fill in .env (see .env.example).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/* ---------------- config ---------------- */
// Read from .env (Vite only exposes variables that start with VITE_)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, ""); // no trailing slash
const APP_NAME = import.meta.env.VITE_APP_NAME ?? "English Vibe";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ---------------- API ---------------- */
async function api(path, method = "GET") {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You are signed out. Please sign in again.");

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new Error("No connection. Check your internet and try again.");
  }

  // DELETE /account answers with an empty body, so parsing is best-effort.
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message ?? json?.message ?? "Something went wrong. Please try again.");
  }
  return json;
}

/** Only a literal `true` means the user has data. */
async function hasData() {
  const raw = await api("/onboarding/status");
  return raw?.onboarding_completed === true;
}

const deleteAccount = () => api("/account", "DELETE");

/* ---------------- app ---------------- */
export default function App() {
  // phase: loading | signedOut | checking | hasData | noData | deleted | error
  const [phase, setPhase] = useState("loading");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  // Track the Supabase session.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      if (!data.session) setPhase("signedOut");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      if (!session) setPhase((p) => (p === "deleted" ? p : "signedOut"));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Right after login: check whether this user has data.
  const userId = user?.id ?? null;
  const check = useCallback(async () => {
    setPhase("checking");
    setError("");
    try {
      setPhase((await hasData()) ? "hasData" : "noData");
    } catch (e) {
      setError(e.message);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (userId) check();
  }, [userId, check]);

  /* ---- actions ---- */
  const signInGoogle = async () => {
    setBusy(true);
    setFormError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      setFormError(error.message);
      setBusy(false);
    } // on success the browser redirects to Google
  };

  const signInEmail = async (e) => {
    e.preventDefault();
    if (!/\S+@\S+\.\S+/.test(email.trim())) return setFormError("Please enter a valid email address.");
    if (password.length < 6) return setFormError("Password must be at least 6 characters.");
    setBusy(true);
    setFormError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setFormError(error.message);
    setBusy(false);
  };

  const signOut = async () => {
    setConfirming(false);
    await supabase.auth.signOut();
    setEmail("");
    setPassword("");
  };

  const doDelete = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteAccount();
      await supabase.auth.signOut().catch(() => {}); // account is already gone on the server
      setConfirming(false);
      setPhase("deleted");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const who = useMemo(() => user?.email ?? "", [user]);

  /* ---- views ---- */
  let body;
  if (phase === "loading" || phase === "checking") {
    body = <p style={st.muted}>{phase === "checking" ? "Checking your account…" : "Loading…"}</p>;
  } else if (phase === "signedOut") {
    body = (
      <>
        <p style={st.muted}>
          Sign in to the account you used in {APP_NAME} to delete your data.
        </p>
        <button style={st.google} onClick={signInGoogle} disabled={busy}>
          Continue with Google
        </button>
        <div style={st.or}>or</div>
        <form onSubmit={signInEmail} style={{ display: "grid", gap: 10 }}>
          <input
            style={st.input}
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            style={st.input}
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button style={st.primary} type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </form>
        {formError && <p style={st.error}>{formError}</p>}
      </>
    );
  } else if (phase === "error") {
    body = (
      <>
        <p style={st.error}>{error}</p>
        <button style={st.primary} onClick={check}>Try again</button>
        <button style={st.link} onClick={signOut}>Sign out</button>
      </>
    );
  } else if (phase === "noData") {
    body = (
      <>
        <p style={st.text}>
          We couldn't find any data for <b>{who}</b>, so there is nothing to delete.
        </p>
        <button style={st.link} onClick={signOut}>Sign out</button>
      </>
    );
  } else if (phase === "deleted") {
    body = (
      <p style={st.text}>
        ✅ Your account and all your data have been permanently deleted.
      </p>
    );
  } else if (phase === "hasData") {
    body = (
      <>
        <p style={st.muted}>Signed in as <b>{who}</b></p>
        {!confirming ? (
          <button style={st.danger} onClick={() => setConfirming(true)}>
            Delete my data
          </button>
        ) : (
          <div style={st.warn}>
            <p style={{ margin: "0 0 12px" }}>
              ⚠️ This permanently deletes your account and all your data, including your profile,
              progress, streak, XP and practice history. This can't be undone.
            </p>
            <button style={st.danger} onClick={doDelete} disabled={busy}>
              {busy ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button style={st.link} onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            {error && <p style={st.error}>{error}</p>}
          </div>
        )}
        {!confirming && <button style={st.link} onClick={signOut}>Sign out</button>}
      </>
    );
  }

  return (
    <div style={st.page}>
      <div style={st.card}>
        <h1 style={st.title}>Delete your {APP_NAME} data</h1>
        {body}
      </div>
    </div>
  );
}

/* ---------------- styles ---------------- */
const st = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#E3F3FE",
    padding: 20,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    borderRadius: 20,
    padding: 28,
    boxShadow: "0 6px 18px rgba(27,42,90,0.08)",
    display: "grid",
    gap: 12,
  },
  title: { margin: 0, fontSize: 22, color: "#1B2A5A" },
  text: { margin: 0, color: "#1B2A5A", lineHeight: 1.5 },
  muted: { margin: 0, color: "rgba(27,42,90,0.66)", lineHeight: 1.5 },
  error: { margin: 0, color: "#C74A38", fontSize: 14 },
  input: {
    padding: "13px 14px",
    borderRadius: 12,
    border: "1.5px solid rgba(27,42,90,0.15)",
    background: "#F1F8FE",
    fontSize: 15,
    color: "#1B2A5A",
    outline: "none",
  },
  primary: {
    padding: 14,
    borderRadius: 14,
    border: "none",
    background: "#2F6FE4",
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  google: {
    padding: 14,
    borderRadius: 14,
    border: "1.5px solid rgba(27,42,90,0.15)",
    background: "#fff",
    color: "#1B2A5A",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  danger: {
    padding: 14,
    borderRadius: 14,
    border: "none",
    background: "#C74A38",
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  warn: {
    background: "#FDECE9",
    border: "1.5px solid rgba(199,74,56,0.35)",
    borderRadius: 16,
    padding: 16,
    color: "#1B2A5A",
    fontSize: 14,
    lineHeight: 1.5,
    display: "grid",
    gap: 4,
  },
  link: {
    background: "none",
    border: "none",
    color: "rgba(27,42,90,0.66)",
    fontSize: 14,
    padding: 8,
    cursor: "pointer",
  },
  or: { textAlign: "center", color: "rgba(27,42,90,0.5)", fontSize: 13 },
};