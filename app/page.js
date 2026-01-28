"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ✅ Change this ONE variable to switch source:
// - "orders" (table) OR "admin_orders" (view)
const ORDERS_SOURCE = "orders"; // or "admin_orders"
const ORDERS_SCHEMA = "public";
const MAX_ROWS = 200;

const STATUS_OPTIONS = ["all", "pending", "paid", "shipped", "cancelled"];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatINR(value) {
  const num = Number(value ?? 0);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `₹${num.toFixed(2)}`;
  }
}

function shortId(id) {
  if (!id) return "-";
  const s = String(id);
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function getStatusStyles(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "pill pill-green";
  if (s === "shipped") return "pill pill-blue";
  if (s === "cancelled") return "pill pill-red";
  return "pill pill-yellow"; // pending/default
}

function isPermissionDenied(err) {
  return (
    err &&
    (err.code === "42501" ||
      /permission denied/i.test(err.message || "") ||
      /insufficient privilege/i.test(err.message || ""))
  );
}

export default function Page() {
  // Auth
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Data
  const [orders, setOrders] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [listening, setListening] = useState(false);

  // UI state
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Errors
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const channelRef = useRef(null);

  // -------- Auth bootstrap (auto-login on refresh) --------
  useEffect(() => {
    let mounted = true;

    (async () => {
      setAuthLoading(true);
      const { data, error: e } = await supabase.auth.getSession();
      if (!mounted) return;

      if (e) setError(e.message);
      setSession(data?.session ?? null);
      setAuthLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // -------- Fetch orders --------
  const fetchOrders = async () => {
    setError("");
    setHint("");
    setFetching(true);

    try {
      const { data, error: e } = await supabase
        .from(ORDERS_SOURCE)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);

      if (e) {
        setError(e.message || "Failed to fetch orders.");
        if (isPermissionDenied(e)) {
          setHint(
            "Permission denied. Make sure your user is in admin_users and RLS policies exist (see README)."
          );
        }
        setOrders([]);
      } else {
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setError(e?.message || "Failed to fetch orders.");
      setOrders([]);
    } finally {
      setFetching(false);
    }
  };

  // -------- Realtime subscription --------
  const teardownRealtime = async () => {
    setListening(false);
    const ch = channelRef.current;
    channelRef.current = null;
    if (ch) {
      try {
        await supabase.removeChannel(ch);
      } catch {}
    }
  };

  const setupRealtime = async () => {
    await teardownRealtime();

    const ch = supabase
      .channel(`orders-admin-${ORDERS_SCHEMA}-${ORDERS_SOURCE}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        (payload) => {
          const newRow = payload.new;
          if (!newRow) return;

          setOrders((prev) => {
            const exists = prev.some((o) => o.id === newRow.id);
            if (exists) {
              return prev.map((o) => (o.id === newRow.id ? newRow : o));
            }
            return [newRow, ...prev].slice(0, MAX_ROWS);
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        (payload) => {
          const updated = payload.new;
          if (!updated) return;
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        (payload) => {
          const oldRow = payload.old;
          const oldId = oldRow?.id;
          if (oldId == null) return;
          setOrders((prev) => prev.filter((o) => o.id !== oldId));
        }
      );

    channelRef.current = ch;

    ch.subscribe((status) => {
      setListening(status === "SUBSCRIBED");
    });
  };

  // When session becomes available: fetch + subscribe.
  useEffect(() => {
    if (!session?.user) return;

    fetchOrders();
    setupRealtime();

    return () => {
      teardownRealtime();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // -------- Login / Logout --------
  const signIn = async (e) => {
    e.preventDefault();
    setError("");
    setHint("");

    const cleanEmail = String(email || "").trim();
    if (!cleanEmail || !password) {
      setError("Enter email and password.");
      return;
    }

    const { data, error: e2 } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (e2) {
      setError(e2.message);
      return;
    }

    setSession(data?.session ?? null);
    setPassword("");
  };

  const signOut = async () => {
    setError("");
    setHint("");
    await teardownRealtime();
    setOrders([]);
    await supabase.auth.signOut();
    setSession(null);
  };

  // -------- Filter + search --------
  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const status = String(statusFilter || "all").toLowerCase();

    const match = (o) => {
      const fields = [o?.id, o?.user_id, o?.email, o?.phone, o?.notes]
        .map((v) => (v == null ? "" : String(v)))
        .join(" ")
        .toLowerCase();

      const statusOk =
        status === "all" ? true : String(o?.status || "").toLowerCase() === status;
      const searchOk = !q ? true : fields.includes(q);

      return statusOk && searchOk;
    };

    return orders.filter(match);
  }, [orders, search, statusFilter]);

  const totalCount = orders.length;
  const showingCount = filtered.length;

  const userEmail = session?.user?.email || "";

  if (authLoading) {
    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 520, margin: "64px auto" }}>
          <div className="skeletonTitle" />
          <div className="skeletonLine" />
          <div className="skeletonLine" />
        </div>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="page">
        <div className="loginWrap">
          <div className="brand">
            <div className="brandDot" />
            <div>
              <div className="brandTitle">Orders Dashboard</div>
              <div className="brandSub">Admin login</div>
            </div>
          </div>

          <div className="card" style={{ maxWidth: 520 }}>
            <form onSubmit={signIn} className="form">
              <label className="label">
                Email
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@yourdomain.com"
                  autoComplete="email"
                />
              </label>

              <label className="label">
                Password
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </label>

              {error ? <div className="errorBox">{error}</div> : null}

              <button className="btn btnPrimary" type="submit">
                Sign in
              </button>

              <div className="helpText">
                Uses Supabase Auth email/password. If login works but data fetch fails,
                apply the RLS SQL in README.
              </div>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="topbarLeft">
          <div className="title">Orders Dashboard</div>
          <div className="subtitle">
            <span className="muted">{userEmail}</span>
            <span className="dotSep">•</span>
            <span className={cx("live", listening ? "liveOn" : "liveOff")}>
              {listening ? "Listening for updates…" : "Not listening"}
            </span>
          </div>
        </div>

        <div className="topbarRight">
          <button className="btn" onClick={fetchOrders} disabled={fetching}>
            {fetching ? "Refreshing…" : "Refresh"}
          </button>
          <button className="btn btnGhost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <section className="filters card">
        <div className="filtersRow">
          <div className="field">
            <div className="fieldLabel">Search</div>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="id / email / phone / user_id / notes"
            />
          </div>

          <div className="field" style={{ minWidth: 200 }}>
            <div className="fieldLabel">Status</div>
            <select
              className="input select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All statuses" : s}
                </option>
              ))}
            </select>
          </div>

          <div className="countBadgeWrap">
            <span className="countBadge">
              Showing <b>{showingCount}</b> / <b>{totalCount}</b>
            </span>
          </div>
        </div>

        {(error || hint) && (
          <div className="msgRow">
            {error ? (
              <div className="errorBox" style={{ margin: 0 }}>
                {error}
              </div>
            ) : null}
            {hint ? <div className="hintBox">{hint}</div> : null}
          </div>
        )}
      </section>

      <section className="tableCard card">
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Order ID</th>
                <th>Status</th>
                <th>User</th>
                <th>Contact</th>
                <th className="right">Total</th>
                <th>Items</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((o) => {
                const created = o?.created_at ? new Date(o.created_at) : null;
                const createdText = created
                  ? created.toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "-";

                return (
                  <tr key={o.id}>
                    <td className="mono muted">{createdText}</td>
                    <td className="mono">{String(o.id)}</td>
                    <td>
                      <span className={getStatusStyles(o.status)}>
                        {String(o.status || "pending")}
                      </span>
                    </td>
                    <td className="mono">{shortId(o.user_id)}</td>
                    <td>
                      <div className="contact">
                        <div className="contactEmail">{o.email || "-"}</div>
                        <div className="contactPhone mono muted">{o.phone || "-"}</div>
                      </div>
                    </td>
                    <td className="right mono">{formatINR(o.total)}</td>
                    <td>
                      <details className="details">
                        <summary className="detailsSummary">View</summary>
                        <pre className="json">
{JSON.stringify(o.items ?? o.order_items ?? o.cart_items ?? {}, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No orders match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="footerNote">
          Source: <span className="mono">{ORDERS_SCHEMA}.{ORDERS_SOURCE}</span> •
          Latest {MAX_ROWS} rows • Realtime enabled
        </div>
      </section>
    </main>
  );
}
