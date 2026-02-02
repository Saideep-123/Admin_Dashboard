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
  const [pushEnabled, setPushEnabled] = useState(false);

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

  /* ---------- REALTIME (DATA ONLY) ---------- */
  useEffect(() => {
    if (!session) return;

    const ch = supabase
      .channel("orders-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    channelRef.current = ch;
    return () => supabase.removeChannel(ch);
  }, [session]);

  /* ---------- PUSH SUBSCRIPTION (MOBILE) ---------- */
  const enablePushNotifications = async () => {
    if (!("serviceWorker" in navigator)) {
      alert("Service workers not supported");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      alert("Notification permission denied");
      return;
    }

    const reg = await navigator.serviceWorker.ready;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    });

    const json = sub.toJSON();

    await supabase.from("push_subscriptions").insert({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });

    setPushEnabled(true);
    alert("✅ Notifications enabled on this device");
  };

  if (!session) {
  return (
    <main className="page" style={{ textAlign: "center", marginTop: 80 }}>
      <h2>Admin Login</h2>
      <p>Please log in to view orders</p>

      <button
        className="btn"
        onClick={() => supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin }
        })}
      >
        Login with Google
      </button>
    </main>
  );
}


  return (
    <main className="page">
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1>Orders Dashboard</h1>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={fetchOrders} disabled={loading}>
            {loading ? "Refreshing..." : "🔄 Refresh"}
          </button>

          <button
            className="btn"
            onClick={enablePushNotifications}
            disabled={pushEnabled}
          >
            {pushEnabled ? "🔔 Enabled" : "🔔 Enable Notifications"}
          </button>
        </div>
      </div>

      {/* Orders Table */}
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
