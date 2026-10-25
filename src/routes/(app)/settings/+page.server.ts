import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { TELEGRAM_BOT_USERNAME } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { appUrl, senders } from '#lib/server/digest-senders.ts';
import { requireUser } from '#lib/server/guards.ts';
import { getAiSettings } from '#lib/server/services/ai-settings.ts';
import { countOpenSuggestions } from '#lib/server/services/ai-suggestions.ts';
import { getDigestUser, sendDigest, type ChannelResult } from '#lib/server/services/digest.ts';
import { invoiceAttention } from '#lib/server/services/invoice-jobs.ts';
import {
	createLinkCode,
	setDigestPrefs,
	unlinkTelegram
} from '#lib/server/services/telegram-link.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireUser(locals);
	const [row] = await db
		.select({
			email: user.email,
			telegramChatId: user.telegramChatId,
			digestEnabled: user.digestEnabled,
			digestChannels: user.digestChannels,
			linkCode: user.telegramLinkCode,
			linkExpiresAt: user.telegramLinkExpiresAt
		})
		.from(user)
		.where(eq(user.id, me.id));
	const now = new Date();
	const pending =
		row.linkCode && row.linkExpiresAt && row.linkExpiresAt > now
			? { code: row.linkCode, expiresAt: row.linkExpiresAt }
			: null;
	const bot = (TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '');
	return {
		me: {
			email: row.email,
			telegramLinked: !!row.telegramChatId,
			digestEnabled: row.digestEnabled,
			digestChannels: row.digestChannels
		},
		bot,
		pending:
			pending && bot ? { ...pending, link: `https://t.me/${bot}?start=${pending.code}` } : null
	};
};

const CHANNEL_TEXT: Record<ChannelResult | 'skipped', string> = {
	sent: 'terkirim',
	off: 'dimatikan',
	'not-linked': 'belum terhubung',
	failed: 'gagal',
	skipped: '–'
};

export const actions: Actions = {
	linkTelegram: async ({ locals }) => {
		const me = requireUser(locals);
		await createLinkCode(db, me.id);
		return { done: 'Kode dibuat. Buka Telegram dalam 15 menit.' };
	},

	unlinkTelegram: async ({ locals }) => {
		const me = requireUser(locals);
		await unlinkTelegram(db, { userId: me.id });
		return { done: 'Telegram diputus.' };
	},

	saveDigest: async ({ request, locals }) => {
		const me = requireUser(locals);
		const form = await request.formData();
		const channels = (['telegram', 'email'] as const).filter((c) => form.get(c) === 'on');
		const enabled = form.get('enabled') === 'on';
		if (enabled && channels.length === 0)
			return fail(400, { error: 'Pilih minimal satu saluran, atau matikan ringkasan harian.' });
		await setDigestPrefs(db, me.id, { enabled, channels });
		return { done: enabled ? 'Ringkasan harian disimpan.' : 'Ringkasan harian dimatikan.' };
	},

	/** Send my digest now, through the same code as the 07:30 run */
	testDigest: async ({ locals }) => {
		const me = requireUser(locals);
		const u = await getDigestUser(db, me.id);
		if (!u) return fail(400, { error: 'Pengguna tidak ditemukan.' });
		const r = await sendDigest(db, u, {
			appUrl,
			senders,
			aiNew: (await getAiSettings(db)).enabled ? await countOpenSuggestions(db) : 0,
			invoices: await invoiceAttention(db)
		});
		if (r.telegram === 'skipped' && r.mail === 'skipped')
			return {
				done: 'Tidak ada langkah atau invoice yang perlu diingatkan, jadi tidak ada yang dikirim.'
			};
		if (r.errors.length) console.error('test digest', r.errors);
		const text = `${r.total} langkah · Telegram ${CHANNEL_TEXT[r.telegram]} · email ${CHANNEL_TEXT[r.mail]}`;
		if (r.telegram === 'failed' || r.mail === 'failed')
			return fail(400, { error: `Sebagian gagal: ${text}. ${r.errors.join(' ').slice(0, 200)}` });
		return { done: `Ringkasan dikirim: ${text}.` };
	}
};
