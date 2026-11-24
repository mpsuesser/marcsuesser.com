import {
	ChatLimits,
	ChatModel,
	type ChatFailureReason,
	type ChatMessage
} from '@marcsuesser/chat-contract';
import * as Arr from 'effect/Array';
import * as Match from 'effect/Match';
import * as Option from 'effect/Option';
import * as Str from 'effect/String';
import type { Document, Html, HtmlBuilder } from 'foldkit/html';

import { markdownView } from './markdown.ts';
import { Message } from './message.ts';
import { Turn, type Model } from './model.ts';

const DRAFT_ID = 'draft';

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
	const isStreaming = Turn.guards.Streaming(model.turn);
	const isEmpty = Arr.isReadonlyArrayEmpty(model.messages) && !isStreaming;
	return {
		title: 'Marc Suesser',
		lang: 'en',
		body: h.main(
			[h.Class('flex h-dvh w-full flex-col bg-zinc-950 text-zinc-100')],
			isEmpty
				? [emptyView(model, h)]
				: [conversationView(model, h), composerDockView(model, h)]
		)
	};
};

/** Before the first message: an invitation above the composer, centered. */
const emptyView = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.div([h.Class('flex w-full flex-1 justify-center')], [
		h.div(
			[h.Class('flex w-full max-w-2xl flex-col justify-center px-6')],
			[
				h.h1([h.Class('sr-only')], ['Marc Suesser']),
				h.h2(
					[
						h.Class(
							'mb-8 text-center text-2xl font-normal text-zinc-100 sm:text-[28px] sm:leading-[34px]'
						)
					],
					['Ask me anything about Marc.']
				),
				composerView(model, h)
			]
		)
	]);

/**
 * The conversation scrolls in a full-width area, so its scrollbar sits at the
 * window's edge. `flex-col-reverse` keeps the newest text in view while a
 * reply streams and leaves the position alone once the visitor scrolls up.
 */
const conversationView = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class(
			'chat-scroll flex w-full flex-1 flex-col-reverse overflow-y-auto'
		)],
		[
			h.div([h.Class('mx-auto w-full max-w-2xl px-6')], [
				h.h1([h.Class('sr-only')], ['Marc Suesser']),
				h.ol(
					[
						h.Class('flex flex-col gap-6 py-6'),
						h.AriaLabel('Conversation')
					],
					[
						// The conversation only ever grows at the end, so list position
						// is a stable identity and the items need no keys.
						...Arr.map(model.messages, (message) =>
							h.li([], [messageView(message, h)])),
						...Turn.match(model.turn, {
							Streaming: ({ reply }) => [
								h.li([h.AriaLive('polite')], [
									streamingReplyView(reply, h)
								])
							],
							Idle: () => [],
							Failed: () => []
						})
					]
				),
				...Turn.match(model.turn, {
					Failed: ({ reason }) => [failureView(reason, h)],
					Idle: () => [],
					Streaming: () => []
				})
			])
		]
	);

const messageView = (message: ChatMessage, h: HtmlBuilder<Message>): Html =>
	Match.value(message.role).pipe(
		Match.when('user', () =>
			h.div([h.Class('flex justify-end')], [
				h.div(
					[
						h.Class(
							'max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-800 px-4 py-2 text-zinc-100'
						)
					],
					[message.content]
				)
			])),
		Match.when('assistant', () => replyView(message.content, h)),
		Match.exhaustive
	);

const replyView = (content: string, h: HtmlBuilder<Message>): Html =>
	h.div([h.Class('reply max-w-full break-words')], markdownView(content, h));

const streamingReplyView = (reply: string, h: HtmlBuilder<Message>): Html =>
	Str.isEmpty(reply)
		? h.span([
			h.Class('inline-block h-4 w-2 animate-pulse bg-zinc-600'),
			h.AriaLabel('Thinking')
		])
		: replyView(reply, h);

const failureCopy = (reason: ChatFailureReason): string =>
	Match.value(reason).pipe(
		Match.when(
			'RateLimited',
			() =>
				"That's a lot of questions at once. Give it a minute, then try again."
		),
		Match.when(
			'Unavailable',
			() =>
				"Something went wrong on my end. Send your message again and I'll pick it up."
		),
		Match.exhaustive
	);

const failureView = (
	reason: ChatFailureReason,
	h: HtmlBuilder<Message>
): Html =>
	h.p(
		[
			h.Class(
				'mb-6 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300'
			),
			h.Role('alert')
		],
		[failureCopy(reason)]
	);

/**
 * After the first message: the composer pinned below, spanning the same column
 * as the conversation. Clear sits outside that column in the right margin once
 * the window is wide enough to have one, and beside the composer otherwise.
 */
const composerDockView = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.div([h.Class('flex w-full justify-center')], [
		h.div([h.Class('relative w-full max-w-2xl px-6 py-3')], [
			h.div([h.Class('flex items-end gap-2')], [
				h.div([h.Class('min-w-0 flex-1')], [composerView(model, h)]),
				h.button(
					[
						h.Type('button'),
						h.OnClick(Message.ClickedClear()),
						h.Class(clearButtonClass)
					],
					['Clear']
				)
			])
		])
	]);

/**
 * Clear lines up with the send button: `mb-8` is the button's 10px inset from
 * the pill's bottom plus the 22px model label beneath the pill.
 */
const clearButtonClass =
	'mb-8 px-1 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300 min-[52rem]:absolute min-[52rem]:bottom-3 min-[52rem]:left-full';

const submitOnEnter = (
	key: string,
	modifiers: { readonly shiftKey: boolean }
) => key === 'Enter' && !modifiers.shiftKey
	? Option.some(Message.SubmittedDraft())
	: Option.none();

/**
 * The input pill, with the model named beneath it. Enter sends and
 * Shift+Enter adds a line. While a reply
 * streams, the send button becomes Stop.
 */
const composerView = (model: Model, h: HtmlBuilder<Message>): Html => {
	const isStreaming = Turn.guards.Streaming(model.turn);
	const canSend = Str.isNonEmpty(Str.trim(model.draft)) && !isStreaming;
	return h.div([], [
		h.form(
			[
				h.OnSubmit(Message.SubmittedDraft()),
				h.Class(
					'flex items-end gap-2 rounded-3xl border border-zinc-800 bg-zinc-900 p-2.5 focus-within:border-zinc-600'
				)
			],
			[
				h.label([h.For(DRAFT_ID), h.Class('sr-only')], [
					'Ask about Marc'
				]),
				h.textarea([
					h.Id(DRAFT_ID),
					h.Value(model.draft),
					h.OnInput((value) => Message.UpdatedDraft({ value })),
					h.OnKeyDownPreventDefault(submitOnEnter),
					h.Rows(1),
					h.Maxlength(ChatLimits.maxDraftChars),
					h.Autofocus(true),
					h.Class(
						'field-sizing-content max-h-56 min-h-9 flex-1 resize-none bg-transparent px-3 py-1.5 text-zinc-100 focus:outline-none'
					)
				]),
				isStreaming
					? h.button(
						[
							h.Type('button'),
							h.OnClick(Message.ClickedStop()),
							h.AriaLabel('Stop'),
							h.Class(roundButtonClass)
						],
						[stopIcon(h)]
					)
					: h.button(
						[
							h.Type('submit'),
							h.Disabled(!canSend),
							h.AriaLabel('Send'),
							h.Class(
								`${roundButtonClass} disabled:cursor-not-allowed disabled:opacity-40`
							)
						],
						[arrowUpIcon(h)]
					)
			]
		),
		modelLabelView(h)
	]);
};

/**
 * The model under the composer, its right edge in line with the send button's
 * (the pill's border plus padding in). `mt-1.5` and `h-4` fix its height at
 * 22px, which `clearButtonClass` relies on.
 */
const modelLabelView = (h: HtmlBuilder<Message>): Html =>
	h.p(
		[
			h.Class(
				'mt-1.5 h-4 select-none pr-[11px] text-right text-xs leading-4 text-zinc-600'
			)
		],
		[ChatModel.label]
	);

const roundButtonClass =
	'flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition-opacity hover:opacity-90';

const arrowUpIcon = (h: HtmlBuilder<Message>): Html =>
	h.svg(
		[
			h.Width('18'),
			h.Height('18'),
			h.ViewBox('0 0 24 24'),
			h.Fill('none'),
			h.Stroke('currentColor'),
			h.StrokeWidth('2.5'),
			h.StrokeLinecap('round'),
			h.StrokeLinejoin('round'),
			h.AriaHidden(true)
		],
		[
			h.path([h.Attribute('d', 'M12 19V5')]),
			h.path([h.Attribute('d', 'M5 12l7-7 7 7')])
		]
	);

const stopIcon = (h: HtmlBuilder<Message>): Html =>
	h.svg(
		[
			h.Width('12'),
			h.Height('12'),
			h.ViewBox('0 0 12 12'),
			h.Fill('currentColor'),
			h.AriaHidden(true)
		],
		[h.rect([h.Width('12'), h.Height('12'), h.Rx('2')])]
	);
