"use client";
import { useEffect, useState, type ReactNode } from "react";
import { PublicationNotice } from "./publication-notice";
import { UUID } from "./model";
type State = "checking" | "available" | "unpublished" | "unavailable" | "missing";
/** Recheck when a reader returns to the tab, and while a report remains open.
 * Publication endpoints and future receipt exporters must enforce this on the
 * server too. A client gate does not authorize publication. */
export function ReportPublicationGate({ investigationId, children }: {
    investigationId: string;
    children: ReactNode;
}) {
    const [state, setState] = useState<State>("checking");
    useEffect(() => {
        const controller = new AbortController();
        let sequence = 0;
        async function check() {
            const version = ++sequence;
            try {
                if (!UUID.test(investigationId))
                    throw new Error("Not a saved report");
                const response = await fetch(`/api/corrections/publication?investigation=${encodeURIComponent(investigationId)}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json();
                const next: State = response.ok && ["available", "unpublished", "missing"].includes(result.state) ? result.state : "unavailable";
                if (!controller.signal.aborted && version === sequence)
                    setState(next);
            }
            catch {
                if (!controller.signal.aborted && version === sequence)
                    setState("unavailable");
            }
        }
        const onVisible = () => { if (document.visibilityState === "visible")
            void check(); };
        void check();
        const interval = setInterval(() => { if (document.visibilityState === "visible")
            void check(); }, 30000);
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
    }, [investigationId]);
    if (state === "checking")
        return <p role="status">Checking the report’s current publication status…</p>;
    if (state !== "available")
        return <PublicationNotice state={state}/>;
    return children;
}
