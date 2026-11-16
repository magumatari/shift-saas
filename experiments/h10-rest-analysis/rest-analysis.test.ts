import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRest, type Assignment, type PairEvidence } from './rest-analysis.ts';

// Fictional records; literal expectations below come from the README's arithmetic.
// No golden expected values, Solver output or implementation-generated oracle.
function fixture() {
  return {
    company:{min_rest_minutes:1200}, employees:[{id:'E1'}], stores:[{id:'S1'}],
    patterns:[
      {id:'NIGHT',version:1,start:'22:00',duration_minutes:480},
      {id:'LATE',version:1,start:'01:59',duration_minutes:240},
    ],
    assignments:[
      {id:'A1',employee:'E1',store:'S1',pattern:'NIGHT@1',start_date:'2026-12-07'},
      {id:'A2',employee:'E1',store:'S1',pattern:'LATE@1',start_date:'2026-12-09'},
    ],
    existing_assignments:[] as {id:string;employee:string;store:string;pattern:string;start_date:string}[],
  };
}
type Fixture = ReturnType<typeof fixture>;
const expected1199: PairEvidence = {
  employee:'E1',
  previous:{id:'A1',source:'candidate',store:'S1',pattern:'NIGHT@1',startJst:'2026-12-07T22:00',endJst:'2026-12-08T06:00'},
  next:{id:'A2',source:'candidate',store:'S1',pattern:'LATE@1',startJst:'2026-12-09T01:59',endJst:'2026-12-09T05:59'},
  elapsedMinutes:1199,
};
function evidence(input: unknown) {
  const r=analyzeRest(input);
  if(r.kind!=='evidence-only')assert.fail(JSON.stringify(r));
  return r;
}
const brief = (c: unknown) => evidence(c).pairs.map(p=>[p.employee,p.previous.id,p.next.id,p.elapsedMinutes]);
test('1199 minutes with full source and endpoint evidence',()=>{
  assert.deepEqual(evidence(fixture()),{kind:'evidence-only',minimumMinutes:1200,unit:'minutes',pairs:[expected1199],unpairedEmployees:[]});
});
test('1200 minutes is measured without producing a compliance verdict',()=>{
  const c=fixture();c.patterns[1].start='02:00';
  assert.deepEqual(evidence(c).pairs,[{...expected1199,next:{...expected1199.next,startJst:'2026-12-09T02:00',endJst:'2026-12-09T06:00'},elapsedMinutes:1200}]);
});
test('input order does not choose pair order',()=>{
  const c=fixture();c.assignments.reverse();c.patterns.reverse();
  assert.deepEqual(evidence(c).pairs,[expected1199]);
});
test('three shifts use both adjacent pairs and never skip the middle',()=>{
  const c=fixture();c.patterns.push({id:'MID',version:1,start:'12:00',duration_minutes:60});
  c.existing_assignments.push({id:'A3',employee:'E1',store:'S1',pattern:'MID@1',start_date:'2026-12-08'});
  assert.deepEqual(brief(c),[['E1','A1','A3',360],['E1','A3','A2',779]]);
});
test('employees are separated and output order is deterministic',()=>{
  const c=fixture();c.employees.unshift({id:'E2'});
  c.assignments.unshift({...c.assignments[0],id:'B1',employee:'E2'});
  c.assignments.push({...c.assignments[2],id:'B2',employee:'E2',start_date:'2026-12-10'});
  assert.deepEqual(brief(c),[['E1','A1','A2',1199],['E2','B1','B2',2639]]);
});
test('other stores do not remove a same-employee pair',()=>{
  const c=fixture();c.stores.push({id:'S2'});c.assignments[1].store='S2';
  assert.deepEqual(evidence(c).pairs,[{...expected1199,next:{...expected1199.next,store:'S2'}}]);
});
for(const position of ['previous','next','both'] as const)test(`candidate/existing integration: ${position}`,()=>{
  const c=fixture();
  if(position==='both'){c.existing_assignments=c.assignments;c.assignments=[];}
  else c.existing_assignments.push(c.assignments.splice(position==='previous'?0:1,1)[0]);
  assert.deepEqual(evidence(c).pairs,[{
    ...expected1199,
    previous:{...expected1199.previous,source:position==='next'?'candidate':'existing'},
    next:{...expected1199.next,source:position==='previous'?'candidate':'existing'},
  }]);
});
test('supplied previous and future records are retained without a generation-period filter',()=>{
  const c=fixture();c.existing_assignments=[
    {...c.assignments[1],id:'FUTURE',start_date:'2026-12-10'},
    {...c.assignments[1],id:'PAST',start_date:'2026-12-06'},
  ];
  assert.deepEqual(brief(c),[['E1','PAST','A1',2401],['E1','A1','A2',1199],['E1','A2','FUTURE',1200]]);
});
for(const [name,first,next,end] of [
  ['month','2026-01-31','2026-02-02','2026-02-01T06:00'],
  ['year','2026-12-31','2027-01-02','2027-01-01T06:00'],
  ['leap day','2028-02-28','2028-03-01','2028-02-29T06:00'],
  ['non-leap February','2027-02-28','2027-03-02','2027-03-01T06:00'],
  ['leap century','2000-02-28','2000-03-01','2000-02-29T06:00'],
])test(`calendar arithmetic across ${name}`,()=>{
  const c=fixture();c.assignments[0].start_date=first;c.assignments[1].start_date=next;c.patterns[1].start='02:00';
  const p=evidence(c).pairs[0];assert.equal(p.previous.endJst,end);assert.equal(p.next.startJst,next+'T02:00');assert.equal(p.elapsedMinutes,1200);
});
test('JST midnight crossing is explicit and one minute remains one minute',()=>{
  const c=fixture();c.assignments[0].start_date='2026-12-31';c.assignments[1].start_date='2027-01-01';
  c.patterns[0].start='23:30';c.patterns[0].duration_minutes=30;c.patterns[1].start='00:01';
  const p=evidence(c).pairs[0];assert.equal(p.previous.endJst,'2027-01-01T00:00');assert.equal(p.elapsedMinutes,1);
});
test('touching shifts expose numeric zero only, not a violation interval',()=>{
  const c=fixture();c.assignments[0].start_date='2026-12-31';c.assignments[1].start_date='2027-01-01';
  c.patterns[0].start='23:30';c.patterns[0].duration_minutes=30;c.patterns[1].start='00:00';
  const p=evidence(c).pairs[0];assert.equal(p.previous.endJst,p.next.startJst);assert.equal(p.elapsedMinutes,0);
});
test('years below 0100 are not changed to 1900-based years',()=>{
  const c=fixture();c.assignments[0].start_date='0099-12-07';c.assignments[1].start_date='0099-12-09';
  assert.equal(evidence(c).pairs[0].previous.startJst,'0099-12-07T22:00');assert.equal(evidence(c).pairs[0].elapsedMinutes,1199);
});
test('explicit zero and changed minima are echoed, never used to generate verdicts',()=>{
  for(const minimum of [0,600,1201]){
    const c=fixture();c.company.min_rest_minutes=minimum;const r=evidence(c);
    assert.equal(r.minimumMinutes,minimum);assert.deepEqual(r.pairs,[expected1199]);
    assert.deepEqual(Object.keys(r).sort(),['kind','minimumMinutes','pairs','unit','unpairedEmployees']);
  }
});
test('employees with zero or one supplied shift are reported, not silently discarded',()=>{
  const c=fixture();c.employees.push({id:'E3'},{id:'E2'});c.assignments.push({...c.assignments[0],id:'B1',employee:'E2'});
  const r=evidence(c);assert.deepEqual(r.pairs,[expected1199]);assert.deepEqual(r.unpairedEmployees,['E2','E3']);
});
for(const n of [0,1])test(`${n} supplied shifts give no-pairs, never PASS`,()=>{
  const c=fixture();c.assignments=c.assignments.slice(0,n);const r=analyzeRest(c);
  assert.equal(r.kind,'no-pairs');if(r.kind==='no-pairs')assert.deepEqual(r.unpairedEmployees,['E1']);
});
test('empty but explicitly provided arrays do not establish completeness',()=>{
  const c=fixture();c.assignments=[];c.patterns=[];c.employees=[];c.stores=[];
  assert.equal(analyzeRest(c).kind,'no-pairs');
});
test('pattern references include the exact version, not the last matching name',()=>{
  const c=fixture();c.patterns.push({...c.patterns[0],version:2,duration_minutes:540});c.assignments[0].pattern='NIGHT@2';
  const p=evidence(c).pairs[0];assert.equal(p.previous.endJst,'2026-12-08T07:00');assert.equal(p.previous.pattern,'NIGHT@2');assert.equal(p.elapsedMinutes,1139);
});
test('caller-side labels and break metadata do not change the projected shift span',()=>{
  const c=fixture();const original={...c.patterns[0],displayLabel:'night label',work:[[0,240],[300,480]],break:[[240,300]]};
  const project=()=>{const {id,version,start,duration_minutes}=original;return {id,version,start,duration_minutes};};
  c.patterns[0]=project();assert.deepEqual(evidence(c).pairs,[expected1199]);
  original.displayLabel='renamed label';original.work=[[0,240],[330,480]];original.break=[[240,330]];
  c.patterns[0]=project();assert.deepEqual(evidence(c).pairs,[expected1199]);
});
test('frozen input is unchanged and repeated calls are deterministic',()=>{
  const c=fixture(),before=JSON.stringify(c);
  function freeze(v:unknown){if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item);Object.freeze(v);}}
  freeze(c);assert.deepEqual(evidence(c).pairs,[expected1199]);assert.deepEqual(evidence(c).pairs,[expected1199]);assert.equal(JSON.stringify(c),before);
});

const invalid: [string,(c:Fixture)=>unknown,RegExp][] = [
  ['null root',()=>null,/projection/],
  ['array root',()=>[],/projection/],
  ['missing existing array',c=>({...c,existing_assignments:undefined}),/explicit array/],
  ['coverage is not a completeness contract',c=>({...c,coverage:{}}),/projection/],
  ['duplicate employee',c=>({...c,employees:[...c.employees,...c.employees]}),/employees: invalid or duplicate/],
  ['empty employee id',c=>({...c,employees:[{id:''}]}),/employees: invalid/],
  ['duplicate store',c=>({...c,stores:[...c.stores,...c.stores]}),/stores: invalid or duplicate/],
  ['duplicate pattern reference',c=>({...c,patterns:[...c.patterns,c.patterns[0]]}),/duplicate reference/],
  ['duplicate candidate id',c=>({...c,assignments:[...c.assignments,c.assignments[0]]}),/duplicate id/],
  ['duplicate id across sources',c=>({...c,existing_assignments:[c.assignments[0]]}),/duplicate id/],
  ['unknown employee',c=>{c.assignments[1].employee='E9';return c;},/unknown employee/],
  ['unknown store',c=>{c.assignments[1].store='S9';return c;},/unknown store/],
  ['unknown pattern version',c=>{c.assignments[0].pattern='NIGHT@9';return c;},/unknown pattern/],
  ['reference is not normalized',c=>{c.assignments[0].pattern='NIGHT@01';return c;},/unknown pattern/],
  ['invalid hour',c=>{c.patterns[0].start='24:00';return c;},/invalid timing/],
  ['invalid minute',c=>{c.patterns[0].start='22:60';return c;},/invalid timing/],
  ['timezone suffix is not part of the projection',c=>{c.patterns[0].start='22:00Z';return c;},/invalid timing/],
  ['zero duration',c=>{c.patterns[0].duration_minutes=0;return c;},/invalid timing/],
  ['negative duration',c=>{c.patterns[0].duration_minutes=-1;return c;},/invalid timing/],
  ['fractional duration',c=>{c.patterns[0].duration_minutes=1.5;return c;},/invalid timing/],
  ['zero version',c=>{c.patterns[0].version=0;return c;},/invalid timing/],
  ['unprojected pattern fields',c=>({...c,patterns:[{...c.patterns[0],break:[]},c.patterns[1]]}),/projection/],
];
for(const date of ['2026-02-30','2027-02-29','2100-02-29','2026-13-01','2026-12-07T22:00']){
  invalid.push([`invalid date ${date}`,c=>{c.assignments[0].start_date=date;return c;},/invalid local date/]);
}
for(const minimum of [undefined,null,-1,1.5,'1200',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  invalid.push([`invalid company minimum ${String(minimum)}`,c=>({...c,company:{min_rest_minutes:minimum}}),/setting/]);
}
for(const [name,change,reason] of invalid)test(`precondition: ${name}`,()=>{
  const r=analyzeRest(change(fixture()));assert.equal(r.kind,'not-analyzed');
  if(r.kind==='not-analyzed'){assert.equal(r.category,'precondition');assert.match(r.explanation,reason);assert.equal('pairs' in r,false);}
});
for(const [name,change,reason] of [
  ['simultaneous starts',(c:Fixture)=>{c.assignments[1]={...c.assignments[0],id:'OTHER'};},/simultaneous/],
  ['overlap and negative one-minute rest',(c:Fixture)=>{c.patterns[0].duration_minutes=1680;},/overlapping/],
  ['multiple non-overlapping starts on one date',(c:Fixture)=>{c.patterns[0].duration_minutes=60;c.assignments[1].start_date='2026-12-07';},/multiple starts/],
  ['end beyond four-digit years',(c:Fixture)=>{c.assignments[0].start_date='9999-12-31';},/four-digit/],
] as const)test(`unsupported: ${name}`,()=>{
  const c=fixture();change(c);const r=analyzeRest(c);assert.equal(r.kind,'not-analyzed');
  if(r.kind==='not-analyzed'){assert.equal(r.category,'unsupported');assert.match(r.explanation,reason);assert.equal('pairs' in r,false);}
});

// Category priority is experimental: malformed records precede unsupported math.
// Literal expected categories do not depend on the implementation's output.
const prioritySeed=fixture();
const far: Assignment={...prioritySeed.assignments[0],id:'FAR',start_date:'9999-12-31'};
const priorityCauses: [string,Assignment[],RegExp][]=[
  ['unknown employee',[{...prioritySeed.assignments[0],id:'BAD',employee:'E9'}],/unknown employee/],
  ['duplicate id',[{...prioritySeed.assignments[0],id:'DUP'},{...prioritySeed.assignments[1],id:'DUP'}],/duplicate id/],
];
for(const [cause,bad,reason] of priorityCauses){
  const front=[far,...bad],back=[...bad,far];
  const layouts: [string,readonly Assignment[],readonly Assignment[]][]=[
    ['candidate forward',front,[]],['candidate reverse',back,[]],
    ['existing forward',[],front],['existing reverse',[],back],
    ['cross unsupported first',bad.length===2?[far,bad[0]]:[far],bad.length===2?[bad[1]]:bad],
    ['cross precondition first',bad.length===2?[bad[0]]:bad,bad.length===2?[bad[1],far]:[far]],
  ];
  for(const [layout,assignments,existing_assignments] of layouts)test(`classification priority: ${cause} / ${layout}`,()=>{
    const r=analyzeRest({...fixture(),assignments,existing_assignments});
    assert.equal(r.kind,'not-analyzed');
    if(r.kind==='not-analyzed'){
      assert.equal(r.category,'precondition','mixed causes must retain precondition priority');
      assert.match(r.explanation,reason);assert.equal('pairs' in r,false);
    }
  });
}
