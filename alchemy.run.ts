import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import { Stack } from 'alchemy';
import * as Effect from 'effect/Effect';

import Chat from './apps/chat/src/ChatWorker.ts';

/**
 * marcsuesser.com: the Foldkit chat page, plus the chat Worker it forwards
 * `/api/*` to over a service binding.
 *
 * - `prod` serves https://marcsuesser.com and redirects www to it.
 * - Any other stage serves only its workers.dev URL.
 */
export default Alchemy.Stack(
	'MarcSuesserCom',
	{ providers: Cloudflare.providers(), state: Cloudflare.state() },
	Effect.gen(function* () {
		const { stage } = yield* Stack;
		const chat = yield* Chat;

		const website = yield* Cloudflare.Website.Foldkit('Website', {
			rootDir: 'apps/website',
			main: 'src/worker/WebsiteWorker.ts',
			env: { CHAT: chat },
			// Only chat requests wake the Worker; everything else is static.
			assets: { runWorkerFirst: ['/api/*'] },
			...(stage === 'prod'
				? {
					domain: {
						name: 'marcsuesser.com',
						redirects: ['www.marcsuesser.com']
					},
					workersDev: false
				}
				: { workersDev: true })
		});

		return { url: website.url.as<string>() };
	})
);
