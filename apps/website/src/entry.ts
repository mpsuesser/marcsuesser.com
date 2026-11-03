import { BrowserKeyValueStore } from '@effect/platform-browser';
import * as Layer from 'effect/Layer';
import { Http, Runtime } from 'foldkit';

import { flags } from './history.ts';
import { init } from './main.ts';
import { Message } from './message.ts';
import { Flags, Model } from './model.ts';
import { subscriptions } from './subscription.ts';
import { update } from './update.ts';
import { view } from './view.ts';

const application = Runtime.makeApplication({
	Model,
	Flags,
	init,
	update,
	view,
	subscriptions,
	container: document.getElementById('root'),
	// History lives in localStorage, read through KeyValueStore; the reply
	// Subscription talks to the chat Worker through HttpClient.
	resources: Layer.mergeAll(
		BrowserKeyValueStore.layerLocalStorage,
		Http.layer
	),
	devTools: { Message }
});

Runtime.run(application, { flags });
