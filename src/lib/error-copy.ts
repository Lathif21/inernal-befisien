// Wording of the error pages (+error.svelte). Messages thrown with error(4xx, '…') in Bahasa
// Indonesia are shown as they are; 5xx never shows server details.

export function errorCopy(status: number, message: string | undefined) {
	if (status === 404)
		return {
			title: 'Halaman tidak ditemukan',
			text:
				message && message !== 'Not Found'
					? message
					: 'Alamat ini tidak ada atau datanya sudah dihapus.'
		};
	if (status === 403)
		return { title: 'Tidak ada akses', text: message || 'Anda tidak punya akses ke halaman ini.' };
	if (status < 500)
		return {
			title: 'Permintaan tidak bisa diproses',
			text: message || 'Periksa alamatnya lalu coba lagi.'
		};
	return {
		title: 'Terjadi kesalahan',
		text: 'Ada masalah di server. Data Anda aman. Muat ulang halaman ini, atau coba lagi sebentar lagi.'
	};
}
