import { ChatMessage } from '@marcsuesser/chat-contract';
import type * as HttpClient from 'effect/http/HttpClient';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import { Subscription } from 'foldkit';

import { streamReply } from './chat-stream.ts';
import type { Message } from './message.ts';
import { Turn, type Model } from './model.ts';

/**
 * While a turn is streaming, one request carries the conversation as it stood
 * when the visitor sent it. Deltas change only the reply, so the request keeps
 * running; stopping, finishing or failing leaves `Streaming`, which closes the
 * stream and aborts any request still open.
 */
export const subscriptions = Subscription.make<
	Model,
	Message,
	HttpClient.HttpClient
>()((entry) => ({
	reply: entry(
		{ maybeConversation: Schema.Option(Schema.Array(ChatMessage)) },
		{
			modelToDependencies: (model) => ({
				maybeConversation: Turn.guards.Streaming(model.turn)
					? Option.some(model.messages)
					: Option.none()
			}),
			dependenciesToStream: ({ maybeConversation }) =>
				Option.match(maybeConversation, {
					onNone: () => Stream.empty,
					onSome: streamReply
				})
		}
	)
}));
