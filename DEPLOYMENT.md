# Deployment

Three layers, three providers, all free tier.

The order matters, and there is a circular dependency to be aware of: the API
needs the frontend's origin for CORS, and the frontend needs the API's URL. One
of them has to be deployed with a placeholder and corrected at the end.

---

## 1. Database — Neon

1. <https://console.neon.tech> → **New Project**. Any name; pick the region
   closest to where the API will run.
2. Copy the **connection string**:

   ```
   postgres://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```

   It contains a password and grants full read/write. It goes into Render's
   dashboard and nowhere else — never into the repository.

The schema applies itself on the first Render deploy: the build command runs the
migration runner.

---

## 2. API — Render

1. <https://dashboard.render.com> → **New** → **Blueprint**.
2. Select this repository. Render reads [`render.yaml`](render.yaml) and
   configures the service itself.
3. Fill in the two variables it prompts for:

   | Variable       | Value                                                          |
   | -------------- | -------------------------------------------------------------- |
   | `DATABASE_URL` | The Neon connection string from step 1                          |
   | `WEB_ORIGINS`  | `https://bolt-otp-checkout.vercel.app` — corrected in step 4    |

4. Deploy, and note the service URL: `https://bolt-api-XXXX.onrender.com`.
5. Confirm it is alive:

   ```bash
   curl https://bolt-api-XXXX.onrender.com/api/health
   # {"status":"ok","database":"ok"}
   ```

   `"database":"ok"` confirms Neon is reachable and the migrations ran.

---

## 3. Frontend — Vercel

1. <https://vercel.com/new> → import this repository.
2. Set **Root Directory** to `web`. This matters: the repository root is not the
   frontend, and Vercel will otherwise fail to find a build.
3. Add one environment variable:

   | Variable            | Value                                  |
   | ------------------- | -------------------------------------- |
   | `VITE_API_BASE_URL` | `https://bolt-api-XXXX.onrender.com`   |

   No trailing slash — the client appends paths beginning with `/api`.

4. Deploy, and note the URL: `https://bolt-otp-checkout.vercel.app`.

[`web/vercel.json`](web/vercel.json) rewrites every path to `index.html`, so a
hard refresh on `/register` reaches the app rather than 404ing. Without it,
client-side routes only work when navigated to from inside the app.

---

## 4. Close the loop

If the Vercel URL differs from the one guessed in step 2, update `WEB_ORIGINS`
on Render to the real value and redeploy.

Getting this wrong is the single most likely deployment failure, and it has a
distinctive symptom: **the site loads fine, but every request fails with a CORS
error in the browser console.** That is not a bug in the API — it is the browser
refusing to hand the page a response the API did not vouch for.

---

## Verifying the deployment

```bash
API=https://bolt-api-XXXX.onrender.com

# 1. Alive, and the database is reachable
curl -s $API/api/health

# 2. CORS names the real frontend origin (not *)
curl -s -D - -o /dev/null \
  -H "Origin: https://bolt-otp-checkout.vercel.app" \
  $API/api/auth/me | grep -i access-control
```

Then in the browser: register, note the code, go to checkout, type that email,
and confirm the modal appears and the code signs you in.

---

## Notes

- **`VITE_` variables are public.** Vite inlines them into the bundle at build
  time, so anyone can read them. Fine for an API address, and the reason secrets
  never carry that prefix.
- **Render's free tier sleeps** after roughly 15 minutes of inactivity, so the
  first request after a quiet period can take up to a minute while the container
  wakes. Warm it by hitting `/api/health` a few minutes before any demo.
- **Cookies work cross-domain** because the API sets `SameSite=None` with
  `Secure` when `NODE_ENV=production`, and the frontend sends
  `credentials: 'include'`. Both halves are required; either alone drops the
  session silently.
- **Migrations run during the build**, so a schema change ships with the code
  that needs it. The runner is idempotent and exits non-zero on failure, which
  fails the deploy rather than starting a server against a half-migrated
  database.
