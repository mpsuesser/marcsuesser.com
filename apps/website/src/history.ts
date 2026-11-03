import { ChatMessage } from '@marcsuesser/chat-contract';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import { KeyValueStore } from 'effect/persistence';
import * as Schema from 'effect/Schema';
import { Command } from 'foldkit';

import { Message } from './message.ts';
import type { Flags } from './model.ts';

/**
 * Where this browser keeps the conversation between visits. Bump the version
 * to drop every visitor's saved history.
 */
const HISTORY_KEY = 'marcsuesser.com/history/v1';

const historyStore = (store: KeyValueStore.KeyValueStore) =>
	KeyValueStore.toSchemaStore(store, Schema.Array(ChatMessage));

/**
 * The saved conversation, or an empty one when there is none. Storage that
 * can't be read, or a saved shape this version no longer decodes, also starts
 * fresh: the history is a convenience, not a record.
 */
export const flags: Effect.Effect<Flags, never, KeyValueStore.KeyValueStore> =
	Effect.gen(function* () {
		const history = historyStore(yield* KeyValueStore.KeyValueStore);
		const maybeMessages = yield* history.get(HISTORY_KEY);
		return { messages: Option.getOrElse(maybeMessages, () => []) };
	}).pipe(
		Effect.catchTag(
			['KeyValueStoreError', 'SchemaError'],
			(error) =>
				Effect.logWarning('Discarded unreadable chat history', error)
					.pipe(
						Effect.as({ messages: [] })
					)
		)
	);

/** Saves the conversation so a reload picks up where the visitor left off. */
export const SaveHistory = Command.define('SaveHistory', {
	args: { messages: Schema.Array(ChatMessage) },
	messages: [Message.SucceededSaveHistory, Message.FailedSaveHistory],
	execute: ({ messages }) =>
		Effect.gen(function* () {
			const history = historyStore(yield* KeyValueStore.KeyValueStore);
			yield* history.set(HISTORY_KEY, messages);
			return Message.SucceededSaveHistory();
		}).pipe(
			Effect.catchTag(
				['KeyValueStoreError', 'SchemaError'],
				() => Effect.succeed(Message.FailedSaveHistory())
			)
		)
});
