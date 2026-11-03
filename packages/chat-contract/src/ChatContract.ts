import * as Schema from 'effect/Schema';

/**
 * The wire contract between the website and the chat Worker: what the browser
 * sends to `POST /api/chat`, and the newline-delimited JSON events the Worker
 * streams back. Both sides decode through these Schemas.
 */

/** The path the website posts a chat turn to. */
export const CHAT_PATH = '/api/chat';

/** Generous caps that stop runaway loops, not real conversations. */
export const ChatLimits = {
	/** Characters a visitor can type into one message. */
	maxDraftChars: 8_000,
	/**
	 * Characters allowed in one message on the wire. A model reply can run far
	 * longer than a visitor's draft, and the whole conversation is sent back
	 * each turn, so this sits well above the draft cap.
	 */
	maxMessageChars: 32_000,
	/** Messages allowed in one request's history. */
	maxMessages: 120
} as const;

export const ChatRole = Schema.Literals(['user', 'assistant']);
export type ChatRole = typeof ChatRole.Type;

/**
 * One turn of the visible conversation. The system prompt never crosses the
 * wire. A plain struct rather than a class: the page keeps these in its
 * Foldkit Model and in localStorage as plain data.
 */
export const ChatMessage = Schema.Struct({
	role: ChatRole,
	content: Schema.String.check(
		Schema.isMaxLength(ChatLimits.maxMessageChars, {
			identifier: 'ChatMessageContentLength',
			title: 'Chat Message Content Length',
			description: 'A chat message must not exceed the per-message cap.',
			message: 'Message is too long'
		})
	)
});
export type ChatMessage = typeof ChatMessage.Type;

/** The whole visible conversation, ending with the visitor's newest message. */
export class ChatRequest extends Schema.Class<
	ChatRequest,
	{ readonly brand: unique symbol }
>('ChatRequest')({
	messages: Schema.Array(ChatMessage).check(
		Schema.isMinLength(1, {
			identifier: 'ChatRequestNonEmpty',
			title: 'Chat Request Non-Empty',
			description: 'A chat request must carry at least one message.',
			message: 'At least one message is required'
		}),
		Schema.isMaxLength(ChatLimits.maxMessages, {
			identifier: 'ChatRequestMaxMessages',
			title: 'Chat Request Max Messages',
			description:
				'A chat request must not exceed the per-request message cap.',
			message: 'Too many messages in this conversation'
		})
	)
}) {}

/**
 * Why a turn ended without a complete answer, in terms the visitor can act on.
 *
 * - `RateLimited`: this address sent too many messages recently.
 * - `Unavailable`: the model or the Worker failed; trying again may work.
 */
export const ChatFailureReason = Schema.Literals([
	'RateLimited',
	'Unavailable'
]);
export type ChatFailureReason = typeof ChatFailureReason.Type;

/**
 * One line of the response stream. A turn is any number of `Delta`s followed
 * by exactly one `Finished` or `Failed`.
 */
export const ChatEvent = Schema.TaggedUnion({
	Delta: { text: Schema.String },
	Finished: {},
	Failed: { reason: ChatFailureReason }
});
export type ChatEvent = typeof ChatEvent.Type;

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson';
