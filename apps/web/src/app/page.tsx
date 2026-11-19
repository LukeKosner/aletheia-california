import Link from "next/link";
import { Suspense } from "react";
import { Building2, Landmark, Mic } from "lucide-react";
import { HomeStats } from "@/components/home/home-stats";
import { QuestionForm } from "@/components/investigations/question-form";
import { Button } from "@/components/ui/button";
import { readFlags } from "@/lib/flags";
import { dollars, PRICES, REWARD_CENTS } from "@/lib/interview/taxonomy";

export default function Home() {
  const interviews = readFlags().INTERVIEW_PREVIEW;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-4 pt-14 pb-24 sm:gap-32 sm:px-6 sm:pt-24 sm:pb-32">
      <section className="flex max-w-3xl flex-col">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">Ask California anything.</h1>
        <p className="mt-4 max-w-2xl text-lg text-pretty text-muted-foreground sm:mt-5 sm:text-xl">
          Aletheia connects Californians with their government by researching public records, listening to voters, and running studies.
        </p>
        <div className="mt-10 sm:mt-12"><QuestionForm compact /></div>
      </section>

      {interviews ? (
        <section className="flex flex-col gap-8">
          <h2 className="text-2xl font-semibold tracking-tight">Hear from Californians</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-border p-6 sm:p-8">
              <Mic aria-hidden className="size-6 text-stamp" />
              <h3 className="text-lg font-semibold">Share what matters to you</h3>
              <p className="text-muted-foreground">Talk for ten minutes about the issues on your mind. We look up your questions in public records and send you {dollars(REWARD_CENTS)}.</p>
              <Button size="lg" className="mt-4 w-fit" nativeButton={false} render={<Link href="/interview" />}>Take an interview</Button>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-border p-6 sm:p-8">
              <div className="flex gap-2 text-stamp"><Building2 aria-hidden className="size-6" /><Landmark aria-hidden className="size-6" /></div>
              <h3 className="text-lg font-semibold">Run a study</h3>
              <p className="text-muted-foreground">Write your questions or let the agent draft them. We run the interviews and show you every answer. From {dollars(PRICES.study.cents)}.</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/interview/studies/new?kind=business" />}>For businesses</Button>
                <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/interview/studies/new?kind=government" />}>For government</Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {interviews ? (
        <section className="flex flex-col gap-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">From the interviews so far</h2>
            <Link href="/interview/insights" className="text-sm font-medium text-stamp underline-offset-4 hover:underline">All insights</Link>
          </div>
          <Suspense fallback={<div className="h-28 rounded-xl border border-border" />}><HomeStats /></Suspense>
        </section>
      ) : null}
    </main>
  );
}
