"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function OrderDetails() {
  const { id } = useParams();
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    const load = async () => {
      const { data: o } = await supabase
        .from("orders")
        .select("*, addresses(*)")
        .eq("id", id)
        .single();

      const { data: i } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", id);

      setOrder(o);
      setItems(i || []);
    };
    load();
  }, [id]);

  if (!order) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <button className="btn secondary" onClick={() => router.back()}>
        ← Back
      </button>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Customer</h3>
        <p>{order.addresses?.full_name}</p>
        <p>{order.addresses?.phone}</p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Items</h3>
        {items.map((i) => (
          <p key={i.id}>
            {i.name} × {i.qty} — {money(i.price * i.qty)}
          </p>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <strong>Total: {money(order.total)}</strong>
      </div>
    </main>
  );
}
