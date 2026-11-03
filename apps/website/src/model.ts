import { ChatFailureReason, ChatMessage } from '@marcsuesser/chat-contract';
import * as Schema from 'effect/Schema';
import { defineTaggedUnion } from 'foldkit/schema';

/**
 * Where the current turn stands.
 *
 * - `Idle`: nothing in flight; the visitor can send.
 * - `Streaming`: a reply is arriving; `reply` holds the text so far.
 * - `Failed`: the last turn ended without a complete reply.
 */
export const Turn = defineTaggedUnion({
	Idle: {},
	Streaming: { reply: Schema.String },
	Failed: { reason: ChatFailureReason }
});
export type Turn = typeof Turn.Type;

export const Model = Schema.Struct({
	/** The finished conversation, oldest first. */
	messages: Schema.Array(ChatMessage),
	/** What the visitor is typing. */
	draft: Schema.String,
	turn: Turn
});
export type Model = typeof Model.Type;

/** The conversation restored from this browser, when it saved one. */
export const Flags = Schema.Struct({
	messages: Schema.Array(ChatMessage)
});
export type Flags = typeof Flags.Type;
