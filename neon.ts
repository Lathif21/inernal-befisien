import { defineConfig } from '@neon/config/v1';

export default defineConfig({
	// Declare your Neon services here
	auth: false,
	// Files written in the Email page (P3-08): uploaded by the browser with presigned PUTs, sent as
	// attachments up to 25 MB or as download links (/f/<token>) up to 200 MB. Private: every read is
	// a presigned GET. The daily email-files-cleanup task deletes expired files.
	buckets: {
		'email-files': {}
	},
	// Branch policy: per-branch tuning
	branch: (branch) => {
		if (branch.isDefault) {
			// Default branch: no overrides, uses project defaults
			return {};
		}
		if (branch.name === 'dev') {
			// Long-lived development branch (local `npm run dev`, demo seed): never expires
			return {};
		}
		if (!branch.exists) {
			// New non-default branches: auto-expire
			// Run `neon checkout <name>` to create a new branch with these settings
			return { ttl: '7d' };
		}
		// Existing branch: no changes
		return {};
	}
});
