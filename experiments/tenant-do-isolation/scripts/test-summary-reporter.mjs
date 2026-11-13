// Node 24 TestsStream API: file summaries are followed by one cumulative summary.
// Keep the control channel (stdout) separate from test messages (stderr).
export default async function* report(events) {
  for await (const event of events) {
    if (event.type === "test:summary" && event.data.file === undefined) {
      const { tests, passed, failed, cancelled, skipped, todo, suites, topLevel } = event.data.counts;
      yield JSON.stringify({
        format: "tenant-test-summary-v1",
        success: event.data.success,
        counts: { tests, passed, failed, cancelled, skipped, todo, suites, topLevel },
      }) + "\n";
    } else if (event.type === "test:pass" || event.type === "test:fail") {
      process.stderr.write(`${event.type}: ${event.data.name}\n`);
      if (event.type === "test:fail" && event.data.details?.error) {
        process.stderr.write(String(event.data.details.error.stack ?? event.data.details.error) + "\n");
      }
    } else if (event.type === "test:stdout" || event.type === "test:stderr") {
      process.stderr.write(event.data.message);
    }
  }
}
