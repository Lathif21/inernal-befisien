// How the CRM sends email (P3-08), shared by the app (email-config.ts reads $app/env) and Trigger.dev
// tasks such as email-scheduled-send (process.env). Relative imports only.
import { formatAddress, parseAddress, type Address, type EmailBrand } from '../email';
import type { DbOrTx } from './db/client';
import { sendEmail } from './notify/email';
import {
	getReceivedAttachment,
	getSentAttachments,
	pickSentAttachment
} from './notify/resend-inbound';
import type { AttachmentSource, SendDeps } from './services/email';
import { fileForDownload } from './services/email-files';
import type { FileStorage } from './storage/files';

const DEFAULT_FROM = 'Befisien <info@befisien.com>';

/** INBOX_FROM ("Befisien <info@befisien.com>"), or the default when unset or malformed */
export const inboxAddress = (raw: string | undefined): Address =>
	parseAddress(raw || DEFAULT_FROM) ?? parseAddress(DEFAULT_FROM)!;

/**
 * The signature's company look, as on befisien.com. The logo is served by the app itself
 * (static/email), so it needs the public app URL; locally there is none and the logo is left out.
 */
export function emailBrand(appUrl: string): EmailBrand {
	return {
		logoUrl: appUrl.startsWith('https://') ? `${appUrl}/email/befisien-mark.png` : null,
		name: 'Befisien',
		wordmark: 'BEFISIEN',
		tagline: 'Tingkatkan Efisiensi dan Akselerasi Bisnis Anda',
		services: ['AI Agent', 'Otomasi Workflow', 'Integrasi Sistem', 'Dashboard & Aplikasi'],
		links: [
			{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/befisien-ai-b99a183b2' },
			{ label: 'Instagram', url: 'https://www.instagram.com/befisien_id' }
		]
	};
}

/** Download links live on Resend's CDN (cdn.resend.app); nothing else is fetched */
const RESEND_CDN = /^https:\/\/([a-z0-9-]+\.)*resend\.(app|com)$/;

export function createSendDeps(config: {
	db: DbOrTx;
	resendKey: string;
	from: Address;
	/** Public base URL without a trailing slash */
	appUrl: string;
	storage: FileStorage | null;
}): SendDeps {
	const { db, resendKey, storage } = config;

	/**
	 * A stored attachment's bytes (forwarding): uploads from the bucket, everything else from
	 * Resend's received or sent attachments
	 */
	async function loadAttachment(source: AttachmentSource) {
		const { attachment: a } = source;
		if (a.fileId && storage) {
			const file = await fileForDownload(db, a.fileId);
			if (!file) throw new Error(`file ${a.filename} expired`);
			return storage.read(file.key);
		}
		const url =
			source.direction === 'in'
				? (await getReceivedAttachment(resendKey, source.resendId, a.id)).download_url
				: pickSentAttachment(
						await getSentAttachments(resendKey, source.resendId),
						a.filename,
						source.nth
					)?.download_url;
		if (!url) throw new Error(`attachment ${a.filename} not found at Resend`);
		if (!RESEND_CDN.test(new URL(url).origin)) throw new Error(`unexpected download origin ${url}`);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`download ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}

	return {
		from: config.from,
		brand: emailBrand(config.appUrl),
		send: (mail) => sendEmail({ apiKey: resendKey, from: formatAddress(config.from) }, mail),
		loadAttachment,
		storage,
		// Download links (/f/<token>) point at the app itself
		appUrl: config.appUrl
	};
}
