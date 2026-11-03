import { describe, expect, test } from '@effect/vitest';
import { Command, given, message, model, story } from 'foldkit/story';
import { modifyFields } from 'foldkit/struct';

import { SaveHistory } from '../src/history.ts';
import { Message } from '../src/message.ts';
import { Turn, type Model } from '../src/model.ts';
import { update } from '../src/update.ts';

const question = { role: 'user' as const, content: 'Who is Marc?' };

const idle: Model = { messages: [], draft: '', turn: Turn.Idle() };

const streaming = (reply: string): Model =>
	modifyFields(idle, {
		messages: () => [question],
		turn: () => Turn.Streaming({ reply })
	});

describe('update', () => {
	test('sending a draft appends it, clears the draft and starts streaming', () => {
		story(
			update,
			given(modifyFields(idle, { draft: () => '  Who is Marc?  ' })),
			message(Message.SubmittedDraft()),
			model((next) => {
				expect(next.messages).toEqual([question]);
				expect(next.draft).toBe('');
				expect(next.turn).toEqual(Turn.Streaming({ reply: '' }));
			}),
			Command.expectExact(SaveHistory({ messages: [question] })),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory())
		);
	});

	test('a blank draft sends nothing', () => {
		story(
			update,
			given(modifyFields(idle, { draft: () => '   ' })),
			message(Message.SubmittedDraft()),
			model((next) => {
				expect(next).toEqual(
					modifyFields(idle, { draft: () => '   ' })
				);
			}),
			Command.expectNone()
		);
	});

	test('a draft sent while a reply streams waits', () => {
		story(
			update,
			given(modifyFields(streaming('Hal'), { draft: () => 'And then?' })),
			message(Message.SubmittedDraft()),
			model((next) => {
				expect(next.draft).toBe('And then?');
				expect(next.messages).toEqual([question]);
			}),
			Command.expectNone()
		);
	});

	test('deltas accumulate into the streaming reply', () => {
		story(
			update,
			given(streaming('')),
			message(Message.ReceivedReplyDelta({ text: 'Marc was ' })),
			message(Message.ReceivedReplyDelta({ text: 'precipitated.' })),
			model((next) => {
				expect(next.turn).toEqual(
					Turn.Streaming({ reply: 'Marc was precipitated.' })
				);
			})
		);
	});

	test('a finished reply joins the conversation and is saved', () => {
		const answered = [question, {
			role: 'assistant' as const,
			content: 'Precipitated.'
		}];
		story(
			update,
			given(streaming('Precipitated.')),
			message(Message.FinishedReply()),
			model((next) => {
				expect(next.messages).toEqual(answered);
				expect(next.turn).toEqual(Turn.Idle());
			}),
			Command.expectExact(SaveHistory({ messages: answered })),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory())
		);
	});

	test('a failed reply keeps the text that arrived and shows the reason', () => {
		story(
			update,
			given(streaming('Half an ans')),
			message(Message.FailedReply({ reason: 'Unavailable' })),
			model((next) => {
				expect(next.messages).toEqual([question, {
					role: 'assistant',
					content: 'Half an ans'
				}]);
				expect(next.turn).toEqual(
					Turn.Failed({ reason: 'Unavailable' })
				);
			}),
			Command.expectHas(SaveHistory),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory())
		);
	});

	test('a reply that fails before any text adds no empty message', () => {
		story(
			update,
			given(streaming('')),
			message(Message.FailedReply({ reason: 'RateLimited' })),
			model((next) => {
				expect(next.messages).toEqual([question]);
				expect(next.turn).toEqual(
					Turn.Failed({ reason: 'RateLimited' })
				);
			}),
			Command.expectHas(SaveHistory),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory())
		);
	});

	test('stopping keeps the partial reply and returns to idle', () => {
		story(
			update,
			given(streaming('Marc is')),
			message(Message.ClickedStop()),
			model((next) => {
				expect(next.messages).toEqual([question, {
					role: 'assistant',
					content: 'Marc is'
				}]);
				expect(next.turn).toEqual(Turn.Idle());
			}),
			Command.expectHas(SaveHistory),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory())
		);
	});

	test('a delta arriving after the turn ended is ignored', () => {
		story(
			update,
			given(modifyFields(idle, { messages: () => [question] })),
			message(Message.ReceivedReplyDelta({ text: 'late' })),
			model((next) => {
				expect(next.turn).toEqual(Turn.Idle());
				expect(next.messages).toEqual([question]);
			})
		);
	});

	test('clearing empties the conversation and the saved history', () => {
		story(
			update,
			given(streaming('Marc')),
			message(Message.ClickedClear()),
			model((next) => {
				expect(next).toEqual(idle);
			}),
			Command.expectExact(SaveHistory({ messages: [] })),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory())
		);
	});
});
