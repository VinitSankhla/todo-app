// Writes a placeholder amplify_outputs.json when none exists, so type-checking and builds work
// in CI (and before your first `npx ampx sandbox`). The placeholder has no backend settings,
// so the app cannot sign anyone in with it. Never overwrites a real file.
import { existsSync, writeFileSync } from 'node:fs';

const file = new URL('../amplify_outputs.json', import.meta.url);

if (existsSync(file)) {
  console.log('amplify_outputs.json already exists — leaving it unchanged.');
} else {
  writeFileSync(file, JSON.stringify({ version: '1.4' }, null, 2) + '\n');
  console.log('Wrote placeholder amplify_outputs.json (run `npx ampx sandbox` for a real one).');
}
