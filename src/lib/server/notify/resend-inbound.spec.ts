import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook } from './resend-inbound';

const key = Buffer.from('test-signing-key-0123456789');
const secret = `whsec_${key.toString('base64')}`;
const body = '{"type":"email.received","data":{"email_id":"e1"}}';
const now = 1_793_000_000_000;
const timestamp = String(now / 1000);

const sign = (id: string, ts: string, payload: string) =>
	`v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')}`;

describe('verifyWebhook', () => {
	it('accepts a valid signature, also among several', () => {
		const signature = sign('msg_1', timestamp, body);
		expect(verifyWebhook(secret, { id: 'msg_1', timestamp, signature }, body, now)).toBe(true);
		expect(
			verifyWebhook(
				secret,
				{ id: 'msg_1', timestamp, signature: `v1,b2xk ${signature}` },
				body,
				now
			)
		).toBe(true);
	});

	it('refuses a changed body, a wrong secret and a missing header', () => {
		const signature = sign('msg_1', timestamp, body);
		const headers = { id: 'msg_1', timestamp, signature };
		expect(verifyWebhook(secret, headers, `${body} `, now)).toBe(false);
		expect(verifyWebhook(`whsec_${Buffer.from('x').toString('base64')}`, headers, body, now)).toBe(
			false
		);
		expect(verifyWebhook(secret, { ...headers, signature: '' }, body, now)).toBe(false);
		expect(verifyWebhook('', headers, body, now)).toBe(false);
	});

	it('refuses a signature older than five minutes (replay)', () => {
		const old = String(now / 1000 - 6 * 60);
		const signature = sign('msg_1', old, body);
		expect(verifyWebhook(secret, { id: 'msg_1', timestamp: old, signature }, body, now)).toBe(
			false
		);
	});
});
