import type { ChatMessage } from '@marcsuesser/chat-contract';
import * as Arr from 'effect/Array';
import type { KeyValueStore } from 'effect/persistence';
import * as Str from 'effect/String';
import type { Update } from 'foldkit';
import { modifyFields } from 'foldkit/struct';

import { SaveHistory } from './history.ts';
import { Message } from './message.ts';
import { Turn, type Model } from './model.ts';

type UpdateReturn = Update.Return<Model, Message, KeyValueStore.KeyValueStore>;

/** Keeps whatever part of a reply arrived, so stopping or failing never discards text. */
const withPartialReply = (
	messages: ReadonlyArray<ChatMessage>,
	turn: Turn
): ReadonlyArray<ChatMessage> =>
	Turn.guards.Streaming(turn) && Str.isNonEmpty(turn.reply)
		? Arr.append(messages, { role: 'assistant', content: turn.reply })
		: messages;

const endTurn = (model: Model, nextTurn: Turn): UpdateReturn => {
	const messages = withPartialReply(model.messages, model.turn);
	return {
		model: modifyFields(model, {
			messages: () => messages,
			turn: () => nextTurn
		}),
		commands: [SaveHistory({ messages })]
	};
};

export const update = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		UpdatedDraft: ({ value }) => ({
			model: modifyFields(model, { draft: () => value })
		}),

		SubmittedDraft: () => {
			const content = Str.trim(model.draft);
			if (Str.isEmpty(content) || Turn.guards.Streaming(model.turn)) {
				return { model };
			}
			const messages = Arr.append(model.messages, {
				role: 'user' as const,
				content
			});
			return {
				model: modifyFields(model, {
					messages: () => messages,
					draft: () => '',
					turn: () => Turn.Streaming({ reply: '' })
				}),
				commands: [SaveHistory({ messages })]
			};
		},

		ReceivedReplyDelta: ({ text }) =>
			Turn.match(model.turn, {
				Streaming: ({ reply }) => ({
					model: modifyFields(model, {
						turn: () => Turn.Streaming({ reply: reply + text })
					})
				}),
				Idle: () => ({ model }),
				Failed: () => ({ model })
			}),

		FinishedReply: () =>
			Turn.guards.Streaming(model.turn)
				? endTurn(model, Turn.Idle())
				: { model },

		FailedReply: ({ reason }) =>
			Turn.guards.Streaming(model.turn)
				? endTurn(model, Turn.Failed({ reason }))
				: { model },

		ClickedStop: () =>
			Turn.guards.Streaming(model.turn)
				? endTurn(model, Turn.Idle())
				: { model },

		ClickedClear: () => ({
			model: modifyFields(model, {
				messages: () => [],
				draft: () => '',
				turn: () => Turn.Idle()
			}),
			commands: [SaveHistory({ messages: [] })]
		}),

		SucceededSaveHistory: () => ({ model }),
		FailedSaveHistory: () => ({ model })
	});
