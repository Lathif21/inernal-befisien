// Transaction categories (Settings → Kategori, task P1-13). Relative imports only.
// Order is `sort` within a type; it drives the drawer's category list and the Keuangan filter.
import { and, asc, eq, max, ne, sql } from 'drizzle-orm';
import type { TxnType } from '../../constants';
import type { CategoryInput } from '../../schemas/settings';
import type { DbOrTx, Tx } from '../db/client';
import { category, transaction } from '../db/schema/index';
import { ServiceError } from './errors';

/** Categories with how many transactions use them (used ones cannot be deleted) */
export function listCategoriesWithUsage(db: DbOrTx) {
	return db
		.select({
			id: category.id,
			type: category.type,
			name: category.name,
			isOverhead: category.isOverhead,
			sort: category.sort,
			used: sql<number>`(select count(*)::int from ${transaction} where "transaction"."category_id" = "category"."id")`
		})
		.from(category)
		.orderBy(asc(category.type), asc(category.sort), asc(category.name));
}

async function assertFreeName(tx: Tx, type: TxnType, name: string, exceptId?: string) {
	const [dup] = await tx
		.select({ id: category.id })
		.from(category)
		.where(
			and(
				eq(category.type, type),
				eq(sql`lower(${category.name})`, name.toLowerCase()),
				exceptId ? ne(category.id, exceptId) : undefined
			)
		);
	if (dup) throw new ServiceError('Nama kategori ini sudah ada.', 'name');
}

/** Create (at the end of its type) or rename; the type of an existing category does not change */
export async function saveCategory(db: DbOrTx, input: CategoryInput) {
	return db.transaction(async (tx) => {
		if (input.id) {
			const [current] = await tx.select().from(category).where(eq(category.id, input.id));
			if (!current) throw new ServiceError('Kategori tidak ditemukan.');
			await assertFreeName(tx, current.type, input.name, current.id);
			const [row] = await tx
				.update(category)
				.set({ name: input.name })
				.where(eq(category.id, current.id))
				.returning();
			return row;
		}
		await assertFreeName(tx, input.type, input.name);
		const [{ last }] = await tx
			.select({ last: max(category.sort) })
			.from(category)
			.where(eq(category.type, input.type));
		const [row] = await tx
			.insert(category)
			.values({
				type: input.type,
				name: input.name,
				// overhead = expense without a client (P2-08); income always has a client
				isOverhead: input.type === 'expense' && input.isOverhead,
				sort: (last ?? -1) + 1
			})
			.returning();
		return row;
	});
}

export async function deleteCategory(db: DbOrTx, id: string) {
	return db.transaction(async (tx) => {
		const [{ used }] = await tx
			.select({ used: sql<number>`count(*)::int` })
			.from(transaction)
			.where(eq(transaction.categoryId, id));
		if (used > 0)
			throw new ServiceError(
				`Kategori ini dipakai di ${used} transaksi, jadi tidak bisa dihapus. Ganti namanya saja.`
			);
		const [row] = await tx.delete(category).where(eq(category.id, id)).returning();
		if (!row) throw new ServiceError('Kategori tidak ditemukan.');
		return row;
	});
}

/** One place up or down within its type (sort is renumbered 0…n-1 on the way) */
export async function moveCategory(db: DbOrTx, id: string, direction: 'up' | 'down') {
	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(category).where(eq(category.id, id));
		if (!current) throw new ServiceError('Kategori tidak ditemukan.');
		const siblings = await tx
			.select({ id: category.id })
			.from(category)
			.where(eq(category.type, current.type))
			.orderBy(asc(category.sort), asc(category.name));
		const order = siblings.map((s) => s.id);
		const i = order.indexOf(id);
		const j = direction === 'up' ? i - 1 : i + 1;
		if (j < 0 || j >= order.length) return;
		[order[i], order[j]] = [order[j], order[i]];
		for (const [sort, catId] of order.entries())
			await tx.update(category).set({ sort }).where(eq(category.id, catId));
	});
}
