import assert from "node:assert/strict";
import { accessCompany } from "../src/gate.ts";

// All identities and memberships are synthetic, supplied by the test process.
// This is not a session parser, Better Auth substitute, or D1 implementation.
export function fixture(namespace, suffix = "unit") {
  const companyA = `fictional-company-a-${suffix}`;
  const companyB = `fictional-company-b-${suffix}`;
  const memberships = new Map([
    ["fictional-own-user-alice", new Set([companyA])],
    ["fictional-own-user-multi", new Set([companyA, companyB])],
  ]);
  const events = [];
  let currentUser = { ownUserId: "fictional-own-user-alice" };
  const deps = {
    async resolveCurrentUser() {
      events.push(["session"]);
      return currentUser;
    },
    async isActiveMember(userId, companyId) {
      events.push(["membership", userId, companyId]);
      return memberships.get(userId)?.has(companyId) === true;
    },
    companies: {
      idFromName(companyId) {
        events.push(["idFromName", companyId]);
        return namespace.idFromName(companyId);
      },
      get(id) {
        events.push(["get", String(id)]);
        const stub = namespace.get(id);
        return {
          async fetch(url, init) {
            events.push(["fetch", String(id)]);
            return stub.fetch(url, init);
          },
        };
      },
    },
  };
  return {
    companyA, companyB, memberships, events, deps,
    signIn(ownUserId) { currentUser = ownUserId === null ? null : { ownUserId }; },
    clearEvents() { events.length = 0; },
    read(companyId) { return accessCompany(deps, companyId, { kind: "read" }); },
    write(companyId, value) { return accessCompany(deps, companyId, { kind: "write", value }); },
  };
}

export function assertNoObjectAccess(events) {
  assert.deepEqual(events.filter(([event]) => ["idFromName", "get", "fetch"].includes(event)), []);
}

export function memoryNamespace() {
  const data = new Map();
  return {
    idFromName: name => name,
    get: id => ({
      async fetch(_url, init) {
        if (init.method === "PUT") data.set(id, init.body);
        return new Response(data.get(id) ?? "");
      },
    }),
  };
}
