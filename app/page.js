"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ✅ Change this ONE variable to switch source:
// - "orders" (table) OR "admin_orders" (view)
// NOTE: Realtime works best on tables. If using a view, keep realtime on "orders".
const ORDERS_SOURCE = "orders";
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

// Date helpers (for filtering)
function toISOStartOfDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toISOString();
}
function toISOStartOfNextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
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

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Date filter (default = today)
  const todayStr = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  // Today button handler
  const setToday = async () => {
  const t = new Date().toISOString().slice(0, 10);
  setFromDate(t);
  setToDate(t);

  // force refresh with the new dates
  // (use a microtask so state updates apply first)
  setTimeout(() => {
    fetchOrders();
  }, 0);
};


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

  // -------- Fetch one order with joins (used for realtime refresh) --------
  async function fetchOneOrder(orderId) {
    const { data, error: e } = await supabase
      .from(ORDERS_SOURCE)
      .select(
        `
        id,
        user_id,
        address_id,
        currency,
        status,
        subtotal,
        shipping,
        total,
        notes,
        created_at,
        addresses:address_id (
          full_name,
          email,
          phone
        ),
        order_items (
          id,
          product_id,
          name,
          price,
          qty
        )
      `
      )
      .eq("id", orderId)
      .single();

    if (e) return null;
    return data;
  }

  // -------- Fetch orders (with joins + date filter) --------
  const fetchOrders = async () => {
    setError("");
    setHint("");
    setFetching(true);

    try {
      let q = supabase
        .from(ORDERS_SOURCE)
        .select(
          `
          id,
          user_id,
          address_id,
          currency,
          status,
          subtotal,
          shipping,
          total,
          notes,
          created_at,
          addresses:address_id (
            full_name,
            email,
            phone
          ),
          order_items (
            id,
            product_id,
            name,
            price,
            qty
          )
        `
        )
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);

      // Date filter (today by default)
      if (fromDate) q = q.gte("created_at", toISOStartOfDay(fromDate));
      if (toDate) q = q.lt("created_at", toISOStartOfNextDay(toDate));

      const { data, error: e } = await q;

      if (e) {
        setError(e.message || "Failed to fetch orders.");
        if (isPermissionDenied(e)) {
          setHint(
            "Permission denied. Add your Auth user UUID into admin_users and create admin SELECT policies for orders/addresses/order_items."
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
        async (payload) => {
          const id = payload?.new?.id;
          if (!id) return;

          const fresh = await fetchOneOrder(id);
          if (!fresh) return;

          setOrders((prev) => {
            const exists = prev.some((o) => o.id === fresh.id);
            if (exists) return prev.map((o) => (o.id === fresh.id ? fresh : o));
            return [fresh, ...prev].slice(0, MAX_ROWS);
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        async (payload) => {
          const id = payload?.new?.id;
          if (!id) return;

          const fresh = await fetchOneOrder(id);
          if (!fresh) return;

          setOrders((prev) => prev.map((o) => (o.id === fresh.id ? fresh : o)));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        (payload) => {
          const oldId = payload?.old?.id;
          if (!oldId) return;
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

  // Re-fetch when date range changes
  useEffect(() => {
    if (!session?.user) return;
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

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
      const searchable = [
        o?.id,
        o?.user_id,
        o?.address_id,
        o?.notes,
        o?.addresses?.full_name,
        o?.addresses?.email,
        o?.addresses?.phone,
      ]
        .map((v) => (v == null ? "" : String(v)))
        .join(" ")
        .toLowerCase();

      const statusOk =
        status === "all" ? true : String(o?.status || "").toLowerCase() === status;

      const searchOk = !q ? true : searchable.includes(q);
      return statusOk && searchOk;
    };

    return orders.filter(match);
  }, [orders, search, statusFilter]);

  const totalCount = orders.length;
  const showingCount = filtered.length;

  const userEmail = session?.user?.email || "";

  // -------- Render --------
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
                If login works but data fetch fails: add your Auth user UUID into admin_users
                and create admin SELECT policies for orders/addresses/order_items.
              </div>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      {/* Top bar */}
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

      {/* Filters */}
      <section className="filters card">
        <div className="filtersRow">
          <div className="field">
            <div className="fieldLabel">Search</div>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="id / name / email / phone / user_id / notes"
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

          <div className="field" style={{ minWidth: 160 }}>
            <div className="fieldLabel">From</div>
            <input
              type="date"
              className="input"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="field" style={{ minWidth: 160 }}>
            <div className="fieldLabel">To</div>
            <input
              type="date"
              className="input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          {/* ✅ Today button */}
          <div className="field" style={{ minWidth: 110 }}>
            <div className="fieldLabel">&nbsp;</div>
            <button type="button" className="btn btnGhost" onClick={setToday}>
              Today
            </button>
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

      {/* Table */}
      <section className="tableCard card">
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Order ID</th>
                <th>Status</th>
                <th>Customer</th>
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
                  ? created.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
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

                    <td>
                      <div className="contact">
                        <div className="contactEmail">{o.addresses?.full_name || "-"}</div>
                      </div>
                    </td>

                    <td className="mono">{shortId(o.user_id)}</td>

                    <td>
                      <div className="contact">
                        <div className="contactEmail">{o.addresses?.email || "-"}</div>
                        <div className="contactPhone mono muted">{o.addresses?.phone || "-"}</div>
                      </div>
                    </td>

                    <td className="right mono">{formatINR(o.total)}</td>

                    <td>
                      <details className="details">
                        <summary className="detailsSummary">View</summary>
                        <pre className="json">
{JSON.stringify(o.order_items ?? [], null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No orders match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="footerNote">
          Source: <span className="mono">{ORDERS_SCHEMA}.{ORDERS_SOURCE}</span> • Latest {MAX_ROWS} rows • Realtime enabled
        </div>
      </section>
    </main>
  );
}
