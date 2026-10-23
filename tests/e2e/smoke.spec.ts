// Phase 1 smoke tests (docs/05-PHASES.md P1-14): login, create client, deal → won → project,
// add transaction, dashboard totals. One flow builds on the previous one; run with
// `npm run test:e2e` (see playwright.config.ts for the target and login).
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'nama@befisien.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'P@ssword';
const STAMP = Date.now().toString(36).toUpperCase();
const CLIENT = `ZZ Smoke ${STAMP}`;
const DEAL = `Deal smoke ${STAMP}`;

test.describe.configure({ mode: 'serial' });

/** Load a page and let it hydrate (a fresh dev server may reload once while bundling) */
async function open(page: Page, url: string) {
	await page.goto(url);
	await page.waitForLoadState('networkidle');
}

async function login(page: Page) {
	await open(page, '/login');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Kata sandi').fill(PASSWORD);
	await page.getByRole('button', { name: 'Masuk' }).click();
	await page.waitForURL((u) => u.pathname === '/');
}

/** Rupiah text ("+Rp 80.000.000", "Rp 1.250.000") → number */
const rp = (text: string) => Number(text.replace(/[^\d]/g, '') || 0);

/** Wait for a toast with this text and close it */
async function toast(page: Page, text: string | RegExp) {
	const t = page.locator('[data-sonner-toast]', { hasText: text }).first();
	await expect(t).toBeVisible();
	await t
		.getByRole('button')
		.last()
		.click()
		.catch(() => {});
}

test('login: wrong password is refused, nobody can sign up, an admin gets in', async ({
	page,
	request
}) => {
	await open(page, '/login');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Kata sandi').fill('salah-sekali');
	await page.getByRole('button', { name: 'Masuk' }).click();
	await expect(page.getByRole('alert')).toContainText('salah');

	const signUp = await request.post('/api/auth/sign-up/email', {
		data: { email: `zz.${STAMP}@contoh.test`, password: 'RahasiaSekali1', name: 'Orang Asing' }
	});
	expect(signUp.ok()).toBe(false);

	await login(page);
	await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
});

test('create a client from the Klien page', async ({ page }) => {
	await login(page);
	await open(page, '/clients');
	await page.getByRole('button', { name: 'Tambah klien' }).first().click();
	const drawer = page.getByRole('dialog', { name: 'Tambah klien' });
	await drawer.getByLabel('Nama klien').fill(CLIENT);
	await drawer.getByLabel('Kota').fill('Surabaya');
	await page.getByRole('button', { name: 'Simpan klien' }).click();
	await toast(page, 'ditambahkan');
	await open(page, `/clients?q=${encodeURIComponent(CLIENT)}`);
	await expect(page.getByRole('link', { name: CLIENT })).toBeVisible();
});

test('a deal moved to Deal ✓ creates a project with a first step', async ({ page }) => {
	await login(page);
	await open(page, '/pipeline');
	await page.getByRole('button', { name: 'Deal', exact: true }).click();
	const drawer = page.getByRole('dialog', { name: 'Tambah deal' });
	await drawer.getByLabel('Klien').selectOption({ label: CLIENT });
	await drawer.getByLabel('Judul deal').fill(DEAL);
	await drawer.getByLabel('Perkiraan nilai').fill('50000000');
	await page.getByRole('button', { name: 'Simpan deal' }).click();
	await toast(page, 'ditambahkan');

	await open(page, `/pipeline?q=${encodeURIComponent(DEAL)}`);
	await page.getByRole('button', { name: `Menu ${DEAL}` }).click();
	await page.getByRole('menuitem', { name: 'Deal ✓' }).click();
	const won = page.getByRole('dialog', { name: 'Deal menang! Buat proyek sekarang?' });
	await expect(won).toBeVisible();
	await won.getByRole('button', { name: 'Buat Proyek' }).click();
	await toast(page, 'Proyek dibuat');

	await open(page, `/projects?q=${encodeURIComponent(DEAL)}`);
	const card = page.locator('article.bf-kcard', { hasText: DEAL });
	await expect(card).toBeVisible();
	await expect(page.getByRole('group', { name: /^Onboarding, 1 kartu$/ })).toBeVisible();
	await expect(card.locator('.bf-next')).toBeVisible(); // its first step
	await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /Rp 0 \/ 50 jt/);
});

test('a transaction on the client updates the client strip and the project card', async ({
	page
}) => {
	await login(page);
	await open(page, `/clients?q=${encodeURIComponent(CLIENT)}`);
	await page.getByRole('link', { name: CLIENT }).click();
	await page.waitForURL(/\/clients\/[0-9a-f-]+/);
	await page.getByLabel('Bagian klien').getByRole('link', { name: 'Keuangan' }).click();
	await page.waitForURL(/tab=keuangan/);

	await page.getByRole('button', { name: 'Pemasukan', exact: true }).click();
	const drawer = page.getByRole('dialog', { name: 'Catat transaksi' });
	await drawer.getByLabel('Jumlah').fill('20000000');
	await drawer.getByLabel('Proyek').selectOption({ label: DEAL });
	await drawer.getByLabel('Kategori').selectOption({ label: 'Termin' });
	await drawer.getByLabel('Keterangan').fill('Termin smoke test');
	await page.getByRole('button', { name: 'Simpan transaksi' }).click();
	await toast(page, 'dicatat');

	const strip = page.getByRole('region', { name: 'Keuangan klien' });
	await expect(strip).toContainText('Rp 20 jt');
	await expect(page.getByRole('row', { name: /Termin smoke test/ })).toContainText('+Rp');

	await open(page, `/projects?q=${encodeURIComponent(DEAL)}`);
	await expect(
		page.locator('article.bf-kcard', { hasText: DEAL }).getByRole('progressbar')
	).toHaveAttribute('aria-valuetext', /40% · Rp 20 jt \/ 50 jt/);
});

test('dashboard: tiles match Keuangan, and the Klien view total equals the Waktu view', async ({
	page
}) => {
	await login(page);
	/** The chart's table view: [title, income, expense, selected period?] */
	const chartTable = () =>
		page
			.locator('details table tbody tr')
			.evaluateAll((trs) =>
				trs.map((tr) => [
					tr.querySelector('th')!.textContent!.trim(),
					tr.children[1].textContent!,
					tr.children[2].textContent!,
					tr.querySelector('th')!.className.includes('extrabold')
				])
			);

	await open(page, '/');
	const tiles = page.getByRole('region', { name: 'Ringkasan periode' });
	const incomeTile = (await tiles.locator('.bf-stat').first().innerText()).split('\n')[1];
	const waktu = (await chartTable()).filter((r) => r[3]);
	expect(waktu).toHaveLength(1);
	const [, wIn, wOut] = waktu[0] as [string, string, string, boolean];

	await open(page, '/?view=klien');
	const klien = await chartTable();
	const kIn = klien.reduce((s, r) => s + rp(String(r[1])), 0);
	const kOut = klien.reduce((s, r) => s + rp(String(r[2])), 0);
	expect([kIn, kOut]).toEqual([rp(wIn), rp(wOut)]);
	expect(klien.map((r) => r[0])).toContain(CLIENT);

	await open(page, '/finance');
	const paid = await page.locator('p[aria-live=polite]').innerText();
	const m = paid.match(/\+Rp\s([\d.]+)\s·\s−Rp\s([\d.]+)/);
	expect(m).not.toBeNull();
	expect([rp(m![1]), rp(m![2])]).toEqual([kIn, kOut]);
	await expect(
		page.getByRole('region', { name: 'Ringkasan periode' }).locator('.bf-stat').first()
	).toContainText(incomeTile);
});
