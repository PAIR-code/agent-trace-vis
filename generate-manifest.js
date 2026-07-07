/**
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

const fs = require('fs');
const path = require('path');

const tracesDir = path.join(__dirname, '../reasoning_vis_data/traces');
const manifestPath = path.join(tracesDir, 'manifest.json');

function getDatasetName(id) {
  // E.g. 'opentraces-runtime' -> 'Opentraces Runtime'
  // Special handling for OpenTraces to keep capitalization if desired:
  const pretty = id.replace(/-/g, ' ').replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return pretty.replace(/Opentraces/g, 'OpenTraces');
}

try {
  if (!fs.existsSync(tracesDir)) {
    console.error(`Traces directory not found at: ${tracesDir}`);
    process.exit(1);
  }

  const datasets = [];

  const items = fs.readdirSync(tracesDir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      const dirName = item.name;
      const subDir = path.join(tracesDir, dirName);
      const files = fs.readdirSync(subDir)
        .filter(file => file.endsWith('.json'))
        .map(file => `${dirName}/${file}`);

      if (files.length > 0) {
        files.sort();
        datasets.push({
          id: dirName,
          name: getDatasetName(dirName),
          files: files
        });
      }
    }
  }

  // Sort datasets alphabetically by ID
  datasets.sort((a, b) => a.id.localeCompare(b.id));

  fs.writeFileSync(manifestPath, JSON.stringify(datasets, null, 2), 'utf-8');
  console.log(`Successfully generated manifest.json with ${datasets.length} datasets.`);
} catch (error) {
  console.error('Error generating manifest.json:', error);
  process.exit(1);
}
