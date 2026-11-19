import { DraftPage } from "@/components/investigations/draft-page";

export default function Page() {
  return (
    <DraftPage title="How it works">
      <p>Aletheia reads California public records: campaign filings from CAL-ACCESS, roll-call votes and bill data from the Legislature, and lobbying reports. Every figure links back to its source.</p>
      <section className="space-y-2"><h2>Contributions</h2><p>Legislator pages count contributions reported to the legislator’s own campaign committees. One contribution can appear on several reports, so lines with the same contributor, date and amount are counted once. Totals are sums of reported lines, not audited campaign totals.</p></section>
      <section className="space-y-2"><h2>Ballot measures</h2><p>Measure pages group campaign committees by their own names (“Yes on 40”, “No on 40”) and count contributions from the year before the election through election year. Independent spending shows the position the spender reported. Proposition numbers repeat across elections, so each election has its own page.</p></section>
      <section className="space-y-2"><h2>Votes and issues</h2><p>Issue search matches words in bill titles. Yes and no counts are the number of related bills with at least one recorded yes or no roll-call vote by that legislator. A vote or a contribution is a recorded fact; it does not establish motive.</p></section>
      <section className="space-y-2"><h2>Answers to questions</h2><p>Aletheia checks public records first. Each sentence drawn from a record cites the filing it comes from. A separate verifier checks whether the filing supports the sentence; until it runs, answers are marked as pending.</p></section>
      <section className="space-y-2"><h2>Web sources</h2><p>For background and explanation, answers can also use web pages, preferring official sources such as the Legislature, the Secretary of State and the Legislative Analyst. Those sentences link to the page they come from and are marked as web sources. Aletheia does not check them against filings.</p></section>
      <section className="space-y-2"><h2>Voter interviews</h2><p>Voters talk with an AI interviewer for about ten minutes. Their answers are summarized in neutral language and published without names, emails or addresses. Questions they raise are looked up in public records for free. Organizations can run their own studies; their results go to the organization and are not counted in the public insights.</p></section>
      <section className="space-y-2"><h2>Limits</h2><p>Records can be incomplete, amended or late. Similar names do not prove two records refer to the same person or organization. Missing evidence is not a finding that something did not happen.</p></section>
    </DraftPage>
  );
}
