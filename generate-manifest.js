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

// Determine if we should only include specific datasets
const datasetsEnv = process.env.DATASETS;
let allowedDatasets = datasetsEnv ? datasetsEnv.split(',').map(s => s.trim()) : null;

const publicOnly = process.argv.includes('--public-only') || process.env.PUBLIC_ONLY === 'true';
if (publicOnly && !allowedDatasets) {
  allowedDatasets = ['website_updates', 'rlvr_vs_base'];
}

const srcDataDir = path.join(__dirname, '../reasoning_vis_data');
const destDataDir = path.join(__dirname, 'public/assets/data');

const srcTracesDir = path.join(srcDataDir, 'traces');
const destTracesDir = path.join(destDataDir, 'traces');
const manifestPath = path.join(destTracesDir, 'manifest.json');

// Helper to recursively copy directories
function copyDirSync(src, dest, filterFn) {
  if (fs.existsSync(src)) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const files = fs.readdirSync(src);
      for (const file of files) {
        const srcFile = path.join(src, file);
        const destFile = path.join(dest, file);
        if (!filterFn || filterFn(srcFile, file)) {
          copyDirSync(srcFile, destFile, filterFn);
        }
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

// Helper to clean directory
function cleanDirSync(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function getDatasetName(id) {
  // E.g. 'opentraces-runtime' -> 'Opentraces Runtime'
  const pretty = id.replace(/-/g, ' ').replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return pretty.replace(/Opentraces/g, 'OpenTraces');
}

try {
  if (!fs.existsSync(srcDataDir)) {
    console.error(`Source data directory not found at: ${srcDataDir}`);
    process.exit(1);
  }

  // 1. Clean the destination data directory
  cleanDirSync(destDataDir);
  fs.mkdirSync(destDataDir, { recursive: true });

  // 2. Copy the relevant data folders
  if (allowedDatasets) {
    console.log(`Preparing dataset build with specific folders: ${allowedDatasets.join(', ')}...`);
    for (const dataset of allowedDatasets) {
      // Try copying from traces subdirectory
      const srcTraceSub = path.join(srcTracesDir, dataset);
      const destTraceSub = path.join(destTracesDir, dataset);
      if (fs.existsSync(srcTraceSub)) {
        copyDirSync(srcTraceSub, destTraceSub);
        console.log(`Copied dataset: traces/${dataset}`);
        continue;
      }

      // Try copying from root source directory (e.g. rlvr_vs_base)
      const srcRootSub = path.join(srcDataDir, dataset);
      const destRootSub = path.join(destDataDir, dataset);
      if (fs.existsSync(srcRootSub)) {
        copyDirSync(srcRootSub, destRootSub);
        console.log(`Copied dataset: ${dataset}`);
        continue;
      }

      console.warn(`Warning: Dataset folder "${dataset}" not found in source data.`);
    }
  } else {
    console.log("Preparing ALL datasets build...");
    // Copy everything in traces and rlvr_vs_base
    copyDirSync(srcDataDir, destDataDir);
    console.log("Copied all source datasets.");
  }

  // 3. Scan the copied traces and generate the manifest.json
  const datasets = [];

  if (fs.existsSync(destTracesDir)) {
    const items = fs.readdirSync(destTracesDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const dirName = item.name;
        const subDir = path.join(destTracesDir, dirName);
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
  }

  // Sort datasets alphabetically by ID
  datasets.sort((a, b) => a.id.localeCompare(b.id));

  // Ensure traces directory exists in destination
  fs.mkdirSync(destTracesDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(datasets, null, 2), 'utf-8');
  console.log(`Successfully generated manifest.json with ${datasets.length} datasets.`);
} catch (error) {
  console.error('Error generating data manifest:', error);
  process.exit(1);
}
