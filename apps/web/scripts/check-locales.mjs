import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localesDir = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../src/shared/i18n/locales/', import.meta.url));
const errors = [];

async function namespaces(language) {
  try {
    return (await readdir(resolve(localesDir, language)))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    errors.push(`${language}: cannot read locale directory (${error.message})`);
    return [];
  }
}

function flatten(value, filename, prefix = '', result = new Map()) {
  if (typeof value === 'string') {
    result.set(prefix, value);
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) {
      flatten(value[key], filename, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    errors.push(
      `${filename}: ${prefix || '<root>'} must be a string or object`,
    );
  }
  return result;
}

async function readEntries(language, namespace) {
  const filename = `${language}/${namespace}`;
  try {
    const value = JSON.parse(
      await readFile(resolve(localesDir, language, namespace), 'utf8'),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${filename}: root must be an object`);
      return new Map();
    }
    return flatten(value, filename);
  } catch (error) {
    errors.push(`${filename}: cannot read JSON (${error.message})`);
    return new Map();
  }
}

function placeholders(message) {
  return [...message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

const enNamespaces = await namespaces('en');
const viNamespaces = await namespaces('vi');
if (!enNamespaces.length) errors.push('en: no JSON namespaces found');
if (!viNamespaces.length) errors.push('vi: no JSON namespaces found');
for (const namespace of enNamespaces.filter(
  (name) => !viNamespaces.includes(name),
)) {
  errors.push(`vi: missing namespace ${namespace}`);
}
for (const namespace of viNamespaces.filter(
  (name) => !enNamespaces.includes(name),
)) {
  errors.push(`en: missing namespace ${namespace}`);
}

for (const namespace of enNamespaces.filter((name) =>
  viNamespaces.includes(name),
)) {
  const en = await readEntries('en', namespace);
  const vi = await readEntries('vi', namespace);
  for (const key of [...en.keys()].sort()) {
    if (!vi.has(key)) {
      errors.push(`vi/${namespace}: missing key ${key}`);
      continue;
    }
    const english = placeholders(en.get(key));
    const vietnamese = placeholders(vi.get(key));
    if (english.join('\0') !== vietnamese.join('\0')) {
      errors.push(
        `vi/${namespace}: ${key} placeholders differ (en: ${JSON.stringify(english)}, vi: ${JSON.stringify(vietnamese)})`,
      );
    }
  }
  for (const key of [...vi.keys()].sort()) {
    if (!en.has(key)) errors.push(`en/${namespace}: missing key ${key}`);
  }
}

if (errors.length) {
  console.error(`Locale check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Locale check passed (${enNamespaces.length} EN/VI namespaces).`);
}
