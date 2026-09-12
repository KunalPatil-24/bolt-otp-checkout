import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type Order, type User } from '../lib/api';

type OrdersPageProps = { user: User | null };

/**
 * A signed-in user's past orders.
 *
 * Exists mainly because the data model already supported it: orders carry a
 * user_id precisely so they can be attributed, and this is that decision
 * becoming visible. Guest orders deliberately do not appear -- they have no
 * user_id, so they belong to nobody, which is the honest consequence of
 * allowing checkout without an account.
 */
export function OrdersPage({ user }: OrdersPageProps) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return; // nothing to fetch; the signed-out view renders instead

    let cancelled = false;
    api
      .myOrders()
      .then((result) => {
        if (!cancelled) setOrders(result.orders);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load your orders.');
      });

    // The component can unmount while this is in flight -- signing out, or
    // navigating away -- and setting state afterwards would be a leak.
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="card">
        <h1 className="card-title">Your orders</h1>
        <p className="card-subtitle">
          Sign in to see your order history. Go to <Link to="/">checkout</Link> and enter
          your email — we'll recognise it.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h1 className="card-title">Your orders</h1>
      <p className="card-subtitle">
        Orders placed while signed in as {user.firstName} {user.lastName}.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!orders && !error && <p className="muted">Loading…</p>}

      {orders && orders.length === 0 && (
        <p className="muted">
          No orders yet. Orders placed as a guest aren't linked to an account, so they
          won't appear here.
        </p>
      )}

      {orders && orders.length > 0 && (
        <ul className="order-list">
          {orders.map((order) => (
            <li key={order.id} className="order">
              <div className="order-head">
                <time dateTime={order.createdAt}>
                  {new Date(order.createdAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
                <code className="order-ref">{order.id.slice(0, 8)}</code>
              </div>
              <address className="order-address">
                {order.addressLine1}
                {order.addressLine2 ? `, ${order.addressLine2}` : ''}
                <br />
                {order.city}, {order.state} {order.postalCode}
                <br />
                {order.country}
              </address>
              <p className="order-contact muted">
                {order.email} · {order.phone}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
