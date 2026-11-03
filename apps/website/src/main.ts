import type { Runtime } from 'foldkit';

import type { Message } from './message.ts';
import { Turn, type Flags, type Model } from './model.ts';

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (
	flags
) => ({
	model: {
		messages: flags.messages,
		draft: '',
		turn: Turn.Idle()
	}
});
