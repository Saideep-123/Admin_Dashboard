"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const MAX_ROWS = 200;

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Page() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [orders, setOrders] = useState([]);
  const [date, setDate] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setSession(data?.session ?? null)
    );
  }, []);

  const fetchOrders = async (filterDate = "") => {
    let q = supabase
      .from("orders")
      .select(`id, total, status, created_at, addresses(full_name, phone)`)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    if (filterDate) {
      q = q
        .gte("created_at", `${filterDate}T00:00:00`)
        .lte("created_at", `${filterDate}T23:59:59`);
    }

    const { data } = await q;
    setOrders(data || []);
  };

  useEffect(() => {
    if (session) fetchOrders();
  }, [session]);

  if (!session) {
    return (
      <main className="page">
        <h2>Admin Login</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await supabase.auth.signInWithPassword({
              email: e.target.email.value,
              password: e.target.password.value,
            });
          }}
        >
          <input name="email" placeholder="Email" required />
          <input
            name="password"
            type="password"
            placeholder="Password"
            required
          />
          <button>Login</button>
        </form>
      </main>
    );
  }

  const totalSales = orders.reduce((s, o) => s + Number(o.total || 0), 0);

  return (
    <main className="page">
      <h1>Orders Dashboard</h1>

      {/* Summary */}
      <div style={{ marginBottom: 16 }}>
        <strong>Total Orders:</strong> {orders.length} &nbsp;|&nbsp;
        <strong>Total Sales:</strong> {money(totalSales)}
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          onClick={() => {
            const t = todayISO();
            setDate(t);
            fetchOrders(t);
          }}
        >
          Today
        </button>
        <button onClick={() => fetchOrders(date)}>Apply</button>
        <button onClick={() => fetchOrders()}>Reset</button>
      </div>

      {/* Desktop table */}
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              onClick={() => router.push(`/orders/${o.id}`)}
              style={{ cursor: "pointer" }}
            >
              <td>{new Date(o.created_at).toLocaleDateString()}</td>
              <td>{o.id.slice(0, 8)}</td>
              <td>{o.addresses?.full_name}</td>
              <td>{money(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="mobile-list">
        {orders.map((o) => (
          <div
            key={o.id}
            className="card order-card"
            onClick={() => router.push(`/orders/${o.id}`)}
          >
            <strong>{o.addresses?.full_name}</strong>
            <div>{money(o.total)}</div>
            <small>{new Date(o.created_at).toLocaleDateString()}</small>
          </div>
        ))}
      </div>
    </main>
  );
}
