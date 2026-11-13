import assert from "node:assert/strict";
import test from "node:test";
import { assertNoObjectAccess, fixture, memoryNamespace } from "./fixtures.mjs";

test("mock: own company succeeds only after session and membership", async () => {
  const f = fixture(memoryNamespace());
  assert.deepEqual(await f.write(f.companyA, "synthetic A"), { kind: "ok", value: "synthetic A" });
  assert.deepEqual(f.events, [
    ["session"], ["membership", "fictional-own-user-alice", f.companyA],
    ["membership:resolved", true],
    ["idFromName", f.companyA], ["get", f.companyA], ["fetch", f.companyA],
  ]);
});

test("mock: nonmember read and write never derive an ID or open a DO", async () => {
  const f = fixture(memoryNamespace());
  assert.deepEqual(await f.read(f.companyB), { kind: "not_member" });
  assert.deepEqual(await f.write(f.companyB, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);
});

test("mock: logged out requests do not even query membership", async () => {
  const f = fixture(memoryNamespace());
  f.signIn(null);
  assert.deepEqual(await f.read(f.companyA), { kind: "unauthenticated" });
  assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "unauthenticated" });
  assert.deepEqual(f.events, [["session"], ["session"]]);
});

test("mock: revocation after a successful request takes effect next request", async () => {
  const f = fixture(memoryNamespace());
  await f.write(f.companyA, "before revocation");
  f.memberships.get("fictional-own-user-alice").delete(f.companyA);
  f.clearEvents();
  assert.deepEqual(await f.read(f.companyA), { kind: "not_member" });
  assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);
  assert.equal(f.events.filter(([event]) => event === "membership").length, 2);
});

test("mock: pending membership check cannot touch any DO", async () => {
  const f = fixture(memoryNamespace());
  let finish;
  let entered;
  const checking = new Promise(resolve => { entered = resolve; });
  f.deps.isActiveMember = async () => {
    entered();
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = f.read(f.companyB);
  await checking;
  assertNoObjectAccess(f.events);
  finish(false);
  assert.deepEqual(await pending, { kind: "not_member" });
  assertNoObjectAccess(f.events);
});

for (const dependency of ["resolveCurrentUser", "isActiveMember"]) {
  test(`mock: ${dependency} failure does not fall through to a DO`, async () => {
    const f = fixture(memoryNamespace());
    f.deps[dependency] = async () => { throw new Error("synthetic dependency failure"); };
    await assert.rejects(f.read(f.companyA), /synthetic dependency failure/);
    assertNoObjectAccess(f.events);
  });
}

test("mock: only explicit active membership permits access", async () => {
  for (const result of [false, null, undefined, "true", 1]) {
    const f = fixture(memoryNamespace());
    f.deps.isActiveMember = async () => result;
    assert.deepEqual(await f.read(f.companyA), { kind: "not_member" });
    assertNoObjectAccess(f.events);
  }
});

test("mock: multi-member only reads/writes selected company, never all memberships", async () => {
  const f = fixture(memoryNamespace());
  f.signIn("fictional-own-user-multi");
  await f.write(f.companyA, "A");
  await f.write(f.companyB, "B");
  f.clearEvents();
  assert.deepEqual(await f.write(f.companyA, f.companyB), { kind: "ok", value: f.companyB });
  assert.deepEqual(f.events.filter(([event]) => event === "idFromName"), [["idFromName", f.companyA]]);
  assert.deepEqual(await f.read(f.companyB), { kind: "ok", value: "B" });
});

test("mock: unknown company cannot generate a DO ID, stub, or fetch", async () => {
  const f = fixture(memoryNamespace());
  const unknownCompany = "fictional-company-not-in-memberships";
  assert.deepEqual(await f.read(unknownCompany), { kind: "not_member" });
  assert.deepEqual(await f.write(unknownCompany, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);
  assert.deepEqual(f.events, Array(2).fill([
    ["session"], ["membership", "fictional-own-user-alice", unknownCompany], ["membership:resolved", false],
  ]).flat());
});

test("mock: unknown user cannot generate a DO ID, stub, or fetch", async () => {
  const f = fixture(memoryNamespace());
  f.signIn("fictional-own-user-unknown");
  assert.deepEqual(await f.read(f.companyA), { kind: "not_member" });
  assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);
  assert.deepEqual(f.events, Array(2).fill([
    ["session"], ["membership", "fictional-own-user-unknown", f.companyA], ["membership:resolved", false],
  ]).flat());
});

test("mock: empty or missing company ID is rejected before membership, even if it would return true", async () => {
  for (const companyId of ["", " \t\n", undefined, null, 1]) {
    const f = fixture(memoryNamespace());
    f.deps.isActiveMember = async () => { assert.fail("invalid company must not be checked"); };
    assert.deepEqual(await f.read(companyId), { kind: "not_member" });
    assert.deepEqual(await f.write(companyId, "attack"), { kind: "not_member" });
    assert.deepEqual(f.events, [["session"], ["session"]]);
    assertNoObjectAccess(f.events);
  }
});

test("mock: missing or malformed session identity fails closed before membership", async () => {
  for (const user of [
    undefined, {}, { ownUserId: undefined }, { ownUserId: null },
    { ownUserId: "" }, { ownUserId: " \t" }, { ownUserId: 1 },
    false, "fictional-own-user-alice", [],
    Object.create({ ownUserId: "fictional-own-user-alice" }),
  ]) {
    const f = fixture(memoryNamespace());
    f.deps.resolveCurrentUser = async () => { f.events.push(["session"]); return user; };
    f.deps.isActiveMember = async () => { assert.fail("invalid user must not be checked"); };
    assert.deepEqual(await f.read(f.companyA), { kind: "unauthenticated" });
    assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "unauthenticated" });
    assert.deepEqual(f.events, [["session"], ["session"]]);
    assertNoObjectAccess(f.events);
  }
});

test("mock: non-2xx DO responses propagate errors without retry or a successful result", async () => {
  for (const status of [400, 403, 404, 500, 503]) {
    const f = fixture({
      idFromName: name => name,
      get: () => ({ async fetch() { return new Response("synthetic failure", { status }); } }),
    });
    await assert.rejects(f.read(f.companyA), { message: `Probe DO failed: ${status}` });
    await assert.rejects(f.write(f.companyA, "value"), { message: `Probe DO failed: ${status}` });
    assert.deepEqual(f.events, Array(2).fill([
      ["session"], ["membership", "fictional-own-user-alice", f.companyA], ["membership:resolved", true],
      ["idFromName", f.companyA], ["get", f.companyA], ["fetch", f.companyA],
    ]).flat());
  }
});
