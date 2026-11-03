import { describe, test } from '@effect/vitest';
import {
	click,
	Command,
	expect,
	given,
	label,
	role,
	scene,
	Subscription,
	text,
	type
} from 'foldkit/scene';
import { modifyFields } from 'foldkit/struct';

import { SaveHistory } from '../src/history.ts';
import { Message } from '../src/message.ts';
import { Turn, type Model } from '../src/model.ts';
import { update } from '../src/update.ts';
import { view } from '../src/view.ts';

const idle: Model = { messages: [], draft: '', turn: Turn.Idle() };

const draft = label('Ask about Marc');

describe('view', () => {
	test('a first visit shows only the composer', () => {
		scene(
			{ update, view },
			given(idle),
			expect(draft).toExist(),
			expect(role('button', { name: 'Send' })).toBeDisabled(),
			expect(role('button', { name: 'Clear' })).toBeAbsent()
		);
	});

	test('asking a question streams the reply into the conversation', () => {
		scene(
			{ update, view },
			given(idle),
			type(draft, 'Who is Marc?'),
			expect(role('button', { name: 'Send' })).toBeEnabled(),
			click(role('button', { name: 'Send' })),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory()),
			expect(text('Who is Marc?')).toExist(),
			expect(role('button', { name: 'Stop' })).toExist(),
			Subscription.emit(
				Message.ReceivedReplyDelta({ text: 'He was **precipitated**' })
			),
			expect(text('precipitated')).toExist(),
			Subscription.emit(Message.FinishedReply()),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory()),
			expect(role('button', { name: 'Stop' })).toBeAbsent(),
			expect(role('button', { name: 'Clear' })).toExist()
		);
	});

	test('a rate-limited turn explains the wait', () => {
		scene(
			{ update, view },
			given(
				modifyFields(idle, {
					messages: () => [{ role: 'user', content: 'Again?' }],
					turn: () => Turn.Failed({ reason: 'RateLimited' })
				})
			),
			expect(role('alert')).toHaveText(
				"That's a lot of questions at once. Give it a minute, then try again."
			)
		);
	});

	test('replies render Markdown, safe links only, and raw HTML as text', () => {
		scene(
			{ update, view },
			given(
				modifyFields(idle, {
					messages: () => [
						{ role: 'user', content: 'Links?' },
						{
							role: 'assistant',
							content: [
								'- [Safe](https://example.com)',
								'- [Unsafe](javascript:alert(1))',
								'',
								'<img src=x onerror=alert(1)>'
							].join('\n')
						}
					]
				})
			),
			expect(role('link', { name: 'Safe' })).toHaveAttr(
				'href',
				'https://example.com'
			),
			expect(role('link', { name: 'Unsafe' })).toBeAbsent(),
			expect(text('Unsafe')).toExist(),
			expect(text('<img src=x onerror=alert(1)>')).toExist(),
			expect(role('img')).toBeAbsent()
		);
	});

	test('clearing returns to the first-visit composer', () => {
		scene(
			{ update, view },
			given(
				modifyFields(idle, {
					messages: () => [
						{ role: 'user', content: 'Hi' },
						{ role: 'assistant', content: 'Hello.' }
					]
				})
			),
			click(role('button', { name: 'Clear' })),
			Command.resolve(SaveHistory, Message.SucceededSaveHistory()),
			expect(text('Hello.')).toBeAbsent(),
			expect(role('button', { name: 'Clear' })).toBeAbsent()
		);
	});
});
