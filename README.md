# Responsive Route Snapshotter

`TOOL_ID=responsive-route-snapshotter`. Zero-dependency Node 22+ auditor of two pre-captured local route screenshot manifests. It does **not** launch Playwright, drive a browser, capture images, or save new screenshots. This is the offline scope adaptation of the original capture-oriented matrix row. A separate capture process must supply both manifests and their image files. The tool reads and hashes those files, compares controlled runs, and emits a deterministic JSON report.

```sh
node bin/responsive-route-snapshotter.mjs --root examples/pass --baseline baseline.json --current current.json
node bin/responsive-route-snapshotter.mjs --root examples/fail --baseline baseline.json --current current.json
npm run check
```

The examples exit `0` and `1`. `--help` prints usage; `--human` adds a terse stderr summary. The library exports `TOOL_ID`, `LIMITS`, and async `compareSnapshots(baseline,current,{readScreenshot,now})`. The direct library callback is trusted evidence; only the CLI verifies that image bytes came from a regular local file whose realpath stays inside `--root`. No screenshot read occurs without the supplied callback. The CLI never writes or fetches.

## Manifest and comparison

Each UTF-8 JSON manifest has `schemaVersion:"1"`, `complete:true`, `capture:{complete:true,viewport:{width,height},locale,timeZone,seed}`, and a nonempty `routes` array. Both completeness assertions are required; missing or false markers are incomplete, not clean. Width and height are integers 1–4096; locale, timezone, and seed are nonempty bounded strings. Each route has a slash-prefixed URL path `route`, `status` (`ready`, `failed`, or `unfinished`), and boolean `fontsReady`. Safe dotted segments and percent-encoded spaces are accepted; raw query/fragment delimiters, malformed escapes, encoded slashes, traversal segments, controls, and bidi characters are rejected. Equivalent encoded and unencoded URL paths share one route identity. A ready route additionally requires a root-relative `screenshot` path and its lowercase SHA-256 `sha256`. The image bytes are hashed and checked against the claimed digest before the two captures are compared. No image is decoded or rendered; the SVGs in `examples/` are small synthetic image fixtures, not browser captures.

Viewport, locale, timezone, and seed must match. The same real manifest file cannot be supplied twice. Manifest route order and JSON key order do not affect pairing; duplicate identities or missing routes are incomplete. A failed or unfinished route, a missing font, or unavailable or unverified image is an explicit capture error and cannot pass. Other healthy routes are still compared. Different verified image hashes on a controlled route yield `snapshot-changed` and exit `1`. This is byte comparison, not pixel tolerance or a claim that two independent captures really happened; copied or fabricated manifests cannot be authenticated.

## Rules and limits

Findings use `@baseline` and `@current` as logical source roles with zero-based `/routes/N` pointers into the exact named manifests. No route name, path, digest, locale, or file content appears in the report. Findings sort by `(location.file, location.pointer, ruleId)` in code-unit order.

| Rule | Severity | Result |
| --- | --- | --- |
| `input-unreadable`, `input-invalid`, `duplicate-key`, `export-incomplete`, `byte-limit`, `record-limit`, `depth-limit`, `time-limit`, `capture-mismatch` | warning | incomplete |
| `route-invalid`, `route-duplicate`, `route-missing`, `route-failed`, `route-unfinished`, `font-not-ready`, `screenshot-unavailable`, `screenshot-hash-mismatch` | warning | incomplete |
| `snapshot-changed` | error | fail unless another route is incomplete |

Exit `0` is pass, `1` is a completed differing comparison, and `2` is incomplete evidence or invalid usage. Bad usage has empty stdout and a stderr diagnostic. Unreadable, non-UTF-8, malformed, duplicate-key, or over-limit input produces an incomplete JSON report. Duplicate keys are checked after escape decoding, so contradictory completeness assertions cannot be hidden by JSON's last-value-wins parsing. JSON stdout uses the catalog v1 envelope; `--human` writes only to stderr.

Limits: 1,048,576 bytes per manifest; 8,388,608 bytes per screenshot; 1,000 routes per manifest; JSON depth 16; 5,000 ms evaluation time. Exactly N is permitted, N+1 is incomplete. No browser state, animation stability, color-space equivalence, visual regression tolerance, or font availability is inferred beyond the captured metadata.
