"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EmailForm({ next }: { next: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, callbackURL: `/sign-in/complete?next=${encodeURIComponent(next)}`, newUserCallbackURL: `/sign-in/complete?next=${encodeURIComponent(next)}`, errorCallbackURL: "/sign-in?email_error=1" }) });
      setMessage(response.ok ? "Check your email for a single-use sign-in link. It expires in five minutes." : "Email sign-in is unavailable for this address. You can still use the private team password.");
    } catch { setMessage("Email sign-in could not connect. Please try again later."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="mb-6 flex flex-col gap-3 border-b border-border pb-6">
    <label htmlFor="email" className="text-sm font-medium">Team email</label>
    <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
    <Button disabled={pending} type="submit">{pending ? "Requesting link…" : "Email me a sign-in link"}</Button>
    <p role="status" className="text-sm text-muted-foreground">{message}</p>
  </form>;
}
