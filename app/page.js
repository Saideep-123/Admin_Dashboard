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
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [orders, setOrders] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [listening, setListening] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState(localDateYYYYMMDD());
  const [toDate, setToDate] = useState(localDateYYYYMMDD());

  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const channelRef = useRef(null);

  /* ---------------- AUTH ---------------- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
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

  /* 🔔 ASK NOTIFICATION PERMISSION */
  useEffect(() => {
    if (!session?.user) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [session?.user?.id]);

  const setToday = () => {
    const t = localDateYYYYMMDD();
    setFromDate(t);
    setToDate(t);
  };

  /* ---------------- FETCH ---------------- */
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
        setHint("Add your Auth user UUID into admin_users table.");
      }
      setOrders([]);
    } else {
      setOrders(data || []);
    }

    setFetching(false);
  };

  useEffect(() => {
    if (!session?.user) return;
    fetchOrders();
  }, [fromDate, toDate, session?.user?.id]);

  /* 🔔 REALTIME (INSERT only notification) */
  useEffect(() => {
    if (!session?.user) return;

    const ch = supabase
      .channel("orders-admin")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        (payload) => {
          if (Notification.permission === "granted") {
            new Notification("🛒 New Order Received", {
              body: `Order ID: ${payload.new.id}`,
            });
          }
          fetchOrders();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        fetchOrders
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        fetchOrders
      )
      .subscribe((s) => setListening(s === "SUBSCRIBED"));

    channelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      setListening(false);
    };
  }, [session?.user?.id]);

  /* ---------------- FILTER ---------------- */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((o) => {
      const statusOk =
        statusFilter === "all" ||
        String(o.status).toLowerCase() === statusFilter;
      const haystack = `${o.id} ${o.notes} ${o.addresses?.full_name} ${o.addresses?.email} ${o.addresses?.phone}`.toLowerCase();
      return statusOk && (!q || haystack.includes(q));
    });
  }, [orders, search, statusFilter]);

  const totalSales = useMemo(
    () => filtered.reduce((sum, o) => sum + Number(o.total || 0), 0),
    [filtered]
  );

  /* ---------------- AUTH ACTIONS ---------------- */
  const signIn = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setOrders([]);
  };

  /* ---------------- UI ---------------- */
  if (authLoading) return <div className="page">Loading…</div>;

  if (!session?.user) {
    return (
      <main className="page loginWrap">
        <form onSubmit={signIn} className="loginCard">
          <h2>Admin Login</h2>
          <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="errorBox">{error}</div>}
          <button className="btn btnPrimary">Sign in</button>
        </form>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>Orders Dashboard</h1>
          <span>{session.user.email}</span> •{" "}
          <span>{listening ? "Listening…" : "Offline"}</span>
        </div>
        <button onClick={signOut}>Sign out</button>
      </header>

      <section className="tableCard">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Order</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Contact</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.created_at).toLocaleString()}</td>
                <td>{shortId(o.id)}</td>
                <td>{o.status}</td>
                <td>{o.addresses?.full_name}</td>
                <td>{o.addresses?.phone}</td>
                <td>{formatINR(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bottomLine">
          <div>Orders: {filtered.length}</div>
          <div>Total: {formatINR(totalSales)}</div>
        </div>
      </section>
    </main>
  );
}
