"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const MAX_ROWS = 200;

/* ---------- HELPER ---------- */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Page() {
  const router = useRouter();

  const [session, setSession] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  /* ---------- AUTH ---------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  /* ---------- FETCH ORDERS ---------- */
  const fetchOrders = async () => {
    setLoading(true);

    const { data } = await supabase
      .from("orders")
      .select(
        `
        id, status, total, created_at,
        addresses (
          full_name, phone
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    setOrders(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (session) fetchOrders();
  }, [session]);

  /* ---------- PUSH ---------- */
  const enablePushNotifications = async () => {
    try {
      if (!("serviceWorker" in navigator)) {
        alert("Service workers not supported");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("Notification permission denied");
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        alert("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      if (!navigator.serviceWorker.controller) {
        alert("Please close the app and reopen it, then try again.");
        return;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        await new Promise((r) => setTimeout(r, 500));
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = sub.toJSON();

      const { error } = await supabase.from("push_subscriptions").upsert(
  {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  },
  { onConflict: "endpoint" }
);


      if (error) {
        alert(error.message);
        return;
      }

      setPushEnabled(true);
      alert("✅ Notifications enabled on this device");
    } catch (e) {
      alert("Enable notifications failed");
    }
  };

  /* ---------- LOGIN ---------- */
  if (!session) {
    return (
      <main
        className="page"
        style={{ maxWidth: 360, margin: "80px auto", textAlign: "center" }}
      >
        <h2>Admin Login</h2>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const email = e.target.email.value;
            const password = e.target.password.value;

            const { error } = await supabase.auth.signInWithPassword({
              email,
              password,
            });

            if (error) alert(error.message);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <input name="email" type="email" placeholder="Email" required />
          <input
            name="password"
            type="password"
            placeholder="Password"
            required
          />
          <button className="btn" type="submit">
            Login
          </button>
        </form>
      </main>
    );
  }

  /* ---------- DASHBOARD ---------- */
  return (
    <main className="page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1>Orders Dashboard v2</h1>


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

          <button className="btn" onClick={() => supabase.auth.signOut()}>
            Logout
          </button>
        </div>
      </div>

      {/* 🔍 STEP 5: VAPID VISIBILITY CHECK */}
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
        VAPID key present:{" "}
        {process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? "YES" : "NO"}
      </div>

      <table className="table" style={{ marginTop: 12 }}>
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
