import * as Arr from 'effect/Array';
import * as Match from 'effect/Match';
import * as Schema from 'effect/Schema';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { Lexer, type MarkedToken, type Token, type Tokens } from 'marked';

type Child = Html | string;

/**
 * Renders a model reply's Markdown as Foldkit nodes. It builds elements from
 * marked's tokens instead of injecting HTML, so a reply can't add markup of
 * its own: raw HTML shows as text, and only http(s) and mailto links become
 * links. Partial Markdown mid-stream (an unclosed fence or emphasis) renders
 * as plain text until the rest arrives.
 */
export const markdownView = <Message>(
	source: string,
	h: HtmlBuilder<Message>
): ReadonlyArray<Html> => blocks(Lexer.lex(source), h);

/** The token types this renderer knows. Anything else renders as its raw source. */
const BuiltInType = Schema.Literals([
	'blockquote',
	'br',
	'code',
	'codespan',
	'def',
	'del',
	'em',
	'escape',
	'heading',
	'hr',
	'html',
	'image',
	'link',
	'list',
	'paragraph',
	'space',
	'strong',
	'table',
	'text'
]);
const isBuiltInType = Schema.is(BuiltInType);

const isBuiltIn = (token: Token): token is MarkedToken =>
	isBuiltInType(token.type);

/** A link target replies may use: web pages and email, nothing scriptable. */
const SafeHref = Schema.String.check(
	Schema.isPattern(/^\s*(?:https?:|mailto:)/i, {
		identifier: 'SafeHref',
		title: 'Safe Href',
		description: 'An http(s) or mailto URL.',
		message: 'Only http(s) and mailto links are allowed'
	})
);
const isSafeHref = Schema.is(SafeHref);

const blocks = <Message>(
	tokens: ReadonlyArray<Token>,
	h: HtmlBuilder<Message>
): ReadonlyArray<Html> =>
	Arr.map(
		tokens,
		(token) => isBuiltIn(token) ? block(token, h) : h.p([], [token.raw])
	);

const block = <Message>(token: MarkedToken, h: HtmlBuilder<Message>): Html =>
	Match.value(token).pipe(
		Match.discriminators('type')({
			paragraph: (paragraph) => h.p([], inline(paragraph.tokens, h)),
			heading: (heading) => headingView(heading, h),
			code: (code) => h.pre([], [h.code([], [code.text])]),
			blockquote: (quote) => h.blockquote([], blocks(quote.tokens, h)),
			list: (list) => listView(list, h),
			table: (table) => tableView(table, h),
			hr: () => h.hr([]),
			text: (text) =>
				h.p(
					[],
					text.tokens === undefined
						? [text.text]
						: inline(text.tokens, h)
				),
			html: (html) => h.p([], [html.text]),
			space: () => h.empty,
			def: () => h.empty
		}),
		Match.orElse((other) => h.p([], [other.raw]))
	);

/**
 * Replies sit inside a page whose only heading is the site itself, so reply
 * headings start one level down.
 */
const headingView = <Message>(
	token: Tokens.Heading,
	h: HtmlBuilder<Message>
): Html => {
	const children = inline(token.tokens, h);
	return Match.value(token.depth).pipe(
		Match.when((depth) => depth <= 2, () => h.h2([], children)),
		Match.when(3, () => h.h3([], children)),
		Match.orElse(() => h.h4([], children))
	);
};

const listView = <Message>(
	token: Tokens.List,
	h: HtmlBuilder<Message>
): Html => {
	const items = Arr.map(token.items, (item) =>
		h.li(
			[],
			Arr.flatMap(item.tokens, (child): ReadonlyArray<Child> =>
				// Tight list items wrap their text in a bare `text` token.
				child.type === 'text' && !token.loose
					? inline(child.tokens ?? [], h)
					: blocks([child], h))
		));
	return token.ordered
		? h.ol(
			token.start !== '' && token.start !== 1
				? [h.Attribute('start', String(token.start))]
				: [],
			items
		)
		: h.ul([], items);
};

const tableView = <Message>(
	token: Tokens.Table,
	h: HtmlBuilder<Message>
): Html =>
	h.div([h.Class('reply-table')], [
		h.table([], [
			h.thead([], [
				h.tr(
					[],
					Arr.map(token.header, (cell) =>
						h.th([], inline(cell.tokens, h)))
				)
			]),
			h.tbody(
				[],
				Arr.map(token.rows, (row) =>
					h.tr(
						[],
						Arr.map(row, (cell) =>
							h.td([], inline(cell.tokens, h)))
					))
			)
		])
	]);

const inline = <Message>(
	tokens: ReadonlyArray<Token>,
	h: HtmlBuilder<Message>
): ReadonlyArray<Child> =>
	Arr.map(
		tokens,
		(token) => isBuiltIn(token) ? inlineToken(token, h) : token.raw
	);

const inlineToken = <Message>(
	token: MarkedToken,
	h: HtmlBuilder<Message>
): Child =>
	Match.value(token).pipe(
		Match.discriminators('type')({
			text: (text): Child =>
				text.tokens === undefined
					? text.text
					: h.span([], inline(text.tokens, h)),
			escape: (escape) => escape.text,
			html: (html) => html.text,
			strong: (strong) => h.strong([], inline(strong.tokens, h)),
			em: (em) => h.em([], inline(em.tokens, h)),
			del: (del) => h.del([], inline(del.tokens, h)),
			codespan: (codespan) => h.code([], [codespan.text]),
			br: () => h.br([]),
			link: (link) =>
				isSafeHref(link.href)
					? h.a([
						h.Href(link.href),
						h.Target('_blank'),
						h.Rel('noopener noreferrer')
					], inline(link.tokens, h))
					: h.span([], inline(link.tokens, h)),
			// No remote images in replies; show the description instead.
			image: (image) => image.text
		}),
		Match.orElse((other): Child => other.raw)
	);
