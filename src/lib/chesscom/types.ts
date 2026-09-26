import { ParsedPgn } from 'src/lib/pgn';

export interface ChessComGameRecord {
	key: string;
	pgn: string;
	headers: Record<string, string>;
	white: string;
	black: string;
	result: string;
	url: string;
	analysisUrl: string | null;
	rules: string;
	timeClass: string;
	timeControl: string;
	eco: string;
	accuracies: { white?: number; black?: number };
	ratings: { white?: number; black?: number };
	date: Date;
	parsed: ParsedPgn;
	playerColor: 'w' | 'b' | null;
	playerResult: 'win' | 'loss' | 'draw' | null;
	repertoireMatch?: {
		id: string;
		title: string;
		length: number;
		line: string[];
	};
	boardId?: string | null;
}
