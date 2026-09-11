import { env } from "../env.js";

/**
 * Is this build the public sales demonstration?
 *
 * One constant, read once from the build-time environment, because this is the boundary the whole
 * application branches on — before the authentication guards mount, not inside them.
 *
 * **Demo mode is a different application.** It is public and fixture-only: no Supabase session, no
 * `/me`, no brokerage membership, no API call of any kind. Everything it shows comes from the typed
 * fixtures in `@asap/schema`, and everything a person does there lives in `sessionStorage` for the
 * length of the browser session. It can therefore be opened by anyone, in an incognito window, at
 * any route, and it will never reach a real brokerage's data.
 *
 * **Production is untouched by it.** With the flag off — which is the default, and what every real
 * deployment runs — the session, `/me`, membership, RLS and permissions all apply exactly as
 * before. Nothing here weakens them; the demo simply never mounts them.
 */
export const DEMO_MODE: boolean = env.VITE_PUBLIC_DEMO_MODE === "on";

/**
 * The demonstration's own operator, from the approved fixtures. In demo mode there is no signed-in
 * person to read, and inventing a blank one would show an empty sidebar.
 */
export const DEMO_PERSON = {
  name: "Grace Wanjiku",
  role: "Operations Manager",
  initials: "GW",
} as const;
