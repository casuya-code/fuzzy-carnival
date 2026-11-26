"use client";

import { useEffect } from "react";
import { reportMetric } from "@/lib/performance";

/** Reports real browser page-load timing once per full page load. */
export default function PerformanceReporter() {
  useEffect(() => {
    const report = () => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (!nav) return;
      reportMetric("page.load", nav.duration, { kind: nav.type });
      reportMetric("page.dom_content_loaded", nav.domContentLoadedEventEnd - nav.startTime, {
        kind: nav.type,
      });
    };
    if (document.readyState === "complete") report();
    else window.addEventListener("load", report, { once: true });
    return () => window.removeEventListener("load", report);
  }, []);
  return null;
}
