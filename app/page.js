"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const MAX_ROWS = 200;

export default function Page() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef(null);

  /* ---------- AUTH ---------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session ?? null);
    });

    supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
  }, []);

  /* ---------- FETCH ORDERS ---------- */
  const fetchOrders = async () => {
    setLoading(true);

    const { data } = await supabase
      .from("orders")
      .select(`
        id, status, total, created_at,
        addresses (
          full_name, phone
        )
      `)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    setOrders(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!session) return;
    fetchOrders();
  }, [session]);

  /* ---------- REALTIME ---------- */
  useEffect(() => {
    if (!session) return;

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const ch = supabase
      .channel("orders-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          if (Notification.permission === "granted") {
            new Notification("🛒 New Order Received", {
              body: `Order ${payload.new.id}`,
            });
          }
          fetchOrders();
        }
      )
      .subscribe();

    channelRef.current = ch;
    return () => supabase.removeChannel(ch);
  }, [session]);

  if (!session) return <div className="page">Login required</div>;

  return (
    <main className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Orders Dashboard</h1>

        <button
          className="btn"
          onClick={fetchOrders}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "🔄 Refresh"}
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Order ID</th>
            <th>Status</th>
            <th>Customer</th>
            <th>Phone</th>
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              className="clickRow"
              onClick={() => router.push(`/orders/${o.id}`)}
            >
              <td>{new Date(o.created_at).toLocaleString()}</td>
              <td>{o.id.slice(0, 8)}…</td>
              <td>{o.status}</td>
              <td>{o.addresses?.full_name}</td>
              <td>{o.addresses?.phone}</td>
              <td>₹{o.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
