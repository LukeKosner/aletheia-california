"use client";

/**
 * Share control for a human-written build log entry.
 *
 * It prefills a post; it never sends one. The link opens X's compose window
 * with the text filled in, and the second button copies the same text so it can
 * be pasted anywhere else.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildShareUrl } from "./share";

export function ShareButton({ text, entryTask }: { text: string; entryTask: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        render={
          <a
            href={buildShareUrl(text)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Share "${entryTask}" — opens a prefilled post`}
          />
        }
      >
        <Share data-icon="inline-start" aria-hidden />
        Share
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={copy}
        aria-label={copied ? "Post text copied" : "Copy post text"}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}
