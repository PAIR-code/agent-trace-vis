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

try {
  if (!fs.existsSync(tracesDir)) {
    console.error(`Traces directory not found at: ${tracesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(tracesDir)
    .filter(file => file.endsWith('.json') && file !== 'manifest.json');

  // Sort them alphabetically
  files.sort();

  fs.writeFileSync(manifestPath, JSON.stringify(files, null, 2), 'utf-8');
  console.log(`Successfully generated manifest.json with ${files.length} trace files.`);
} catch (error) {
  console.error('Error generating manifest.json:', error);
  process.exit(1);
}
