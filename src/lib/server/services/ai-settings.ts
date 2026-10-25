// Saran AI settings (Pengaturan → Saran AI): on / off and the schedule of the automatic run.
// Relative imports only: the Trigger.dev tasks read them.
import { eq } from 'drizzle-orm';
import {
	AI_FREQUENCIES,
	DEFAULT_AI_SCHEDULE,
	type AiFrequency,
	type AiSchedule
} from '../../ai-schedule';
import type { AiSettingsInput } from '../../schemas/settings';
import type { DbOrTx } from '../db/client';
import { appSettings } from '../db/schema/index';

export async function getAiSettings(db: DbOrTx): Promise<AiSchedule> {
	const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
	if (!row) return { ...DEFAULT_AI_SCHEDULE };
	return {
		enabled: row.aiEnabled,
		frequency: (AI_FREQUENCIES as readonly string[]).includes(row.aiFrequency)
			? (row.aiFrequency as AiFrequency)
			: 'daily',
		time: row.aiTime,
		weekday: row.aiWeekday,
		monthDay: row.aiMonthDay,
		lastRunAt: row.aiLastRunAt
	};
}

export async function saveAiSettings(db: DbOrTx, input: AiSettingsInput, userId: string) {
	const values = {
		aiEnabled: input.enabled,
		aiFrequency: input.frequency,
		aiTime: input.time,
		aiWeekday: input.weekday,
		aiMonthDay: input.monthDay,
		updatedAt: new Date(),
		updatedBy: userId
	};
	await db
		.insert(appSettings)
		.values({ id: 1, ...values })
		.onConflictDoUpdate({ target: appSettings.id, set: values });
}

/** The scheduled run started: its slot does not run again */
export async function markAiRun(db: DbOrTx, at: Date) {
	await db
		.insert(appSettings)
		.values({ id: 1, aiLastRunAt: at })
		.onConflictDoUpdate({ target: appSettings.id, set: { aiLastRunAt: at } });
}
