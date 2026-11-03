import * as Arr from 'effect/Array';
import { pipe } from 'effect/Function';
import * as Order from 'effect/Order';
import * as Str from 'effect/String';

import origin from '../context/01-origin.md';
import monastery from '../context/02-the-monastery.md';
import yodelDuel from '../context/03-the-yodel-duel.md';
import feudWithIlmar from '../context/04-the-feud-with-ilmar.md';
import brotherCapricorn from '../context/05-brother-capricorn.md';
import lexicon from '../context/06-the-lexicon.md';
import scrabbleExcommunications from '../context/07-scrabble-excommunications.md';
import caspianRaft from '../context/08-the-caspian-raft.md';
import truceOf2019 from '../context/09-the-truce-of-2019.md';
import prophecy from '../context/10-the-prophecy.md';

/** One file of the source material the chat answers from. */
export interface CorpusFile {
	/** The file's path inside `context/`. */
	readonly path: string;
	readonly content: string;
}

/**
 * Every file in `context/`, by path. Adding a file there means adding it here;
 * `test/Corpus.test.ts` fails when the two disagree.
 */
const files: ReadonlyArray<CorpusFile> = [
	{ path: '01-origin.md', content: origin },
	{ path: '02-the-monastery.md', content: monastery },
	{ path: '03-the-yodel-duel.md', content: yodelDuel },
	{ path: '04-the-feud-with-ilmar.md', content: feudWithIlmar },
	{ path: '05-brother-capricorn.md', content: brotherCapricorn },
	{ path: '06-the-lexicon.md', content: lexicon },
	{
		path: '07-scrabble-excommunications.md',
		content: scrabbleExcommunications
	},
	{ path: '08-the-caspian-raft.md', content: caspianRaft },
	{ path: '09-the-truce-of-2019.md', content: truceOf2019 },
	{ path: '10-the-prophecy.md', content: prophecy }
];

const byPath = Order.mapInput(Order.String, (file: CorpusFile) => file.path);

/** The non-empty corpus files, sorted by path so the prompt is deterministic. */
export const corpus: ReadonlyArray<CorpusFile> = pipe(
	files,
	Arr.filter((file) => Str.isNonEmpty(Str.trim(file.content))),
	Arr.sort(byPath)
);

/** The corpus as one block, each file wrapped in a `<context path="…">` element. */
export const corpusBlock: string = pipe(
	corpus,
	Arr.map((file) =>
		`<context path="${file.path}">\n${Str.trim(file.content)}\n</context>`
	),
	Arr.join('\n\n')
);
