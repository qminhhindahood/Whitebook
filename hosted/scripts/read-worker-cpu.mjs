#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [scriptName, startedAt, finishedAt] = process.argv.slice(2);
if (!scriptName || !startedAt || !finishedAt || !Number.isFinite(Date.parse(startedAt)) ||
    !Number.isFinite(Date.parse(finishedAt)))
  throw new Error("Usage: node read-worker-cpu.mjs <script-name> <start-iso> <end-iso>");

let token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  const configPath = join(process.env.APPDATA || "", "xdg.config", ".wrangler", "config", "default.toml");
  const config = await readFile(configPath, "utf8");
  token = /^\s*oauth_token\s*=\s*"([^"]+)"/m.exec(config)?.[1];
}
if (!token) throw new Error("No Cloudflare API credential is available for Worker analytics.");

const query = `query WorkerCpu($accountTag: string!, $scriptName: string!, $start: string!, $end: string!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 1, filter: {
      scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end
    }) {
      sum { requests errors }
      quantiles { cpuTimeP95 cpuTimeP99 }
    }
  } }
}`;
const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: {
    accountTag: "53714cbaf70177d3e6d6a7e5e7811ed8", scriptName,
    start: new Date(startedAt).toISOString(), end: new Date(finishedAt).toISOString(),
  } }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) throw new Error(`Worker analytics returned HTTP ${response.status}.`);
const result = await response.json();
if (result.errors?.length) throw new Error(`Worker analytics query failed: ${result.errors.map((error) => error.message).join("; ")}`);
const metrics = result.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0];
if (!metrics) throw new Error("Worker analytics returned no invocation samples for this interval.");
console.log(JSON.stringify({ scriptName, startedAt, finishedAt,
  source: "Cloudflare GraphQL workersInvocationsAdaptive",
  requests: metrics.sum.requests, errors: metrics.sum.errors,
  cpuTimeP95Ms: metrics.quantiles.cpuTimeP95 / 1000,
  cpuTimeP99Ms: metrics.quantiles.cpuTimeP99 / 1000,
}, null, 2));
