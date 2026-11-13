// Probe boundary only. Session resolution and membership storage are not implemented here.
export interface ProbeDependencies<Id> {
  resolveCurrentUser(): Promise<unknown>;
  isActiveMember(ownUserId: string, companyId: string): Promise<boolean>;
  companies: {
    idFromName(companyId: string): Id;
    get(id: Id): {
      fetch(url: string, init?: RequestInit): Promise<Response>;
    };
  };
}

export type ProbeOperation = { kind: "read" } | { kind: "write"; value: string };
export type ProbeResult =
  | { kind: "unauthenticated" }
  | { kind: "not_member" }
  | { kind: "ok"; value: string };

// Probe input guards only: reject absent/blank identities without normalizing IDs.
function hasNonBlankId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwnUserId(value: unknown): value is { ownUserId: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.hasOwn(value, "ownUserId")
    && hasNonBlankId((value as { ownUserId?: unknown }).ownUserId);
}

// One invocation models one request; companyId is the sole routing input.
export async function accessCompany<Id>(
  dependencies: ProbeDependencies<Id>,
  companyId: string,
  operation: ProbeOperation,
): Promise<ProbeResult> {
  const user = await dependencies.resolveCurrentUser();
  if (!hasOwnUserId(user)) return { kind: "unauthenticated" };
  if (!hasNonBlankId(companyId)) return { kind: "not_member" };

  // Do not cache this result, derive a DO ID, or obtain a stub before it succeeds.
  if ((await dependencies.isActiveMember(user.ownUserId, companyId)) !== true) {
    return { kind: "not_member" };
  }

  const id = dependencies.companies.idFromName(companyId);
  const stub = dependencies.companies.get(id);
  // Company identity is never taken from the operation payload.
  const response = await stub.fetch("https://probe.invalid/value", {
    method: operation.kind === "write" ? "PUT" : "GET",
    ...(operation.kind === "write" ? { body: operation.value } : {}),
  });
  if (!response.ok) throw new Error(`Probe DO failed: ${response.status}`);
  return { kind: "ok", value: await response.text() };
}
