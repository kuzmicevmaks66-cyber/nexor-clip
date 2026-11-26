import { useCallback, useEffect, useState } from "react";
import type { RouteId } from "@/types";
import { ROUTE_IDS } from "@/app/routes";

// Простой hash-роутер: в desktop-приложении нет адресной строки,
// а hash надёжно работает и в WebView2, и в dev-браузере.

function readRoute(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, "") as RouteId;
  return ROUTE_IDS.includes(id) ? id : "home";
}

export function useRoute() {
  const [route, setRoute] = useState<RouteId>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((id: RouteId) => {
    window.location.hash = `/${id}`;
  }, []);

  return { route, navigate };
}
