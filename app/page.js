"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const ORDERS_SOURCE = "orders";
const ORDERS_SCHEMA = "public";
const MAX_ROWS = 200;

const STATUS_OPTIONS = ["all", "pending", "paid", "shipped", "cancelled"];

/* ------------------ Helpers ------------------ */
function localDateYYYYMMDD(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function toISOStartOfDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
function toISOStartOfNextDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}

function formatINR(v) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Number(v ?? 0));
}

function shortId(id) {
  if (!id) return "-";
  const s = String(id);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function statusClass(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "paid") return "pill pillGreen";
  if (s === "shipped") return "pill pillBlue";
  if (s === "cancelled") return "pill pillRed";
  return "pill pillYellow";
}

function isPermissionDenied(err) {
  const msg = String(err?.message || "");
  return (
    err?.code === "42501" ||
    /permission denied/i.test(msg) ||
    /insufficient privilege/i.test(msg)
  );
}

/* ------------------ Page ------------------ */
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState(localDateYYYYMMDD());
  const [toDate, setToDate] = useState(localDateYYYYMMDD());

  // Errors
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const channelRef = useRef(null);

  // Auth bootstrap (auto-login on refresh)
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

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // Today button
  const setToday = () => {
    const t = localDateYYYYMMDD();
    setFromDate(t);
    setToDate(t);
  };

  // Fetch orders
  const fetchOrders = async () => {
    if (!session?.user) return;

    setFetching(true);
    setError("");
    setHint("");

    let q = supabase
      .from(ORDERS_SOURCE)
      .select(
        `
        id,
        status,
        total,
        notes,
        created_at,
        addresses!orders_address_id_fkey (
          full_name,
          email,
          phone
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    if (fromDate) q = q.gte("created_at", toISOStartOfDay(fromDate));
    if (toDate) q = q.lt("created_at", toISOStartOfNextDay(toDate));

    const { data, error: e } = await q;

    if (e) {
      setError(e.message || "Failed to fetch orders.");
      if (isPermissionDenied(e)) {
        setHint(
          "Permission denied: add your Auth user UUID into admin_users and create admin SELECT policies for orders/addresses."
        );
      }
      setOrders([]);
    } else {
      setOrders(Array.isArray(data) ? data : []);
    }

    setFetching(false);
  };

  // Refetch on date change (so Today works)
  useEffect(() => {
    if (!session?.user) return;
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, session?.user?.id]);

  // Realtime
  useEffect(() => {
    if (!session?.user) return;

    const ch = supabase
      .channel("orders-admin")
      .on("postgres_changes", { event: "*", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE }, () => {
        fetchOrders();
      })
      .subscribe((s) => setListening(s === "SUBSCRIBED"));

    channelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      setListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Client-side filters
  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const st = String(statusFilter || "all").toLowerCase();

    return orders.filter((o) => {
      const statusOk = st === "all" ? true : String(o.status || "").toLowerCase() === st;
      const haystack = [
        o?.id,
        o?.notes,
        o?.addresses?.full_name,
        o?.addresses?.email,
        o?.addresses?.phone,
      ]
        .map((v) => (v == null ? "" : String(v)))
        .join(" ")
        .toLowerCase();

      const searchOk = !q ? true : haystack.includes(q);
      return statusOk && searchOk;
    });
  }, [orders, search, statusFilter]);

  const totalSales = useMemo(
    () => filtered.reduce((sum, o) => sum + Number(o?.total ?? 0), 0),
    [filtered]
  );

  // Login
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

  // Logout
  const signOut = async () => {
    setError("");
    setHint("");
    setOrders([]);
    try {
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
    } catch {}
    channelRef.current = null;
    await supabase.auth.signOut();
    setSession(null);
  };

  // UI
  if (authLoading) {
    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 520, margin: "64px auto", padding: 18 }}>
          Loading…
        </div>
      </main>
    );
  }

  // ✅ LOGIN SCREEN (shows email + password fields)
  if (!session?.user) {
    return (
      <main className="page">
        <div className="loginWrap">
          <div className="loginHero">
            <div className="loginHeroInner">
              <div className="brandRow">
                <div className="brandDot" />
                <div>
                  <div className="brandTitle">Orders Dashboard</div>
                  <div className="brandSub">Admin login</div>
                </div>
              </div>
              <div className="loginHint">
                Login with the email/password created in Supabase Auth.
                <br />
                Then add your Auth user UUID into <span className="mono">admin_users</span>.
              </div>
            </div>
          </div>

          <div className="card loginCard">
            <form onSubmit={signIn} className="form">
              <label className="label">
                Email
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
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
              {hint ? <div className="hintBox">{hint}</div> : null}

              <button className="btn btnPrimary" type="submit">
                Sign in
              </button>

              <div className="helpText">
                If you can login but see no orders: add admin SELECT policies and insert your UUID in admin_users.
              </div>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const userEmail = session?.user?.email || "";

  return (
    <main className="page">
      <header className="topbar">
        <div className="topbarLeft">
          <div className="title">Orders Dashboard</div>
          <div className="subtitle">
            <span className="muted">{userEmail}</span>
            <span className="dotSep">•</span>
            <span className={listening ? "live liveOn" : "live liveOff"}>
              {listening ? "Listening…" : "Offline"}
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
          <div className="field grow">
            <div className="fieldLabel">Search</div>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="id / name / email / phone / notes"
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

          <div className="field" style={{ minWidth: 110 }}>
            <div className="fieldLabel">&nbsp;</div>
            <button type="button" className="btn btnGhost" onClick={setToday}>
              Today
            </button>
          </div>
        </div>

        {(error || hint) && (
          <div className="msgRow">
            {error ? <div className="errorBox" style={{ margin: 0 }}>{error}</div> : null}
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
                <th>Order</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Contact</th>
                <th className="right">Total</th>
                <th>Notes</th>
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
                    <td className="mono">{shortId(o.id)}</td>
                    <td>
                      <span className={statusClass(o.status)}>{o.status || "pending"}</span>
                    </td>
                    <td>{o.addresses?.full_name || "-"}</td>
                    <td className="mono muted">{o.addresses?.phone || "-"}</td>
                    <td className="right mono">{formatINR(o.total)}</td>
                    <td className="muted">{o.notes || "-"}</td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">No orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom line: only orders count + total */}
        <div className="bottomLine">
          <div className="bottomItem">
            Orders: <b>{filtered.length}</b>
          </div>
          <div className="bottomItem mono">
            Total: <b>{formatINR(totalSales)}</b>
          </div>
        </div>
      </section>
    </main>
  );
}
