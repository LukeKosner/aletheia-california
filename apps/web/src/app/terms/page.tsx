import { DraftPage } from "@/components/investigations/draft-page";

export default function Page() {
  return (
    <DraftPage title="Terms of use (test site)">
      <p>
        This is a test version of Aletheia, open only so people can try it out. It is not a finished service. It can change, go offline or be reset at any time, and anything stored here, including interviews and studies, may be deleted without notice.
      </p>
      <section>
        <h2>No real money</h2>
        <p>
          Every payment runs in Stripe test mode, and no real money is charged. Do not enter a real card number; use a Stripe test card. Interview rewards are recorded, not sent, so nobody is paid for an interview on this site.
        </p>
      </section>
      <section>
        <h2>Answers can be wrong</h2>
        <p>
          Answers are written by AI from public records and, for some questions, web pages. They may contain errors or leave out relevant records. Check the original filing and its reporting period before you rely on an answer or share it.
        </p>
        <p>
          Reported financial activity does not establish a person’s intent, a causal relationship or a legal violation. Nothing here is legal, financial or voting advice.
        </p>
      </section>
      <section>
        <h2>Interviews and sample data</h2>
        <p>
          Only take an interview if you are comfortable with what the <a href="/privacy" className="underline underline-offset-4">Privacy notice</a> describes. Do not say anything you would not want recorded. Some interviews and studies are invented samples for demonstration, and each one is labeled “Sample”.
        </p>
      </section>
      <section>
        <h2>Fair use</h2>
        <p>
          Please do not use the site to harass anyone, and do not send automated traffic. To report a mistake, use the <a href="/corrections" className="underline underline-offset-4">Corrections page</a>.
        </p>
      </section>
      <p>These test terms have not been reviewed by a lawyer. Terms for a public launch are not written yet.</p>
    </DraftPage>
  );
}
