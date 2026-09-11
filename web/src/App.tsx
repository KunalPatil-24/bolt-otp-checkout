import { useEffect, useState } from 'react';
import { api, type User } from './lib/api';
import { CheckoutPage } from './pages/CheckoutPage';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Ask the server who we are, once, on load.
   *
   * The session lives in an httpOnly cookie that JavaScript cannot read by
   * design, so this request is the only way the app can find out. A refresh
   * wipes React's state while the cookie survives, which is exactly the case
   * this handles.
   */
  useEffect(() => {
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null)) // unreachable API: carry on as a guest
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">
          Bolt<span className="brand-dot">.</span>
        </span>
      </header>

      <main className="app-main">
        {loading ? (
          <div className="card card-loading">Loading…</div>
        ) : (
          <CheckoutPage user={user} onUserChange={setUser} />
        )}
      </main>
    </div>
  );
}
