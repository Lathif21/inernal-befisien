// Pictures for the email editor (browser only): small enough for an email, as a data: URL that
// services/email.ts turns into an inline attachment.

/** What every mail client shows inline (Outlook desktop has no SVG) */
export const EMAIL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Wider than any email column; a phone screenshot keeps its detail */
const MAX_SIDE = 1600;
/** Smaller files are sent as they are (a GIF keeps its animation) */
const KEEP_BYTES = 500_000;

export const isEmailImage = (file: File) => EMAIL_IMAGE_TYPES.includes(file.type);

const readDataUrl = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

/** A pasted or chosen picture as a data: URL; large ones scaled to 1600 px and saved as JPEG */
export async function emailImage(file: File) {
	if (!isEmailImage(file))
		throw new Error(`${file.name}: format gambar tidak didukung. Pakai PNG, JPG, GIF atau WebP.`);
	const bitmap = await createImageBitmap(file);
	try {
		const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
		if (scale === 1 && file.size <= KEEP_BYTES) return await readDataUrl(file);
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Gambar tidak bisa diproses di browser ini.');
		// JPEG has no transparency: a transparent PNG gets the white of an email page
		ctx.fillStyle = 'white';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/jpeg', 0.85);
	} finally {
		bitmap.close();
	}
}
