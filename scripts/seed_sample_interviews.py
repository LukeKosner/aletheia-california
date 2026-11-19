"""Adds SAMPLE voter interviews and SAMPLE studies so the home page, insights and study pages have something to show
(human step, AGENTS.md "Dev database"). Every row is invented demo data and is labeled: summaries start with "Sample:",
study titles start with "Sample:", sponsors are named "Sample …", and every reward email is sample@example.invalid,
which never routes, so no reward can be sent. Remove them with scripts/reset_interview_data.py --yes before real use.

    cd py/ingest && uv run python ../../scripts/seed_sample_interviews.py

Writes only to the `interview` schema, as the database owner from packages/db/.env.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
EMAIL = "sample@example.invalid"  # .invalid never routes: no reward can be sent

# county, age, party, vote plan, issues, questions, views, summary, sources, quote, to leaders
VOTERS = [
    ("Los Angeles", "25-34", "Democratic", "Definitely voting", ["Housing and rent", "Cost of living"],
     ["Who funds the campaigns for and against rent control measures?"], ["Leaning yes on the housing bond"],
     "Rent takes more than half of their income. They want to know who pays for housing ballot campaigns.",
     ["Local TV news", "Friends and family"], "Every year the rent goes up and my paycheck doesn't.", "Make it possible to rent near where you work."),
    ("San Diego", "35-44", "No party preference", "Probably voting", ["Housing and rent", "Homelessness"],
     ["Which groups lobby on homeless shelter funding?"], [],
     "They see more tents near their kids' school and want to know where state homelessness money goes.",
     ["San Diego Union-Tribune", "Neighborhood apps"], "I want to see where the money actually goes.", "Show results, not just spending."),
    ("Fresno", "45-54", "Republican", "Definitely voting", ["Water and drought", "Jobs and economy"],
     ["Who lobbies on water allocation for Central Valley farms?"], ["Undecided on the water bond"],
     "Farm jobs in their town depend on water deliveries. They want plain facts on who shapes water policy.",
     ["Local radio", "Farm bureau newsletters"], "When the water stops, the jobs stop.", "Listen to people who work the land."),
    ("Alameda", "18-24", "Democratic", "Definitely voting", ["Climate and environment", "Housing and rent"],
     ["Which oil companies give the most to California legislators?"], [],
     "A student who wants faster climate action and cheaper housing near campus.",
     ["Instagram", "Campus newspaper"], "My whole paycheck from my campus job goes to rent.", "Move faster on clean energy."),
    ("Sacramento", "55-64", "Republican", "Definitely voting", ["Taxes", "Cost of living"],
     ["Who is funding Prop 40?"], ["Leaning no on Prop 40"],
     "They worry new taxes will push employers out of state and want to see who funds each side.",
     ["Sacramento Bee", "Talk radio"], "I want to see both sides' money before I decide.", "Keep California affordable for small businesses."),
    ("Riverside", "35-44", "No party preference", "Unsure", ["Cost of living", "Energy and utilities"],
     ["Who lobbies on electricity rates?"], [],
     "Their electric bill doubled in two years. They are unsure whether to vote this year.",
     ["Facebook", "Coworkers"], "My electric bill is more than my car payment now.", "Explain why rates keep going up."),
    ("San Francisco", "25-34", "Democratic", "Definitely voting", ["Technology and AI", "Jobs and economy"],
     ["Who lobbied on AB 1018?"], [],
     "Works in tech and wants clear rules for AI used in hiring and housing decisions.",
     ["Podcasts", "Newsletters"], "People should know when software decides whether they get the job.", "Write rules that people can understand."),
    ("Kern", "65+", "Republican", "Definitely voting", ["Public safety", "Cost of living"],
     ["Which committees spend the most on public safety measures?"], [],
     "A retiree on a fixed income who wants safer streets and lower gas prices.",
     ["Local TV news", "Church friends"], "Gas prices hit people on a fixed income the hardest.", "Make streets safer and gas cheaper."),
    ("Santa Clara", "45-54", "Democratic", "Probably voting", ["Education", "Housing and rent"],
     ["Who funds school bond campaigns?"], ["Leaning yes on the school facilities bond"],
     "A parent and teacher who wants smaller classes and housing teachers can afford.",
     ["School district emails", "Local newspaper"], "Half my colleagues commute over an hour.", "Help teachers live where they teach."),
    ("Orange", "25-34", "Republican", "Probably voting", ["Housing and rent", "Taxes"],
     ["Where does the California Realtors' PAC money go?"], [],
     "Saving to buy a first home and curious which groups shape housing policy.",
     ["YouTube", "Friends and family"], "I've been saving for years and prices keep running away.", "Let more homes get built."),
    ("Los Angeles", "35-44", "No party preference", "Definitely voting", ["Wildfires", "Health care"],
     ["Who lobbies on wildfire insurance rules?"], [],
     "Their home insurer dropped them after the fires. They want to understand the insurance rules.",
     ["Local TV news", "Neighbors"], "We did everything right and still lost our coverage.", "Fix home insurance before the next fire season."),
    ("Humboldt", "55-64", "Green", "Definitely voting", ["Climate and environment", "Wildfires"],
     ["Which timber companies contribute to state campaigns?"], [],
     "Lives near the forest and wants forest management decided on evidence.",
     ["Local radio", "Community meetings"], "The forest is our backyard and our livelihood.", "Base forest policy on the science."),
    ("San Bernardino", "25-34", "Democratic", "Probably voting", ["Transportation", "Jobs and economy"],
     ["Who lobbies on warehouse and trucking rules?"], [],
     "Commutes two hours a day past new warehouses and wants better transit and local jobs.",
     ["TikTok", "Coworkers"], "I spend more time on the freeway than with my kids.", "Build transit out here, not just in the city."),
    ("Contra Costa", "45-54", "Democratic", "Definitely voting", ["Health care", "Cost of living"],
     ["Who funds campaigns on prescription drug prices?"], [],
     "A nurse who sees patients skip medication because of cost.",
     ["Union newsletters", "Local newspaper"], "Patients ration insulin and I can't fix that from the bedside.", "Make medicine affordable."),
    ("Ventura", "65+", "Republican", "Definitely voting", ["Water and drought", "Taxes"],
     ["Who lobbies on water district rates?"], ["Leaning no on the water bond"],
     "A retired farmer who wants water storage built before new taxes.",
     ["Local radio", "Farm bureau newsletters"], "We need to store water in wet years.", "Build storage before asking for more taxes."),
    ("Monterey", "35-44", "No party preference", "Unsure", ["Housing and rent", "Labor and wages"],
     ["Who funds farmworker housing measures?"], [],
     "Works in agriculture and shares a two-bedroom apartment with another family.",
     ["Spanish-language radio", "Church friends"], "Two families in one apartment is normal here.", "Remember the people who pick the food."),
    ("Sacramento", "18-24", "Democratic", "Probably voting", ["Education", "Cost of living"],
     ["Who lobbies on community college funding?"], [],
     "A community college student working two jobs to stay in school.",
     ["Instagram", "Campus newspaper"], "I work two jobs and still can't buy textbooks.", "Make community college truly affordable."),
    ("Placer", "45-54", "Republican", "Definitely voting", ["Wildfires", "Energy and utilities"],
     ["Who lobbies on utility wildfire liability?"], [],
     "Lives in a high-fire area and worries about power shutoffs and insurance.",
     ["Local TV news", "Neighborhood apps"], "Every fire season we wonder if the power will be cut.", "Make utilities harden their lines."),
    ("San Mateo", "35-44", "Democratic", "Definitely voting", ["Technology and AI", "Education"],
     ["Who lobbies on AI in schools?"], [],
     "A parent who wants clear rules for AI tools in classrooms.",
     ["Podcasts", "School district emails"], "I want to know what the school's software does with my kid's data.", "Protect students' privacy."),
    ("Stanislaus", "55-64", "Republican", "Probably voting", ["Public safety", "Homelessness"],
     ["Which groups fund criminal justice measures?"], ["Leaning yes on the public safety measure"],
     "A small business owner dealing with repeated break-ins.",
     ["Local newspaper", "Facebook"], "We've had three break-ins this year.", "Support local police and small businesses."),
    ("Imperial", "25-34", "No party preference", "Unsure", ["Jobs and economy", "Health care"],
     ["Who lobbies on lithium mining near the Salton Sea?"], [],
     "Hopes new lithium projects bring jobs but worries about air quality.",
     ["Spanish-language TV", "Friends and family"], "We want the jobs, but we breathe this air.", "Bring jobs without hurting our health."),
    ("Marin", "65+", "Democratic", "Definitely voting", ["Climate and environment", "Transportation"],
     ["Who funds campaigns on sea level rise planning?"], [],
     "A retiree near the bay who wants the state to plan for rising water.",
     ["Local newspaper", "Community meetings"], "The marsh floods more every winter.", "Plan for the coast we will have."),
    ("Butte", "45-54", "Republican", "Definitely voting", ["Wildfires", "Housing and rent"],
     ["Who lobbies on rebuilding rules after fires?"], [],
     "Rebuilt after a fire and wants faster permits for others still waiting.",
     ["Local radio", "Neighbors"], "It took us three years to get the permits.", "Speed up rebuilding after disasters."),
    ("Los Angeles", "18-24", "Democratic", "Probably voting", ["Elections and democracy", "Housing and rent"],
     ["Who spends the most on independent expenditures in my district?"], [],
     "A first-time voter who wants to know who pays for the ads they see.",
     ["TikTok", "YouTube"], "I see the ads but never who paid for them.", "Make it easy to see who pays for political ads."),
    ("San Joaquin", "35-44", "No party preference", "Probably voting", ["Transportation", "Cost of living"],
     ["Who lobbies on high-speed rail?"], [],
     "Drives to the Bay Area for work and wants to know where rail money is going.",
     ["Podcasts", "Coworkers"], "I'd take a train in a heartbeat if it existed.", "Finish what you start."),
    ("Shasta", "55-64", "Republican", "Definitely voting", ["Gun policy", "Taxes"],
     ["Which groups fund campaigns on gun measures?"], [],
     "A hunter who wants to understand who funds both sides of gun measures.",
     ["Talk radio", "Friends and family"], "I want to know who is behind both sides.", "Respect rural voters."),
    ("Santa Barbara", "25-34", "Democratic", "Definitely voting", ["Housing and rent", "Climate and environment"],
     ["Who funds measures on offshore drilling?"], [],
     "Works at a local nonprofit and splits rent with three roommates.",
     ["Local newspaper", "Instagram"], "Three roommates and we still struggle with rent.", "Protect the coast and build housing."),
    ("Solano", "45-54", "Democratic", "Probably voting", ["Labor and wages", "Health care"],
     ["Who lobbies on minimum wage for health care workers?"], [],
     "A home health aide who wants better pay for care work.",
     ["Union newsletters", "Facebook"], "Care work is real work.", "Pay care workers a living wage."),
    ("Tulare", "35-44", "Republican", "Unsure", ["Water and drought", "Education"],
     ["Who funds rural school bond campaigns?"], [],
     "Their town's wells ran dry during the drought, and their kids' school needs repairs.",
     ["Local radio", "Church friends"], "Our well went dry and we hauled water for months.", "Don't forget small towns."),
    ("Nevada", "65+", "No party preference", "Definitely voting", ["Health care", "Wildfires"],
     ["Who lobbies on rural hospital funding?"], [],
     "Lives an hour from the nearest hospital and worries about emergency care.",
     ["Local newspaper", "Neighbors"], "An hour to the ER is too long in an emergency.", "Keep rural hospitals open."),
]

# Each study: kind, sponsor, title, goal, questions, fields, answers (one list per interview), age ranges, county.
STUDIES = [
    {
        "kind": "government", "sponsor": "Sample city planning department", "title": "Sample: Housing ideas for downtown",
        "goal": "Which housing ideas residents support, and why.",
        "questions": ["What makes housing hard to find here?", "What do you think about taller buildings near transit?", "What should the city do first?"],
        "fields": {"standard": ["county", "ageRange"], "custom": []}, "county": "Sacramento",
        "answers": [
            ["Rents rose faster than wages.", "Fine near transit if there is parking nearby.", "Speed up permits for small apartment buildings."],
            ["There are few rentals for families.", "Supports it, as long as buildings include affordable units.", "Build on empty city-owned lots."],
            ["Too many units sit empty as short-term rentals.", "Concerned about traffic, open to a pilot.", "Limit short-term rentals."],
            ["Waitlists for affordable units are years long.", "Taller is fine downtown, not in older neighborhoods.", "Convert empty offices to apartments."],
        ],
    },
    {
        "kind": "business", "sponsor": "Sample neighborhood coffee roaster", "title": "Sample: What makes a neighborhood cafe worth the trip",
        "goal": "What brings people back to a local cafe, and what would make them switch.",
        "questions": ["How did you pick the cafe you go to most?", "What would make you try a different one?", "What is missing from cafes near you?"],
        "fields": {"standard": ["county", "ageRange"], "custom": [{"label": "How often do you buy coffee out?", "options": ["Daily", "A few times a week", "Weekly", "Rarely"]}]},
        "county": "Alameda",
        "answers": [
            ["It's on my walk to the train.", "Better seating to work for an hour.", "Earlier opening hours."],
            ["The staff remember my order.", "A lower price for a basic drip coffee.", "Places that aren't packed on weekends."],
            ["Friends recommended it.", "If it closed early one more time.", "Decaf that tastes good."],
        ],
        "custom": ["Daily", "A few times a week", "Weekly"],
    },
    {
        "kind": "business", "sponsor": "Sample rooftop solar installer", "title": "Sample: Why homeowners choose rooftop solar, or don't",
        "goal": "What homeowners weigh when deciding on rooftop solar, and what stops them.",
        "questions": ["Have you looked into rooftop solar? What made you look?", "What would make it an easy yes?", "What worries you about it?"],
        "fields": {"standard": ["county", "ageRange", "city"], "custom": [{"label": "Do you rent or own your home?", "options": ["Own", "Rent", "Other"]}]},
        "county": "Riverside",
        "answers": [
            ["My electric bill doubled, so I started comparing quotes.", "A clear price with no long contract.", "Roof leaks after installation."],
            ["A neighbor put panels up last year.", "Knowing how long until it pays for itself.", "Rules changing after I sign."],
            ["Not yet. I'm not sure it's worth it now.", "A trusted installer with good reviews.", "Selling the house with a solar lease."],
        ],
        "custom": ["Own", "Own", "Own"], "cities": ["Riverside", "Corona", "Temecula"],
    },
]


def owner_url() -> str:
    for line in (ROOT / "packages/db/.env").read_text().splitlines():
        key, _, value = line.strip().removeprefix("export ").partition("=")
        if key == "DATABASE_URL_UNPOOLED":
            return value.strip().strip('"').strip("'")
    raise SystemExit("DATABASE_URL_UNPOOLED is missing from packages/db/.env")


def transcript(lines: list[tuple[str, str]]) -> str:
    return json.dumps([{"role": "interviewer", "text": "This is a sample interview for the demo."}, *({"role": r, "text": t} for r, t in lines)])


def main() -> None:
    now = datetime.now(timezone.utc)
    with psycopg.connect(owner_url()) as conn:
        cur = conn.cursor()
        for i, (county, age, party, plan, issues, questions, views, summary, sources, quote, leaders) in enumerate(VOTERS):
            text = f"Sample: {summary}"
            details = {"sources": sources, "quotes": [quote], "toLeaders": leaders}
            cur.execute(
                """insert into interview.session (reward_email, status, county, age_range, party, vote_likelihood, public_consent,
                   transcript, issues, questions, candidate_views, summary, wants_research, details, completed_at)
                   values (%s, 'completed', %s, %s, %s, %s, true, %s::jsonb, %s, %s, %s, %s, true, %s::jsonb, %s)""",
                (EMAIL, county, age, party, plan, transcript([("voter", text), ("voter", quote)]), issues, questions, views, text,
                 json.dumps(details), now - timedelta(hours=5 * i + 1)),
            )
        links = []
        for s in STUDIES:
            cur.execute(
                """insert into interview.study (sponsor_kind, sponsor_name, title, goal, questions, status, fields, interview_target, price_cents)
                   values (%s, %s, %s, %s, %s, 'open', %s::jsonb, 20, 14900) returning id""",
                (s["kind"], s["sponsor"], s["title"], s["goal"], s["questions"], json.dumps(s["fields"])),
            )
            study_id = cur.fetchone()[0]
            links.append(f"/interview/studies/{study_id}")
            for i, answers in enumerate(s["answers"]):
                pairs = [{"question": q, "answer": a} for q, a in zip(s["questions"], answers)]
                profile = {}
                if s["fields"]["custom"]:
                    profile[s["fields"]["custom"][0]["label"]] = s["custom"][i]
                if "city" in s["fields"]["standard"]:
                    profile["City or town"] = s["cities"][i]
                summary = f"Sample: {answers[-1]}"
                cur.execute(
                    """insert into interview.session (study_id, reward_email, status, county, age_range, party, vote_likelihood, public_consent,
                       transcript, answers, summary, profile, completed_at)
                       values (%s, %s, 'completed', %s, %s, 'Not asked', 'Not asked', true, %s::jsonb, %s::jsonb, %s, %s::jsonb, %s)""",
                    (study_id, EMAIL, s["county"], ["25-34", "45-54", "65+", "35-44"][i % 4],
                     transcript([("voter", a) for a in answers]), json.dumps(pairs), summary, json.dumps(profile), now - timedelta(hours=3 * i + 2)),
                )
        conn.commit()
    print(f"Added {len(VOTERS)} sample interviews and {len(STUDIES)} sample studies:")
    for link in links:
        print(f"  {link}")


if __name__ == "__main__":
    main()
