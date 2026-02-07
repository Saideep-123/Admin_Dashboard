"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

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

  // WhatsApp link
  const phone = order.addresses?.phone || "";
  const message = encodeURIComponent(
    `Hello ${order.addresses?.full_name}, your order (${order.id}) total is ${money(order.total)}. Thank you for ordering from Konaseema Specials.`
  );
  const whatsappUrl = `https://wa.me/${phone}?text=${message}`;

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

        {/* WhatsApp button */}
        <button
          className="btn"
          style={{ marginTop: 10, background: "#25D366" }}
          onClick={() => window.open(whatsappUrl, "_blank")}
        >
          Contact on WhatsApp
        </button>
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
              <td>{money(i.price)}</td>
              <td>{i.qty}</td>
              <td>{money(i.price * i.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 20 }}>
        <p><b>Subtotal:</b> {money(order.subtotal)}</p>
        <p><b>Shipping:</b> {money(order.shipping)}</p>
        <p><b>Total:</b> {money(order.total)}</p>
      </div>
    </main>
  );
}
