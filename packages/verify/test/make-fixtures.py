"""Offline only. Copies public fixture records, creates explicitly false negative examples. No DB I/O."""
import json, re
from decimal import Decimal
from pathlib import Path
root = Path(__file__).resolve().parents[3]
slice = json.loads((root/'packages/tools/test/fixtures/calaccess_slice.json').read_text())
web = json.loads((root/'py/ingest/tests/leginfo/fixtures/leginfo_web_votes.json').read_text())
entities = {e['canonical_key']:e for e in slice['entities']}
filings = {(f['filing_id'],f['amendment_no']):f for f in slice['filings']}
candidates = [e for e in slice['edges'] if not re.search(r'\d',entities[e['from_key']]['name'])]
fixtures=[]
def finance(edge):
    f=filings[(edge['filing_id'],edge['amend_id'])]
    name=entities[edge['from_key']]['name']
    amount=f"${Decimal(edge['amount']):,.2f}"
    sentence=f"{name} reported {amount} on this itemized filing line."
    return dict(sentence=sentence, edge=edge, filing=f, from_entity=entities[edge['from_key']],to_entity=entities[edge['to_key']],source={'filing_id':f['filing_id'],'url':f['url'],'schedule':edge['schedule'],'line_item':edge['line_item']})
for edge in candidates[:10]:
    original=finance(edge)
    wrong=f"${Decimal(edge['amount'])+Decimal('0.01'):,.2f}"
    mutated=re.sub(r'\$[\d,.]+',wrong,original['sentence'])
    fixtures.append(dict(kind='amount',original=original,negative_example=mutated,expected_check='numbers',expected_code='number_mismatch'))
for edge in candidates[10:16]:
    original=finance(edge)
    # Replacement is a real public-record entity name, deliberately attributed to the wrong row.
    alternate=next(e['name'] for e in slice['entities'] if e['name']!=original['from_entity']['name'] and not re.search(r'\d',e['name']))
    mutated=original['sentence'].replace(original['from_entity']['name'],alternate)
    fixtures.append(dict(kind='name',original=original,negative_example=mutated,replacement_name=alternate,expected_check='identity',expected_code='name_mismatch'))
for call in web['202520260SB329']['rollcalls'][:6]:
    total=call['ayes']+call['noes']+call['nvr']
    sentence=f"The recorded roll call had {call['ayes']} ayes out of all {total} members."
    original={'sentence':sentence,'source_bill_id':'202520260SB329','source':{'url':web['202520260SB329']['url']},'roll_call':call}
    mutated=sentence.replace(f'all {total} members',f'all {total+1} members')
    fixtures.append(dict(kind='base_rate',original=original,negative_example=mutated,expected_check='numbers',expected_code='number_mismatch'))
for banned,edge in zip(['bought','paid off','corrupt','in the pocket of','bribe','kickback','rigged','puppet'],candidates[:8]):
    original=finance(edge)
    fixtures.append(dict(kind='language',original=original,negative_example=original['sentence']+' '+banned+'.',expected_check='language',expected_code='banned_phrase'))
result={'_notice':'All originals are statements derived from the cited public records copied below. negative_example strings intentionally make FALSE or disallowed claims for rejection tests; they are not factual records. Edge/entity/filing UUIDs in financial rows are copied from the repository CAL-ACCESS slice. Leginfo DB UUIDs are not available and are never asserted as real: tests assign ephemeral in-memory adapter IDs only.','_sources':slice['_source']+['Legislative counts/names: py/ingest/tests/leginfo/fixtures/leginfo_web_votes.json; URL alongside each roll call. No relationship between financial parties and legislators is asserted.'],'fixtures':fixtures}
(root/'packages/verify/fixtures.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
