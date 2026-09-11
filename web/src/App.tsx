import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { api, type User } from './lib/api';
import { CheckoutPage } from './pages/CheckoutPage';
import { RegisterPage } from './pages/RegisterPage';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  /**
   * Ask the server who we are, once, on load.
   *
   * The session lives in an httpOnly cookie that JavaScript cannot read by
   * design, so this request is the only way to find out. A refresh wipes
   * React's state while the cookie survives, which is exactly this case.
   *
   * Session state lives here rather than in CheckoutPage so it survives
   * navigating between pages -- moving to /register and back must not silently
   * sign the user out.
   */
  useEffect(() => {
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null)) // unreachable API: carry on as a guest
      .finally(() => setLoading(false));
  }, []);

  const navClass = (path: string) =>
    location.pathname === path ? 'nav-link nav-link-active' : 'nav-link';

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Bolt<span className="brand-dot">.</span>
        </Link>
        <nav className="app-nav">
          <Link to="/" className={navClass('/')}>
            Checkout
          </Link>
          <Link to="/register" className={navClass('/register')}>
            Register
          </Link>
        </nav>
      </header>

      <main className="app-main">
        {loading ? (
          <div className="card card-loading">Loading…</div>
        ) : (
          <Routes>
            <Route path="/" element={<CheckoutPage user={user} onUserChange={setUser} />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<div className="card">Page not found.</div>} />
          </Routes>
        )}
      </main>
    </div>
  );
}
