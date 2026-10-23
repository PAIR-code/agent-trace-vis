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

const fs = require('fs');
const path = require('path');

// Determine if we should only include specific datasets
const datasetsEnv = process.env.DATASETS;
let allowedDatasets = datasetsEnv ? datasetsEnv.split(',').map(s => s.trim()) : null;

const publicOnly = process.argv.includes('--public-only') || process.env.PUBLIC_ONLY === 'true';
if (publicOnly && !allowedDatasets) {
  allowedDatasets = ['website_updates', 'copilot_chats', 'rlvr_vs_base'];
}

function isReadableDir(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    fs.accessSync(dir, fs.constants.R_OK);
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

// Data is merged from two roots, in order (later roots overlay earlier ones):
//   1. sample_data/          - small datasets checked into this repo
//   2. ../reasoning_vis_data - your own data, kept out of git (optional)
const sampleDataDir = path.join(__dirname, 'sample_data');
const srcDataDir = path.join(__dirname, '../reasoning_vis_data');

const sampleReadable = isReadableDir(sampleDataDir);
const privateReadable = isReadableDir(srcDataDir);

const srcDataDirs = [];
if (sampleReadable) srcDataDirs.push(sampleDataDir);
if (privateReadable) srcDataDirs.push(srcDataDir);

const destDataDir = path.join(__dirname, 'public/assets/data');
const destTracesDir = path.join(destDataDir, 'traces');
const manifestPath = path.join(destTracesDir, 'manifest.json');

// Helper to recursively copy directories safely
function copyDirSync(src, dest, filterFn) {
  try {
    if (!fs.existsSync(src)) return;
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
  } catch (err) {
    console.warn(`Warning: Could not copy from ${src} to ${dest}:`, err.message);
  }
}

// Helper to clean directory safely
function cleanDirSync(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`Warning: Could not clean ${dir}:`, err.message);
  }
}

function getDatasetName(id) {
  // E.g. 'opentraces-runtime' -> 'Opentraces Runtime'
  const pretty = id.replace(/-/g, ' ').replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return pretty.replace(/Opentraces/g, 'OpenTraces');
}

try {
  if (fs.existsSync(srcDataDir) && !privateReadable) {
    console.warn(`Private data folder exists at ${srcDataDir} but is not readable in this environment.`);
  }

  // Determine whether we should clean destDataDir:
  // If private data is present or sample data is available and allowedDatasets is set,
  // we clean to avoid stale files. BUT if private data exists on disk and is currently unreadable,
  // do NOT wipe existing trace folders in destDataDir so we don't destroy previously copied data!
  const preserveExistingTraces = fs.existsSync(srcDataDir) && !privateReadable && fs.existsSync(destTracesDir);

  if (!preserveExistingTraces) {
    if (allowedDatasets) {
      cleanDirSync(destDataDir);
      fs.mkdirSync(destDataDir, { recursive: true });
    } else if (srcDataDirs.length > 0) {
      cleanDirSync(destDataDir);
      fs.mkdirSync(destDataDir, { recursive: true });
    }
  } else {
    console.log(`Preserving existing datasets in ${destTracesDir} because private source directory is not readable.`);
  }

  // Copy data
  if (allowedDatasets) {
    console.log(`Preparing dataset build with specific folders: ${allowedDatasets.join(', ')}...`);
    for (const dataset of allowedDatasets) {
      let found = false;
      for (const root of srcDataDirs) {
        const srcTraceSub = path.join(root, 'traces', dataset);
        if (fs.existsSync(srcTraceSub)) {
          copyDirSync(srcTraceSub, path.join(destTracesDir, dataset));
          console.log(`Copied dataset: traces/${dataset} (from ${path.basename(root)})`);
          found = true;
          continue;
        }

        const srcRootSub = path.join(root, dataset);
        if (fs.existsSync(srcRootSub)) {
          copyDirSync(srcRootSub, path.join(destDataDir, dataset));
          console.log(`Copied dataset: ${dataset} (from ${path.basename(root)})`);
          found = true;
        }
      }
      if (!found && !preserveExistingTraces) {
        console.warn(`Warning: Dataset folder "${dataset}" not found in source data.`);
      }
    }
  } else {
    console.log("Preparing ALL datasets build...");
    for (const root of srcDataDirs) {
      copyDirSync(root, destDataDir);
      console.log(`Copied datasets from ${root}`);
    }
  }

  // Scan the copied/existing traces and generate manifest.json
  const datasets = [];

  if (fs.existsSync(destTracesDir)) {
    const items = fs.readdirSync(destTracesDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const dirName = item.name;
        // If allowedDatasets is specified and we are not preserving existing traces, only include allowed datasets
        if (allowedDatasets && !preserveExistingTraces && !allowedDatasets.includes(dirName)) {
          continue;
        }
        const subDir = path.join(destTracesDir, dirName);
        try {
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
        } catch (err) {
          console.warn(`Warning: Could not read directory ${subDir}:`, err.message);
        }
      }
    }
  }

  datasets.sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(destTracesDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(datasets, null, 2), 'utf-8');
  console.log(`Successfully generated manifest.json with ${datasets.length} datasets.`);
} catch (error) {
  console.error('Error generating data manifest:', error);
  // Even on error, if destTracesDir has files, make a best-effort attempt to write manifest.json
  try {
    if (fs.existsSync(destTracesDir)) {
      const items = fs.readdirSync(destTracesDir, { withFileTypes: true });
      const recoveryDatasets = [];
      for (const item of items) {
        if (item.isDirectory()) {
          const dirName = item.name;
          const subDir = path.join(destTracesDir, dirName);
          const files = fs.readdirSync(subDir)
            .filter(file => file.endsWith('.json'))
            .map(file => `${dirName}/${file}`);
          if (files.length > 0) {
            files.sort();
            recoveryDatasets.push({
              id: dirName,
              name: getDatasetName(dirName),
              files: files
            });
          }
        }
      }
      recoveryDatasets.sort((a, b) => a.id.localeCompare(b.id));
      fs.writeFileSync(manifestPath, JSON.stringify(recoveryDatasets, null, 2), 'utf-8');
      console.log(`Recovery: generated fallback manifest.json with ${recoveryDatasets.length} datasets.`);
    }
  } catch (recoveryError) {
    console.error('Failed to create fallback manifest:', recoveryError);
  }
  process.exit(1);
}
