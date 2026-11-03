import { ChatFailureReason } from '@marcsuesser/chat-contract';
import * as Schema from 'effect/Schema';
import { defineMessageUnion } from 'foldkit/message';

export const Message = defineMessageUnion({
	UpdatedDraft: { value: Schema.String },
	SubmittedDraft: {},
	ReceivedReplyDelta: { text: Schema.String },
	FinishedReply: {},
	FailedReply: { reason: ChatFailureReason },
	ClickedStop: {},
	ClickedClear: {},
	SucceededSaveHistory: {},
	FailedSaveHistory: {}
});
export type Message = typeof Message.Type;
