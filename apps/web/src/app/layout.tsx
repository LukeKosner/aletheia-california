import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist_Mono, Inter, Public_Sans } from "next/font/google";
import "./globals.css";
import { MotionProvider } from "@/components/shell/motion-provider";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InterviewOffer } from "@/components/interview/interview-offer";
import { readFlags } from "@/lib/flags";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-in/sign-out-button";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });
// Only the Greek alpha in the wordmark uses Inter.
const inter = Inter({ subsets: ["greek"], variable: "--font-inter" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

/** Follow the system color scheme before first paint, and when it changes. */
const THEME_SCRIPT = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){document.documentElement.classList.toggle("dark",m.matches)};a();m.addEventListener("change",a)}catch(e){}})()`;

export const metadata: Metadata = {
  title: "Aletheia",
  description:
    "Ask about California government, campaign money and lobbying, with cited answers from public records, plus voter interviews and studies.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The theme script sets the dark class before hydration.
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        publicSans.variable,
        inter.variable,
        geistMono.variable,
      )}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-3 focus:ring-ring/50"
        >
          Skip to content
        </a>
        {readFlags().INTERVIEW_PREVIEW || readFlags().OPEN_TESTING ? <p className="truncate bg-muted px-4 py-1 text-center text-xs text-muted-foreground print:hidden">Demonetized private test site. See <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">terms</Link>.</p> : null}
        <MotionProvider>
          <TooltipProvider>
            <Suspense fallback={<div className="h-14 border-b border-border" />}>
              <SiteHeader />
            </Suspense>
            <div id="content" className="flex flex-1 flex-col">
              {children}
            </div>
            {readFlags().INTERVIEW_PREVIEW ? <Suspense fallback={null}><InterviewOffer /></Suspense> : null}
            <Suspense fallback={<div className="h-20 border-t border-border" />}>
              <SiteFooter signOut={<SignOutButton />} />
            </Suspense>
          </TooltipProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
