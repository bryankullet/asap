import { useEffect, useState } from "react";

/**
 * The address is the open surface: `/` is Home, `/x/<id>` is an experience. Refresh reopens it, and
 * the browser's Back and Forward move between experiences as they were opened.
 */
export type Route = { name: "home" } | { name: "experience"; id: string } | { name: "missing" };

export function parse(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "home" };
  const m = pathname.match(/^\/x\/([0-9a-f-]{36})\/?$/i);
  return m ? { name: "experience", id: m[1]!.toLowerCase() } : { name: "missing" };
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
