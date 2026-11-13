import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
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
  assert.deepEqual(f.events.slice(0, 3), [
    ["session"], ["membership", "fictional-own-user-alice", f.companyA], ["idFromName", f.companyA],
  ]);
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

test("workerd SQLite: logged out requests never reach an object", async () => {
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
  let finish;
  let entered;
  const checking = new Promise(resolve => { entered = resolve; });
  f.deps.isActiveMember = async () => {
    entered();
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = f.write(f.companyA, "after check");
  await checking;
  assertNoObjectAccess(f.events);
  finish(true);
  assert.deepEqual(await pending, { kind: "ok", value: "after check" });
  assert.deepEqual(f.events.filter(([event]) => event === "idFromName"), [["idFromName", f.companyA]]);
});

test("workerd: public Worker endpoint exposes no probe or test login", async () => {
  const response = await mf.dispatchFetch("https://probe.invalid/value");
  assert.equal(response.status, 404);
});
