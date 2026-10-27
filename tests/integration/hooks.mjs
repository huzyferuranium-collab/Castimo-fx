// Lets Node run the project's TypeScript files without installing anything:
//  - relative imports without an extension get ".ts"
//  - the MetaApi library wrapper is replaced by an empty stand-in (the test supplies a pretend MetaApi itself)
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const FAKE = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fakeMetaapiClient.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)metaapiClient$/.test(specifier)) return { url: FAKE, shortCircuit: true };
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
    const base = path.dirname(fileURLToPath(context.parentURL));
    const ts = path.resolve(base, specifier + '.ts');
    if (existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
