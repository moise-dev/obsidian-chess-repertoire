const validDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const dayKey = (date: Date): string =>
	[
		String(date.getFullYear()).padStart(4, '0'),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');

export const dayBefore = (value: string): string => {
	if (!validDay(value)) return value;

	const [year, month, day] = value.split('-').map(Number);
	return dayKey(new Date(year, month - 1, day - 1));
};

export const archiveUrlForMonth = (username: string, date: Date): string =>
	`https://api.chess.com/pub/player/${encodeURIComponent(
		username
	)}/games/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(
		2,
		'0'
	)}`;

const archiveMonth = (url: string): string | null => {
	const match = url.match(/\/(\d{4})\/(0[1-9]|1[0-2])(?:\/)?(?:[?#].*)?$/);
	return match ? `${match[1]}-${match[2]}` : null;
};

export const shouldFetchArchive = (
	url: string,
	lastFetchedDay: string
): boolean => {
	if (!validDay(lastFetchedDay)) return true;

	const month = archiveMonth(url);
	return !month || month >= lastFetchedDay.slice(0, 7);
};

export const shouldImportGame = (date: Date, lastFetchedDay: string): boolean =>
	!validDay(lastFetchedDay) || dayKey(date) >= lastFetchedDay;
