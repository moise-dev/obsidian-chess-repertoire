// The two halves of Stockfish 10 as src/components/react/EvalBar/bundled.ts
// imports them: what esbuild's `text` and `bytes` attributes hand back.

declare module 'stockfish/src/stockfish.js' {
	const source: string;
	export default source;
}

declare module 'stockfish/src/stockfish.wasm' {
	const bytes: Uint8Array<ArrayBuffer>;
	export default bytes;
}
