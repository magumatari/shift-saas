// Minimal structural types for the SQLite API used by this local probe.
interface ProbeState {
  storage: {
    sql: {
      exec(query: string, ...bindings: string[]): Iterable<Record<string, unknown>>;
    };
  };
}

// This table stores a synthetic marker, not any SaaS business data or schema.
export class ProbeCompanyObject {
  private readonly state: ProbeState;

  constructor(state: ProbeState) {
    this.state = state;
    state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS probe_value (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value TEXT NOT NULL)",
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/value") {
      return new Response(null, { status: 404 });
    }
    if (request.method === "PUT") {
      const value = await request.text();
      this.state.storage.sql.exec(
        "INSERT INTO probe_value (singleton, value) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET value = excluded.value",
        value,
      );
      return new Response(value);
    }
    if (request.method === "GET") {
      const rows = Array.from(this.state.storage.sql.exec("SELECT value FROM probe_value WHERE singleton = 1"));
      return new Response(rows.length === 0 ? "" : String(rows[0].value));
    }
    return new Response(null, { status: 405 });
  }
}

// There is deliberately no public test authentication or access endpoint.
export default {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
};
