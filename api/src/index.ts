/**
 * Starts the server.
 *
 * Kept separate from app.ts, which builds the application but never binds a
 * port. That split is what lets the tests drive every route in-process, without
 * a real socket, a free port to find, or a server to remember to shut down.
 */
import { app } from './app.js';

const port = Number(process.env.PORT ?? 8080);

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
