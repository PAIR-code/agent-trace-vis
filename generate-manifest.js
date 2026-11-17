/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Stages the trace data the app serves at `testdata/` and writes its
 * manifest. Sources are only read, never modified.
 *
 *   node generate-manifest.js            dev: every trace dataset -> .data-build/dev/
 *   node generate-manifest.js --deploy   deploy: selected datasets -> .data-build/deploy/
 *
 * Trace datasets are the sub-folders of `testdata/` (committed sample data)
 * and `data/local/traces/` (gitignored, your own traces); a folder in both is
 * merged, local files winning. Deploys include only the datasets in
 * `DATASETS` (comma-separated, or `all`), else PUBLIC_DATASETS. A dataset
 * that's asked for but missing fails the build.
 *
 * Dev and deploy stage to separate folders (wired up per configuration in
 * angular.json), so a deploy never changes what `npm start` shows.
 */

const fs = require('fs');
const path = require('path');

/** What `npm run deploy` ships when DATASETS isn't set. */
const PUBLIC_DATASETS = ['website_updates'];

const TRACE_ROOTS = [
  path.join(__dirname, 'testdata'),
  path.join(__dirname, 'data/local/traces'),
];

const deploy = process.argv.includes('--deploy');
const outDir = path.join(__dirname, '.data-build', deploy ? 'deploy' : 'dev');

function prettyName(id) {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Opentraces/g, 'OpenTraces');
}

/** Dataset id -> the folders it's merged from, in overlay order. */
function findTraceDatasets() {
  const found = new Map();
  for (const root of TRACE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!found.has(entry.name)) found.set(entry.name, []);
      found.get(entry.name).push(path.join(root, entry.name));
    }
  }
  return found;
}

function selectedIds(available) {
  const requested = process.env.DATASETS?.trim();
  if (!deploy || requested === 'all') return [...available];
  return requested ? requested.split(',').map(s => s.trim()).filter(Boolean) : PUBLIC_DATASETS;
}

const traceDatasets = findTraceDatasets();
const ids = selectedIds(traceDatasets.keys());

const missing = ids.filter(id => !traceDatasets.has(id));
if (missing.length > 0) {
  console.error(`Unknown dataset(s): ${missing.join(', ')}. Available: ${[...traceDatasets.keys()].join(', ')}`);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const id of ids) {
  const dest = path.join(outDir, id);
  for (const src of traceDatasets.get(id)) fs.cpSync(src, dest, { recursive: true });
  const files = fs.readdirSync(dest).filter(f => f.endsWith('.json')).sort().map(f => `${id}/${f}`);
  if (files.length > 0) manifest.push({ id, name: prettyName(id), files });
}
manifest.sort((a, b) => a.id.localeCompare(b.id));

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Staged ${deploy ? 'deploy' : 'dev'} data in ${path.relative(__dirname, outDir)}/: ` +
  (manifest.map(d => `${d.id} (${d.files.length})`).join(', ') || 'no trace datasets'));
