import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Runtime } from 'foldkit';

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
	// History lives in localStorage; Commands and Flags read it through KeyValueStore.
	resources: BrowserKeyValueStore.layerLocalStorage,
	devTools: { Message }
});

Runtime.run(application, { flags });
