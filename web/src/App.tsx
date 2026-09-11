import { useEffect, useState } from 'react';
import { api, type User } from './lib/api';

/**
 * Temporary connectivity check. Replaced by the real screens next -- it exists
 * to prove the browser can reach the API across origins and that the session
 * cookie survives the trip.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    api
      .me()
      .then((result) => {
        setUser(result.user);
        setStatus('ok');
        setDetail(result.user ? `signed in as ${result.user.email}` : 'nobody signed in');
      })
      .catch((error: unknown) => {
        setStatus('failed');
        setDetail(error instanceof Error ? error.message : String(error));
      });
  }, []);

  return (
    <main>
      <h1>Bolt</h1>
      <p>
        API connection: <strong>{status}</strong>
      </p>
      <p>{detail}</p>
      {user && (
        <p>
          {user.firstName} {user.lastName}
        </p>
      )}
    </main>
  );
}
