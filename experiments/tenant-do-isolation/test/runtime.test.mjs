import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Miniflare } from "miniflare";
import { assertNoObjectAccess, fixture } from "./fixtures.mjs";

let mf;
let namespace;
before(async () => {
  const source = await readFile(new URL("../src/company-object.ts", import.meta.url), "utf8");
  mf = new Miniflare({
    modules: true,
    script: stripTypeScriptTypes(source),
    compatibilityDate: "2026-07-30",
    durableObjects: { COMPANIES: { className: "ProbeCompanyObject", useSQLite: true } },
    durableObjectsPersist: false,
    // Never connect to remote services, including from the worker's global fetch.
    outboundService: () => { throw new Error("Outbound network forbidden in this probe"); },
    host: "127.0.0.1",
    port: 0,
  });
  namespace = await mf.getDurableObjectNamespace("COMPANIES");
});
after(async () => { await mf?.dispose(); });

test("workerd SQLite: own company round trip and stable/distinct DO identities", async () => {
  const f = fixture(namespace, "roundtrip");
  const a = namespace.idFromName(f.companyA);
  assert.equal(a.toString(), namespace.idFromName(f.companyA).toString());
  assert.notEqual(a.toString(), namespace.idFromName(f.companyB).toString());
  assert.deepEqual(await f.write(f.companyA, "synthetic A"), { kind: "ok", value: "synthetic A" });
  assert.deepEqual(await f.read(f.companyA), { kind: "ok", value: "synthetic A" });
  assert.deepEqual(f.events, Array(2).fill([
    ["session"], ["membership", "fictional-own-user-alice", f.companyA], ["membership:resolved", true],
    ["idFromName", f.companyA], ["get", a.toString()], ["fetch", a.toString()],
  ]).flat());
});

test("workerd SQLite: denied foreign reads/writes leave B data intact and never open B", async () => {
  const f = fixture(namespace, "foreign");
  f.signIn("fictional-own-user-multi");
  await f.write(f.companyB, "B unchanged");
  f.signIn("fictional-own-user-alice");
  f.clearEvents();
  assert.deepEqual(await f.read(f.companyB), { kind: "not_member" });
  assert.deepEqual(await f.write(f.companyB, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);
  f.signIn("fictional-own-user-multi");
  assert.deepEqual(await f.read(f.companyB), { kind: "ok", value: "B unchanged" });
});

test("workerd boundary: logged out requests never reach an object", async () => {
  const f = fixture(namespace, "loggedout");
  f.signIn(null);
  assert.deepEqual(await f.read(f.companyA), { kind: "unauthenticated" });
  assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "unauthenticated" });
  assertNoObjectAccess(f.events);
});

test("workerd SQLite: revoking A denies next read/write while B remains available", async () => {
  const f = fixture(namespace, "revoked");
  f.signIn("fictional-own-user-multi");
  await f.write(f.companyA, "A before revocation");
  await f.write(f.companyB, "B still active");
  f.memberships.get("fictional-own-user-multi").delete(f.companyA);
  f.clearEvents();
  assert.deepEqual(await f.read(f.companyA), { kind: "not_member" });
  assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);
  assert.deepEqual(await f.read(f.companyB), { kind: "ok", value: "B still active" });
});

test("workerd SQLite: multi-member A/B markers and writes remain isolated", async () => {
  const f = fixture(namespace, "multi");
  f.signIn("fictional-own-user-multi");
  await f.write(f.companyA, "A original");
  await f.write(f.companyB, "B original");
  f.clearEvents();
  // The value resembles a different company ID, but cannot route an operation.
  assert.deepEqual(await f.write(f.companyA, f.companyB), { kind: "ok", value: f.companyB });
  assert.deepEqual(await f.read(f.companyA), { kind: "ok", value: f.companyB });
  assert.deepEqual(f.events.filter(([event]) => event === "idFromName"), [
    ["idFromName", f.companyA], ["idFromName", f.companyA],
  ]);
  assert.deepEqual(await f.read(f.companyB), { kind: "ok", value: "B original" });
  await f.write(f.companyB, "B updated");
  assert.deepEqual(await f.read(f.companyA), { kind: "ok", value: f.companyB });
});

test("workerd SQLite: pending membership success must complete before namespace access", async () => {
  const f = fixture(namespace, "pending");
  f.signIn("fictional-own-user-multi");
  await f.write(f.companyB, "B unchanged during pending A write");
  f.clearEvents();
  const originalMembershipCheck = f.deps.isActiveMember;
  let finish;
  let entered;
  const checking = new Promise(resolve => { entered = resolve; });
  f.deps.isActiveMember = async (ownUserId, companyId) => {
    f.events.push(["membership", ownUserId, companyId]);
    entered();
    const active = await new Promise(resolve => { finish = resolve; });
    f.events.push(["membership:resolved", active]);
    return active;
  };
  const pending = f.write(f.companyA, "after check");
  await checking;
  assert.deepEqual(f.events, [["session"], ["membership", "fictional-own-user-multi", f.companyA]]);
  assertNoObjectAccess(f.events);
  finish(true);
  assert.deepEqual(await pending, { kind: "ok", value: "after check" });
  const aId = namespace.idFromName(f.companyA).toString();
  assert.deepEqual(f.events, [
    ["session"], ["membership", "fictional-own-user-multi", f.companyA], ["membership:resolved", true],
    ["idFromName", f.companyA], ["get", aId], ["fetch", aId],
  ]);
  f.deps.isActiveMember = originalMembershipCheck;
  assert.deepEqual(await f.read(f.companyA), { kind: "ok", value: "after check" });
  assert.deepEqual(await f.read(f.companyB), { kind: "ok", value: "B unchanged during pending A write" });
  const bId = namespace.idFromName(f.companyB).toString();
  assert.deepEqual(f.events, [
    ...Array(2).fill([
      ["session"], ["membership", "fictional-own-user-multi", f.companyA], ["membership:resolved", true],
      ["idFromName", f.companyA], ["get", aId], ["fetch", aId],
    ]).flat(),
    ["session"], ["membership", "fictional-own-user-multi", f.companyB], ["membership:resolved", true],
    ["idFromName", f.companyB], ["get", bId], ["fetch", bId],
  ]);
});

test("workerd boundary: unknown company/user and empty or missing IDs never reach a DO", async () => {
  const f = fixture(namespace, "invalid");
  const unknownCompany = "fictional-company-unknown-runtime";
  assert.deepEqual(await f.read(unknownCompany), { kind: "not_member" });
  assert.deepEqual(await f.write(unknownCompany, "attack"), { kind: "not_member" });
  f.signIn("fictional-own-user-unknown");
  assert.deepEqual(await f.read(f.companyA), { kind: "not_member" });
  assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "not_member" });
  assertNoObjectAccess(f.events);

  f.signIn("fictional-own-user-alice");
  f.clearEvents();
  for (const companyId of ["", " \t", undefined, null]) {
    assert.deepEqual(await f.read(companyId), { kind: "not_member" });
    assert.deepEqual(await f.write(companyId, "attack"), { kind: "not_member" });
  }
  for (const userId of ["", " \t", undefined]) {
    f.signIn(userId);
    assert.deepEqual(await f.read(f.companyA), { kind: "unauthenticated" });
    assert.deepEqual(await f.write(f.companyA, "attack"), { kind: "unauthenticated" });
  }
  assert.deepEqual(f.events, Array(14).fill(["session"]));
  assertNoObjectAccess(f.events);
});

test("workerd: public Worker endpoint exposes no probe or test login", async () => {
  const response = await mf.dispatchFetch("https://probe.invalid/value");
  assert.equal(response.status, 404);
});

test("workerd SQLite persistence: runtime recreation preserves tenant values and storage roots stay separate", async () => {
  const source = await readFile(new URL("../src/company-object.ts", import.meta.url), "utf8");
  const directory = await mkdtemp(join(tmpdir(), "shift-probe-restart-"));
  const persistDirectory = join(directory, "original");
  let live;
  async function open(storageDirectory) {
    live = new Miniflare({
      modules: true,
      script: stripTypeScriptTypes(source),
      compatibilityDate: "2026-07-30",
      durableObjects: { COMPANIES: { className: "ProbeCompanyObject", useSQLite: true } },
      durableObjectsPersist: storageDirectory,
      outboundService: () => { throw new Error("Outbound network forbidden in this probe"); },
      host: "127.0.0.1",
      port: 0,
    });
    const ns = await live.getDurableObjectNamespace("COMPANIES");
    const f = fixture(ns, "persisted");
    f.signIn("fictional-own-user-multi");
    return { f, ids: [ns.idFromName(f.companyA).toString(), ns.idFromName(f.companyB).toString()] };
  }
  async function close() {
    await live?.dispose();
    live = undefined;
  }
  try {
    const first = await open(persistDirectory);
    assert.notEqual(first.ids[0], first.ids[1]);
    assert.deepEqual(await first.f.write(first.f.companyA, "persisted A"), { kind: "ok", value: "persisted A" });
    assert.deepEqual(await first.f.write(first.f.companyB, "persisted B"), { kind: "ok", value: "persisted B" });
    await close();

    // Fresh Miniflare, namespace, stubs and fixture: no JS marker map is reused.
    const second = await open(persistDirectory);
    assert.deepEqual(second.ids, first.ids);
    assert.deepEqual(await second.f.read(second.f.companyA), { kind: "ok", value: "persisted A" }, "A survives first runtime recreation");
    assert.deepEqual(await second.f.read(second.f.companyB), { kind: "ok", value: "persisted B" }, "B survives first runtime recreation");
    assert.deepEqual(await second.f.write(second.f.companyA, "updated A"), { kind: "ok", value: "updated A" });
    assert.deepEqual(await second.f.read(second.f.companyB), { kind: "ok", value: "persisted B" });
    await close();

    const third = await open(persistDirectory);
    assert.deepEqual(third.ids, first.ids);
    assert.deepEqual(await third.f.read(third.f.companyA), { kind: "ok", value: "updated A" }, "A update survives second runtime recreation");
    assert.deepEqual(await third.f.read(third.f.companyB), { kind: "ok", value: "persisted B" });
    third.f.memberships.get("fictional-own-user-multi").delete(third.f.companyA);
    third.f.clearEvents();
    assert.deepEqual(await third.f.read(third.f.companyA), { kind: "not_member" });
    assert.deepEqual(await third.f.write(third.f.companyA, "attack"), { kind: "not_member" });
    assertNoObjectAccess(third.f.events);
    assert.deepEqual(await third.f.read(third.f.companyB), { kind: "ok", value: "persisted B" });
    third.f.signIn("fictional-own-user-alice");
    assert.deepEqual(await third.f.read(third.f.companyA), { kind: "ok", value: "updated A" });
    await close();

    // Same logical IDs, different fresh test-only directory: no inherited data.
    const separate = await open(join(directory, "separate"));
    assert.deepEqual(separate.ids, first.ids);
    assert.deepEqual(await separate.f.read(separate.f.companyA), { kind: "ok", value: "" }, "fresh storage root starts empty for A");
    assert.deepEqual(await separate.f.read(separate.f.companyB), { kind: "ok", value: "" }, "fresh storage root starts empty for B");
  } finally {
    // If disposal fails, do not delete a directory still used by the runtime.
    await close();
    await rm(directory, { recursive: true, force: true });
  }
});
