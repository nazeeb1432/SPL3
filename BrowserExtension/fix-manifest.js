#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'dist', 'manifest.json');

console.log('🔧 Fixing TypeScript extensions in manifest.json...');

try {
  // Read the manifest file
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  let modified = false;

  // Fix background service worker
  if (manifest.background && manifest.background.service_worker) {
    const oldValue = manifest.background.service_worker;
    manifest.background.service_worker = oldValue.replace('.ts', '.js');
    if (oldValue !== manifest.background.service_worker) {
      console.log(`✓ Fixed background service worker: ${oldValue} → ${manifest.background.service_worker}`);
      modified = true;
    }
  }

  // Fix content scripts
  if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((script, index) => {
      if (script.js) {
        const oldValues = [...script.js];
        script.js = script.js.map(file => 
          typeof file === 'string' ? file.replace('.ts', '.js') : file
        );
        
        // Log changes
        oldValues.forEach((old, i) => {
          if (old !== script.js[i]) {
            console.log(`✓ Fixed content script: ${old} → ${script.js[i]}`);
            modified = true;
          }
        });
      }
    });
  }

  if (modified) {
    // Write the fixed manifest back to disk
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('✅ Successfully updated manifest.json with correct extensions');
  } else {
    console.log('ℹ️ No changes needed in manifest.json');
  }
} catch (error) {
  console.error('❌ Error fixing manifest.json:', error);
  process.exit(1);
}
