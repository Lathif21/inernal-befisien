/**
 * A rule violation a person can fix (Bahasa Indonesia message, safe to show in the UI).
 * Routes turn it into `fail(400)`; anything else is an unexpected 500.
 */
export class ServiceError extends Error {
	constructor(
		message: string,
		/** Form field the message belongs to, when there is one */
		readonly field?: string
	) {
		super(message);
		this.name = 'ServiceError';
	}
}
