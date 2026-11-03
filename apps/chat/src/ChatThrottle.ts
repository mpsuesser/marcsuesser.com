import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

/**
 * Decides whether a client address may start another chat turn now. The chat
 * route reads it once per request; the Worker backs it with a Cloudflare rate
 * limit, and tests swap in a fixed answer.
 */
export class ChatThrottle extends Context.Service<ChatThrottle, {
	readonly isAllowed: (clientKey: string) => Effect.Effect<boolean>;
}>()('marcsuesser.com/ChatThrottle') {
	/** Lets every turn through. */
	static readonly layerAllowAll: Layer.Layer<ChatThrottle> = Layer.succeed(
		ChatThrottle,
		ChatThrottle.of({ isAllowed: () => Effect.succeed(true) })
	);

	/** Refuses every turn. */
	static readonly layerDenyAll: Layer.Layer<ChatThrottle> = Layer.succeed(
		ChatThrottle,
		ChatThrottle.of({ isAllowed: () => Effect.succeed(false) })
	);
}
