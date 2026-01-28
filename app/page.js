"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const ORDERS_SOURCE = "orders";
const ORDERS_SCHEMA = "public";
const MAX_ROWS = 200;

const STATUS_OPTIONS = ["all", "pending", "paid", "shipped", "cancelled"];

function formatINR(value) {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(num);
}

function shortId(id) {
  if (!id) return "-";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function toISOStartOfDay(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function toISOStartOfNextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export default function Page() {
  /* ---------------- AUTH ---------------- */
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* ---------------- DATA ---------------- */
  const [orders, setOrders] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [listening, setListening] = useState(false);

  /* ---------------- FILTERS ---------------- */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  /* ---------------- ERRORS ---------------- */
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const channelRef = useRef(null);

  /* ---------------- AUTH BOOTSTRAP ---------------- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data?.session ?? null);
      setAuthLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  /* ---------------- FETCH ORDERS ---------------- */
  const fetchOrders = async () => {
    if (!session?.user) return;

    setFetching(true);
    setError("");
    setHint("");

    let query = supabase
      .from(ORDERS_SOURCE)
      .select(`
        id,
        user_id,
        address_id,
        status,
        total,
        notes,
        created_at,
        addresses!orders_address_id_fkey (
          full_name,
          email,
          phone
        ),
        order_items!order_items_order_id_fkey (
          id,
          name,
          price,
          qty
        )
      `)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    if (fromDate) query = query.gte("created_at", toISOStartOfDay(fromDate));
    if (toDate) query = query.lt("created_at", toISOStartOfNextDay(toDate));

    const { data, error } = await query;

    if (error) {
      setError(error.message);
      setHint("Check admin RLS SELECT policies.");
      setOrders([]);
    } else {
      setOrders(data || []);
    }

    setFetching(false);
  };

  /* ---------------- TODAY BUTTON ---------------- */
  const setToday = () => {
    const t = new Date().toISOString().slice(0, 10);
    setFromDate(t);
    setToDate(t);
  };

  /* ---------------- REFRESH ON DATE CHANGE (FIX) ---------------- */
  useEffect(() => {
    if (!session?.user) return;
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, session?.user?.id]);

  /* ---------------- REALTIME ---------------- */
  useEffect(() => {
    if (!session?.user) return;

    const ch = supabase
      .channel("orders-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: ORDERS_SCHEMA, table: ORDERS_SOURCE },
        () => fetchOrders()
      )
      .subscribe((s) => setListening(s === "SUBSCRIBED"));

    channelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      setListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  /* ---------------- FILTERED VIEW ---------------- */
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const statusOk =
        statusFilter === "all" || o.status === statusFilter;
      const text = JSON.stringify(o).toLowerCase();
      return statusOk && text.includes(search.toLowerCase());
    });
  }, [orders, search, statusFilter]);

  /* ---------------- UI ---------------- */
  if (authLoading) return <div style={{ padding: 40 }}>Loading…</div>;

  if (!session?.user) {
    return <div style={{ padding: 40 }}>Login required</div>;
  }

  return (
    <main className="page">
      <h1>Orders Dashboard</h1>

      {/* Filters */}
      <div className="filtersRow">
        <input
          className="input"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="input"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />

        <input
          type="date"
          className="input"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />

        <button className="btn" onClick={setToday}>
          Today
        </button>

        <button className="btn" onClick={fetchOrders} disabled={fetching}>
          Refresh
        </button>
      </div>

      {error && <div className="errorBox">{error}</div>}
      {hint && <div className="hintBox">{hint}</div>}

      {/* Table */}
      <table className="table">
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
              <td>{o.addresses?.full_name || "-"}</td>
              <td>{o.addresses?.phone || "-"}</td>
              <td>{formatINR(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        {listening ? "Listening for updates…" : "Offline"}
      </div>
    </main>
  );
}
