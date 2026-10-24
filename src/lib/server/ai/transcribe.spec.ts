import { describe, expect, it } from 'vitest';
import { groqFileName } from './transcribe';

describe('groqFileName', () => {
	it('sends Telegram voice notes (.oga) as .ogg; other names stay', () => {
		expect(groqFileName('file_12.oga')).toBe('file_12.ogg');
		expect(groqFileName('FILE.OGA')).toBe('FILE.ogg');
		expect(groqFileName('song.mp3')).toBe('song.mp3');
		expect(groqFileName('voice.ogg')).toBe('voice.ogg');
	});
});
