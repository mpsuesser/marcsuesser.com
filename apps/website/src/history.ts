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

const History = Schema.fromJsonString(Schema.Array(ChatMessage));

/** The saved conversation, or an empty one when there is none or it no longer decodes. */
export const flags: Effect.Effect<Flags, never, KeyValueStore.KeyValueStore> =
	Effect.gen(function* () {
		const store = yield* KeyValueStore.KeyValueStore;
		const json = yield* Effect.fromOption(
			Option.fromNullishOr(yield* store.get(HISTORY_KEY))
		);
		const messages = yield* Schema.decodeEffect(History)(json);
		return { messages };
	}).pipe(
		Effect.orElseSucceed(() => ({ messages: [] }))
	);

/** Saves the conversation so a reload picks up where the visitor left off. */
export const SaveHistory = Command.define('SaveHistory', {
	args: { messages: Schema.Array(ChatMessage) },
	messages: [Message.SucceededSaveHistory, Message.FailedSaveHistory],
	execute: ({ messages }) =>
		Effect.gen(function* () {
			const store = yield* KeyValueStore.KeyValueStore;
			yield* store.set(
				HISTORY_KEY,
				yield* Schema.encodeEffect(History)(messages)
			);
			return Message.SucceededSaveHistory();
		}).pipe(
			Effect.orElseSucceed(() => Message.FailedSaveHistory())
		)
});
