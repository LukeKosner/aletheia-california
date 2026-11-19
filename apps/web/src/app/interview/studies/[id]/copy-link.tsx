"use client";
import { Check, Copy } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const noop = () => () => {};

export function CopyLink({ path }: { path: string }) {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const url = `${origin}${path}`;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Study link" onFocus={(e) => e.currentTarget.select()} />
      <Button variant="outline" onClick={copy}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
