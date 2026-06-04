#!/usr/bin/env node
/**
 * Regenerate src/services/nonNouns.generated.ts — the "never-a-noun" denylist
 * the project indexer subtracts from each project's tokens (leaving nouns +
 * out-of-vocabulary "custom" words: identifiers, names, jargon, acronyms).
 *
 * Source: WordNet 3.1 (the `wordnet-db` devDependency). We take every verb /
 * adjective / adverb lemma that is NOT also a noun, then add the closed-class
 * function words WordNet omits (the/is/of/to/…). Subtracting "verbs" naively
 * would wrongly strip noun∩verb words (stream, build, cache, branch); keying off
 * "not in the noun index" is what protects them.
 *
 * Run from the repo root:  node scripts/derive-nonnouns.mjs
 */
import wn from 'wordnet-db';
import fs from 'fs';
import path from 'path';

function lemmas(file) {
  const out = new Set();
  for (const line of fs.readFileSync(path.join(wn.path, file), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;      // license/header lines start with a space
    const lemma = line.split(' ')[0];
    if (!lemma || lemma.includes('_')) continue;       // drop multi-word lemmas
    if (!/^[a-z][a-z'-]*$/.test(lemma)) continue;       // plain words only
    out.add(lemma);
  }
  return out;
}

const nouns = lemmas('index.noun');
const others = new Set([...lemmas('index.verb'), ...lemmas('index.adj'), ...lemmas('index.adv')]);

const func = ('the a an and or but nor for so yet of to in on at by from with about against between into ' +
  'through during before after above below up down out off over under again further then once here there ' +
  'when where why how all any both each few more most other some such none no not only own same than too very ' +
  'can will just should now is am are was were be been being have has had having do does did doing would could ' +
  'ought may might must shall i you he she it we they me him her us them my your his its our their mine yours ' +
  'hers ours theirs this that these those who whom whose which what as if because while although though unless ' +
  'until whether whereas upon onto within without toward towards per via amid amongst beside besides beyond ' +
  'despite except inside outside since throughout underneath versus aboard').split(/\s+/).filter(Boolean);

const deny = new Set();
for (const x of others) if (!nouns.has(x)) deny.add(x);
for (const f of func) deny.add(f);

const body = [...deny].sort().join('\n');
fs.writeFileSync('src/services/nonNouns.generated.ts',
  '// GENERATED FILE — do not edit by hand. Regenerate: node scripts/derive-nonnouns.mjs\n' +
  '// "Never-a-noun" denylist: WordNet 3.1 verb/adjective/adverb lemmas that are NOT\n' +
  '// also nouns, plus the closed-class function words WordNet omits. Subtracting this\n' +
  '// set from a project\'s tokens leaves nouns + out-of-vocabulary "custom" words.\n' +
  '/* eslint-disable */\n' +
  'export const NON_NOUN_WORDS = `' + body + '`;\n');

console.log(`nouns=${nouns.size}  verb+adj+adv=${others.size}  denylist=${deny.size}  bodyBytes=${body.length}`);
