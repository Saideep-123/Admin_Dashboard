"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function OrderDetailsPage() {
  const { id } = useParams();
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    const load = async () => {
      const { data: orderData } = await supabase
        .from("orders")
        .select(`
          *,
          addresses (*)
        `)
        .eq("id", id)
        .single();

      const { data: itemData } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", id);

      setOrder(orderData);
      setItems(itemData || []);
    };

    load();
  }, [id]);

  if (!order) return <div className="page">Loading…</div>;

  return (
    <main className="page">
      <button className="btn" onClick={() => router.back()}>
        ← Back
      </button>

      <h2>Order Details</h2>

      <div className="card">
        <p><b>Order ID:</b> {order.id}</p>
        <p><b>Name:</b> {order.addresses?.full_name}</p>
        <p><b>Phone:</b> {order.addresses?.phone}</p>
        <p><b>Address:</b> {order.addresses?.address_line1}</p>
      </div>

      <table className="table" style={{ marginTop: 20 }}>
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{i.name}</td>
              <td>₹{i.price}</td>
              <td>{i.qty}</td>
              <td>₹{i.price * i.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 20 }}>
        <p><b>Subtotal:</b> ₹{order.subtotal}</p>
        <p><b>Shipping:</b> ₹{order.shipping}</p>
        <p><b>Total:</b> ₹{order.total}</p>
      </div>
    </main>
  );
}
